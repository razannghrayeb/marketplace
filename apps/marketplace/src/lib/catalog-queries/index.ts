import { supabaseAdmin as sb } from '../supabase/client'
import type {
  Product,
  ProductFilters,
  SortConfig,
  PaginationConfig,
  ProductsQueryResult,
  VendorStats,
  OverviewKPIs,
  PriceHistory,
  FreshnessStats,
  VendorFreshness,
  DailyScrapeStat,
  CategoryCount,
  VendorProductCount,
  PriceChangeEvent,
  CurrentSaleProduct,
} from '@/types/catalog-admin'

type BackendProductRow = Record<string, unknown>

type ProductAggregateRow = {
  vendor_id: number | null
  category: string | null
  color: string | null
  size: string | null
  image_url: string | null
  image_urls: unknown
  variant_id: string | null
  parent_product_url: string | null
  sales_price_cents: number | null
  last_seen: string | null
  availability: boolean | null
}

const DAY_MS = 24 * 60 * 60 * 1000
const BATCH_SIZE = 1000
const AGGREGATE_CACHE_TTL_MS = 60_000

/** GET /products clamps `limit` to 100 — requesting more makes `rows.length < limit` and stops after page 1. */
const BACKEND_PRODUCT_PAGE_SIZE = 100
/** Default max pages when crawling GET /products for aggregates (~120k rows). Override with CATALOG_AGGREGATE_BACKEND_MAX_PAGES. */
const DEFAULT_BACKEND_AGGREGATE_MAX_PAGES = 1200

/**
 * If Supabase returns fewer product rows than this, we also crawl GET /products and keep the larger set.
 * Small mirrors (e.g. ~100 rows) are common while the live catalog is 100k+ on the API/OpenSearch.
 */
const SUPABASE_ROWS_BEFORE_BACKEND_MERGE = 5000

function getBackendAggregateMaxPages(): number {
  const raw = process.env.CATALOG_AGGREGATE_BACKEND_MAX_PAGES?.trim()
  if (raw && /^\d+$/.test(raw)) {
    return Math.min(5000, Math.max(1, parseInt(raw, 10)))
  }
  return DEFAULT_BACKEND_AGGREGATE_MAX_PAGES
}

function catalogAggregateBackendMergeEnabled(): boolean {
  return process.env.CATALOG_AGGREGATE_SKIP_BACKEND !== '1'
}

function backendPaginationHasMore(payload: unknown, rowCount: number, limit: number): boolean {
  if (!payload || typeof payload !== 'object') return rowCount >= limit
  const pag = (payload as Record<string, unknown>).pagination
  if (pag && typeof pag === 'object' && 'has_more' in pag) {
    return Boolean((pag as Record<string, unknown>).has_more)
  }
  return rowCount >= limit
}

let aggregateCache: {
  data: ProductAggregateRow[] | null
  expiresAt: number
  inFlight: Promise<ProductAggregateRow[]> | null
} = {
  data: null,
  expiresAt: 0,
  inFlight: null,
}

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'https://marketplace-359201620993.asia-southeast1.run.app').replace(/\/+$/, '')

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

function toBoolOrNull(value: unknown): boolean | null {
  if (value === true) return true
  if (value === false) return false
  if (typeof value === 'string') {
    const v = value.toLowerCase()
    if (v === 'true') return true
    if (v === 'false') return false
  }
  return null
}

function toStringOrNull(value: unknown): string | null {
  if (typeof value === 'string') return value
  return null
}

function extractArray<T = unknown>(input: unknown): T[] {
  if (Array.isArray(input)) return input as T[]
  if (!input || typeof input !== 'object') return []
  const rec = input as Record<string, unknown>
  if (Array.isArray(rec.data)) return rec.data as T[]
  if (Array.isArray(rec.results)) return rec.results as T[]
  if (Array.isArray(rec.products)) return rec.products as T[]
  if (rec.data && typeof rec.data === 'object') {
    const inner = rec.data as Record<string, unknown>
    if (Array.isArray(inner.results)) return inner.results as T[]
    if (Array.isArray(inner.products)) return inner.products as T[]
    if (Array.isArray(inner.data)) return inner.data as T[]
  }
  return []
}

async function backendGet(path: string, params?: Record<string, string | number | undefined>): Promise<unknown> {
  const url = new URL(`${API_BASE}${path}`)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v != null && v !== '') url.searchParams.set(k, String(v))
    }
  }
  const res = await fetch(url.toString(), { cache: 'no-store' })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Backend ${path} failed (${res.status}): ${body || res.statusText}`)
  }
  return res.json().catch(() => ({}))
}

function mapBackendProductToAggregate(row: BackendProductRow): ProductAggregateRow {
  const vendorObj = row.vendor && typeof row.vendor === 'object' ? (row.vendor as Record<string, unknown>) : null
  const vendorId = row.vendor_id ?? row.vendorId ?? vendorObj?.id
  return {
    vendor_id: Number.isFinite(toNumber(vendorId, NaN)) ? toNumber(vendorId, 0) : null,
    category: toStringOrNull(row.category),
    color: toStringOrNull(row.color),
    size: toStringOrNull(row.size),
    image_url: toStringOrNull(row.image_url ?? row.imageUrl ?? row.image_cdn ?? row.imageCdn),
    image_urls: row.image_urls ?? row.imageUrls ?? null,
    variant_id: toStringOrNull(row.variant_id ?? row.variantId),
    parent_product_url: toStringOrNull(row.parent_product_url ?? row.parentProductUrl),
    sales_price_cents: toNumber(row.sales_price_cents ?? row.salesPriceCents, 0) || null,
    last_seen: toStringOrNull(row.last_seen ?? row.lastSeen),
    availability: toBoolOrNull(row.availability),
  }
}

/** Filters that only exist in Supabase or require loading the full mirror into memory. */
function productFiltersNeedSupabaseOnlyMirror(filters: ProductFilters): boolean {
  if (filters.has_issues) return true
  if (filters.missing_category) return true
  if (filters.missing_image_url) return true
  if (filters.missing_variant_id) return true
  if (filters.is_stale) return true
  if (filters.last_seen_after || filters.last_seen_before) return true
  if (filters.has_sale) return true
  if (filters.sale_exceeds_base) return true
  return false
}

/**
 * One page from GET /products or GET /products/search (live catalog).
 * Sort order follows the API (browse/search); Supabase-only filters return null.
 */
async function fetchProductsPageFromBackend(
  filters: ProductFilters,
  pagination: PaginationConfig
): Promise<ProductsQueryResult | null> {
  if (productFiltersNeedSupabaseOnlyMirror(filters)) return null

  const { page, pageSize } = pagination
  const limit = Math.min(100, Math.max(1, pageSize))

  const common: Record<string, string | number | undefined> = {
    page,
    limit,
  }
  if (filters.vendor_id != null && filters.vendor_id !== '')
    common.vendorId = Number(filters.vendor_id)
  if (filters.category) common.category = filters.category
  if (filters.brand) common.brand = filters.brand
  if (filters.color) common.color = filters.color
  if (filters.currency) common.currency = filters.currency
  if (filters.availability !== undefined) common.availability = filters.availability ? 'true' : 'false'
  if (filters.price_min != null) common.minPriceCents = filters.price_min
  if (filters.price_max != null) common.maxPriceCents = filters.price_max

  try {
    if (filters.search && filters.search.trim()) {
      const payload = await backendGet('/products/search', {
        ...common,
        q: filters.search.trim(),
      })
      const rows = extractArray<BackendProductRow>(payload)
      const pag = (payload as Record<string, unknown>).pagination as Record<string, unknown> | undefined
      const total =
        typeof pag?.total === 'number' && Number.isFinite(pag.total)
          ? Math.max(0, Math.trunc(pag.total))
          : rows.length
      const pageNum = typeof pag?.page === 'number' ? pag.page : page
      const pages = typeof pag?.pages === 'number' ? pag.pages : Math.max(1, Math.ceil(total / limit))
      const has_more = pag?.has_more === true || pageNum < pages
      return {
        data: rows.map(mapBackendProductToCatalog),
        total,
        page,
        pageSize,
        has_more,
      }
    }

    const payload = await backendGet('/products', common)
    const rows = extractArray<BackendProductRow>(payload)
    const has_more = backendPaginationHasMore(payload, rows.length, limit)
    const mapped = rows.map(mapBackendProductToCatalog)
    return {
      data: mapped,
      total: (page - 1) * limit + mapped.length,
      page,
      pageSize,
      has_more,
    }
  } catch {
    return null
  }
}

function mapBackendProductToCatalog(row: BackendProductRow): Product {
  const vendorObj = row.vendor && typeof row.vendor === 'object' ? (row.vendor as Record<string, unknown>) : null
  const vendorId = toNumber(row.vendor_id ?? row.vendorId ?? vendorObj?.id, 0)
  const vendorName =
    toStringOrNull(vendorObj?.name) ??
    toStringOrNull(row.vendor_name ?? row.vendorName) ??
    (vendorId ? `Vendor ${vendorId}` : 'Unknown vendor')
  return {
    id: toNumber(row.id, 0),
    vendor_id: vendorId,
    product_url: toStringOrNull(row.product_url ?? row.productUrl) ?? '',
    parent_product_url: toStringOrNull(row.parent_product_url ?? row.parentProductUrl),
    variant_id: toStringOrNull(row.variant_id ?? row.variantId),
    title: toStringOrNull(row.title) ?? 'Untitled product',
    brand: toStringOrNull(row.brand),
    category: toStringOrNull(row.category),
    description: toStringOrNull(row.description),
    size: toStringOrNull(row.size),
    color: toStringOrNull(row.color),
    currency: toStringOrNull(row.currency) ?? 'USD',
    price_cents: toNumber(row.price_cents ?? row.priceCents, 0),
    sales_price_cents: toNumber(row.sales_price_cents ?? row.salesPriceCents, 0) || null,
    availability: toBoolOrNull(row.availability),
    last_seen: toStringOrNull(row.last_seen ?? row.lastSeen),
    image_url: toStringOrNull(row.image_url ?? row.imageUrl),
    image_urls: Array.isArray(row.image_urls ?? row.imageUrls) ? ((row.image_urls ?? row.imageUrls) as string[]) : null,
    image_cdn: toStringOrNull(row.image_cdn ?? row.imageCdn),
    primary_image_id: toNumber(row.primary_image_id ?? row.primaryImageId, 0) || null,
    p_hash: toStringOrNull(row.p_hash ?? row.pHash),
    return_policy: toStringOrNull(row.return_policy ?? row.returnPolicy),
    vendor: {
      id: vendorId,
      name: vendorName,
      url: toStringOrNull(vendorObj?.url) ?? '',
      ship_to_lebanon: Boolean(vendorObj?.ship_to_lebanon ?? vendorObj?.shipToLebanon ?? false),
    },
  }
}

async function fetchAllProductsFromBackend(maxPages = getBackendAggregateMaxPages()): Promise<BackendProductRow[]> {
  const limit = BACKEND_PRODUCT_PAGE_SIZE
  const out: BackendProductRow[] = []
  const cap = Math.max(1, maxPages)
  for (let page = 1; page <= cap; page += 1) {
    const payload = await backendGet('/products', { page, limit })
    const rows = extractArray<BackendProductRow>(payload)
    if (rows.length === 0) break
    out.push(...rows)
    if (!backendPaginationHasMore(payload, rows.length, limit)) break
  }
  return out
}

function isBlank(value: string | null | undefined): boolean {
  return !value || value.trim() === ''
}

function isMissingImageUrls(value: unknown): boolean {
  if (value == null) return true
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'string') return value.trim() === '' || value.trim() === '[]' || value.trim() === '{}'
  if (typeof value === 'object') {
    const entries = Object.keys(value as Record<string, unknown>)
    return entries.length === 0
  }
  return false
}

async function fetchProductAggregateRows(): Promise<ProductAggregateRow[]> {
  const now = Date.now()
  if (aggregateCache.data && aggregateCache.expiresAt > now) {
    return aggregateCache.data
  }
  if (aggregateCache.inFlight) return aggregateCache.inFlight

  aggregateCache.inFlight = (async () => {
    const rows: ProductAggregateRow[] = []
    let from = 0

    while (true) {
      const to = from + BATCH_SIZE - 1
      const { data, error } = await sb
        .from('products')
        .select(`
          vendor_id,
          category,
          color,
          size,
          image_url,
          image_urls,
          variant_id,
          parent_product_url,
          sales_price_cents,
          last_seen,
          availability
        `)
        .range(from, to)

      if (error) {
        const backendRows = await fetchAllProductsFromBackend()
        const mapped = backendRows.map(mapBackendProductToAggregate)
        aggregateCache.data = mapped
        aggregateCache.expiresAt = Date.now() + AGGREGATE_CACHE_TTL_MS
        return mapped
      }

      const batch = (data as ProductAggregateRow[]) ?? []
      rows.push(...batch)

      if (batch.length < BATCH_SIZE) break
      from += BATCH_SIZE
    }

    let chosen = rows
    if (
      catalogAggregateBackendMergeEnabled() &&
      chosen.length < SUPABASE_ROWS_BEFORE_BACKEND_MERGE
    ) {
      try {
        const backendRows = await fetchAllProductsFromBackend()
        const mapped = backendRows.map(mapBackendProductToAggregate)
        if (mapped.length > chosen.length) {
          chosen = mapped
        }
      } catch {
        /* keep Supabase snapshot */
      }
    }

    aggregateCache.data = chosen
    aggregateCache.expiresAt = Date.now() + AGGREGATE_CACHE_TTL_MS
    return chosen
  })()

  try {
    return await aggregateCache.inFlight
  } finally {
    aggregateCache.inFlight = null
  }
}

async function fetchOverviewKPIsFallback(): Promise<OverviewKPIs> {
  const [vendorsRes, rows] = await Promise.all([
    sb.from('vendors').select('id', { count: 'exact', head: true }),
    fetchProductAggregateRows(),
  ])

  const now = Date.now()
  const fallbackVendorCount = new Set(
    rows
      .map((row) => row.vendor_id)
      .filter((id): id is number => typeof id === 'number' && Number.isFinite(id))
  ).size
  const totalVendors =
    vendorsRes.error ? fallbackVendorCount : (vendorsRes.count ?? fallbackVendorCount)

  let available = 0
  let unavailable = 0
  let seenToday = 0
  let updated24h = 0
  let missingCategory = 0
  let missingColor = 0
  let missingSize = 0
  let missingImageUrl = 0
  let missingImageUrls = 0
  let missingVariantId = 0
  let missingParentUrl = 0
  let withSalePrice = 0

  for (const row of rows) {
    if (row.availability === true) available++
    if (row.availability === false) unavailable++
    if (isBlank(row.category)) missingCategory++
    if (isBlank(row.color)) missingColor++
    if (isBlank(row.size)) missingSize++
    if (!row.image_url) missingImageUrl++
    if (isMissingImageUrls(row.image_urls)) missingImageUrls++
    if (isBlank(row.variant_id)) missingVariantId++
    if (isBlank(row.parent_product_url)) missingParentUrl++
    if ((row.sales_price_cents ?? 0) > 0) withSalePrice++

    if (row.last_seen) {
      const ageMs = now - new Date(row.last_seen).getTime()
      if (ageMs <= DAY_MS) {
        seenToday++
        updated24h++
      }
    }
  }

  return {
    total_vendors: totalVendors,
    total_products: rows.length,
    available_products: available,
    unavailable_products: unavailable,
    products_seen_today: seenToday,
    missing_category: missingCategory,
    missing_color: missingColor,
    missing_size: missingSize,
    missing_image_url: missingImageUrl,
    missing_image_urls: missingImageUrls,
    missing_variant_id: missingVariantId,
    missing_parent_url: missingParentUrl,
    with_sale_price: withSalePrice,
    updated_last_24h: updated24h,
  }
}

async function fetchCategoryCountsFallback(): Promise<CategoryCount[]> {
  const rows = await fetchProductAggregateRows()
  const counts = new Map<string, number>()
  for (const row of rows) {
    const category = row.category ?? '(uncategorized)'
    counts.set(category, (counts.get(category) ?? 0) + 1)
  }

  return Array.from(counts.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20)
}

async function fetchVendorProductCountsFallback(): Promise<VendorProductCount[]> {
  const [vendorsRes, rows] = await Promise.all([sb.from('vendors').select('id, name'), fetchProductAggregateRows()])

  const vendorNames = new Map<number, string>()
  if (!vendorsRes.error) {
    for (const vendor of ((vendorsRes.data ?? []) as Array<{ id: number | string; name: string }>)) {
      vendorNames.set(Number(vendor.id), vendor.name)
    }
  }

  const totals = new Map<number, VendorProductCount>()

  for (const row of rows) {
    const vendorId = Number(row.vendor_id)
    const entry = totals.get(vendorId) ?? {
      vendor_name: vendorNames.get(vendorId) ?? `Vendor ${vendorId || 'Unknown'}`,
      total: 0,
      available: 0,
      unavailable: 0,
    }

    entry.total += 1
    if (row.availability === true) entry.available += 1
    if (row.availability === false) entry.unavailable += 1
    totals.set(vendorId, entry)
  }

  for (const [vendorId, vendorName] of vendorNames.entries()) {
    if (!totals.has(vendorId)) {
      totals.set(vendorId, {
        vendor_name: vendorName,
        total: 0,
        available: 0,
        unavailable: 0,
      })
    }
  }

  return Array.from(totals.values()).sort((a, b) => b.total - a.total)
}

async function fetchVendorStatsFallback(): Promise<VendorStats[]> {
  const [vendorsRes, rows] = await Promise.all([
    sb.from('vendors').select('id, name, url, ship_to_lebanon'),
    fetchProductAggregateRows(),
  ])

  const vendorMap = new Map<number, VendorStats>()

  if (!vendorsRes.error) {
    for (const vendor of ((vendorsRes.data ?? []) as Array<{ id: number | string; name: string; url: string; ship_to_lebanon: boolean }>)) {
      vendorMap.set(Number(vendor.id), {
        id: Number(vendor.id),
        name: vendor.name,
        url: vendor.url,
        ship_to_lebanon: vendor.ship_to_lebanon,
        total_products: 0,
        available_products: 0,
        unavailable_products: 0,
        missing_category: 0,
        missing_image_url: 0,
        missing_image_urls: 0,
        missing_variant_id: 0,
        missing_parent_url: 0,
        missing_color: 0,
        missing_size: 0,
        latest_last_seen: null,
        health_score: 0,
      })
    }
  }

  const sevenDaysAgo = Date.now() - 7 * DAY_MS

  for (const row of rows) {
    const vendorId = Number(row.vendor_id)
    if (!vendorMap.has(vendorId)) {
      vendorMap.set(vendorId, {
        id: vendorId,
        name: `Vendor ${vendorId || 'Unknown'}`,
        url: '',
        ship_to_lebanon: false,
        total_products: 0,
        available_products: 0,
        unavailable_products: 0,
        missing_category: 0,
        missing_image_url: 0,
        missing_image_urls: 0,
        missing_variant_id: 0,
        missing_parent_url: 0,
        missing_color: 0,
        missing_size: 0,
        latest_last_seen: null,
        health_score: 0,
      })
    }
    const stats = vendorMap.get(vendorId)!

    stats.total_products += 1
    if (row.availability === true) stats.available_products += 1
    if (row.availability === false) stats.unavailable_products += 1
    if (isBlank(row.category)) stats.missing_category += 1
    if (!row.image_url) stats.missing_image_url += 1
    if (isMissingImageUrls(row.image_urls)) stats.missing_image_urls += 1
    if (isBlank(row.variant_id)) stats.missing_variant_id += 1
    if (isBlank(row.parent_product_url)) stats.missing_parent_url += 1
    if (isBlank(row.color)) stats.missing_color += 1
    if (isBlank(row.size)) stats.missing_size += 1

    if (row.last_seen) {
      if (!stats.latest_last_seen || new Date(row.last_seen) > new Date(stats.latest_last_seen)) {
        stats.latest_last_seen = row.last_seen
      }
    }
  }

  for (const stats of vendorMap.values()) {
    if (stats.total_products === 0) {
      stats.health_score = 0
      continue
    }

    let healthyProducts = 0
    const vendorRows = rows.filter((row) => Number(row.vendor_id) === stats.id)
    for (const row of vendorRows) {
      const isHealthy =
        !!row.image_url &&
        !isBlank(row.category) &&
        !!row.last_seen &&
        new Date(row.last_seen).getTime() >= sevenDaysAgo

      if (isHealthy) healthyProducts += 1
    }

    stats.health_score = Math.round((healthyProducts / stats.total_products) * 100)
  }

  return Array.from(vendorMap.values()).sort((a, b) => b.total_products - a.total_products)
}

async function fetchFreshnessStatsFallback(): Promise<FreshnessStats> {
  const rows = await fetchProductAggregateRows()
  const now = Date.now()
  const stats: FreshnessStats = {
    fresh_count: 0,
    recent_count: 0,
    aging_count: 0,
    stale_count: 0,
  }

  for (const row of rows) {
    if (!row.last_seen) {
      stats.stale_count += 1
      continue
    }

    const ageDays = (now - new Date(row.last_seen).getTime()) / DAY_MS
    if (ageDays < 1) stats.fresh_count += 1
    else if (ageDays < 7) stats.recent_count += 1
    else if (ageDays < 14) stats.aging_count += 1
    else stats.stale_count += 1
  }

  return stats
}

export async function fetchOverviewKPIs(): Promise<OverviewKPIs> {
  return fetchOverviewKPIsFallback()
}

export async function fetchCategoryCounts(): Promise<CategoryCount[]> {
  return fetchCategoryCountsFallback()
}

export async function fetchVendorProductCounts(): Promise<VendorProductCount[]> {
  return fetchVendorProductCountsFallback()
}

export async function fetchVendorStats(): Promise<VendorStats[]> {
  return fetchVendorStatsFallback()
}

export async function fetchProducts(
  filters: ProductFilters = {},
  sort: SortConfig = { field: 'last_seen', direction: 'desc' },
  pagination: PaginationConfig = { page: 1, pageSize: 50 }
): Promise<ProductsQueryResult> {
  const { page, pageSize } = pagination
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  let query = sb
    .from('products')
    .select(
      `
      id, vendor_id, product_url, parent_product_url, variant_id,
      title, brand, category, size, color, currency,
      price_cents, sales_price_cents, availability,
      last_seen, image_url, image_urls, return_policy,
      vendor:vendors(id, name, url, ship_to_lebanon)
    `,
      { count: 'exact' }
    )

  if (filters.search) {
    const term = filters.search.trim()
    query = query.or(`title.ilike.%${term}%,brand.ilike.%${term}%,category.ilike.%${term}%`)
  }

  if (filters.vendor_id) query = query.eq('vendor_id', filters.vendor_id)
  if (filters.category) query = query.eq('category', filters.category)
  if (filters.brand) query = query.ilike('brand', `%${filters.brand}%`)
  if (filters.color) query = query.ilike('color', `%${filters.color}%`)
  if (filters.size) query = query.ilike('size', `%${filters.size}%`)
  if (filters.currency) query = query.eq('currency', filters.currency)
  if (filters.availability !== undefined) query = query.eq('availability', filters.availability)
  if (filters.price_min !== undefined) query = query.gte('price_cents', filters.price_min)
  if (filters.price_max !== undefined) query = query.lte('price_cents', filters.price_max)
  if (filters.last_seen_after) query = query.gte('last_seen', filters.last_seen_after)
  if (filters.last_seen_before) query = query.lte('last_seen', filters.last_seen_before)
  if (filters.has_sale) query = query.not('sales_price_cents', 'is', null)

  if (filters.has_issues) {
    query = query.or(
      [
        'category.is.null',
        'brand.is.null',
        'color.is.null',
        'size.is.null',
        'image_url.is.null',
        'variant_id.is.null',
        'parent_product_url.is.null',
        'return_policy.is.null',
        'price_cents.eq.0',
      ].join(',')
    )
  }

  if (filters.missing_category) query = query.is('category', null)
  if (filters.missing_image_url) query = query.is('image_url', null)
  if (filters.missing_variant_id) query = query.is('variant_id', null)
  if (filters.is_stale) {
    const staleDate = new Date()
    staleDate.setDate(staleDate.getDate() - 14)
    query = query.lt('last_seen', staleDate.toISOString())
  }

  query = query.order(sort.field, { ascending: sort.direction === 'asc' }).range(from, to)

  const { data, error, count } = await query
  if (!error) {
    const rows = (data as unknown as Product[]) ?? []
    const total = count ?? 0
    const preferBackend =
      catalogAggregateBackendMergeEnabled() &&
      total > 0 &&
      total < SUPABASE_ROWS_BEFORE_BACKEND_MERGE &&
      !productFiltersNeedSupabaseOnlyMirror(filters)

    if (preferBackend) {
      const live = await fetchProductsPageFromBackend(filters, pagination)
      if (live && live.data.length > 0) {
        return live
      }
    }

    /** Shop traffic often hits the Node API + Postgres; admin Supabase can be empty or another env. */
    if (total > 0 || rows.length > 0) {
      return {
        data: rows,
        total,
        page,
        pageSize,
      }
    }
  }

  const all = (await fetchAllProductsFromBackend()).map(mapBackendProductToCatalog)
  const staleCutoff = Date.now() - 14 * DAY_MS
  const filtered = all.filter((p) => {
    if (filters.search) {
      const term = filters.search.toLowerCase()
      const hay = `${p.title} ${p.brand ?? ''} ${p.category ?? ''}`.toLowerCase()
      if (!hay.includes(term)) return false
    }
    if (filters.vendor_id != null && String(p.vendor_id) !== String(filters.vendor_id)) return false
    if (filters.category && p.category !== filters.category) return false
    if (filters.brand && !(p.brand ?? '').toLowerCase().includes(filters.brand.toLowerCase())) return false
    if (filters.color && !(p.color ?? '').toLowerCase().includes(filters.color.toLowerCase())) return false
    if (filters.availability !== undefined && p.availability !== filters.availability) return false
    if (filters.has_sale && !((p.sales_price_cents ?? 0) > 0)) return false
    if (filters.missing_category && !isBlank(p.category)) return false
    if (filters.missing_image_url && p.image_url) return false
    if (filters.missing_variant_id && !isBlank(p.variant_id)) return false
    if (filters.is_stale) {
      const ts = p.last_seen ? new Date(p.last_seen).getTime() : 0
      if (!ts || ts >= staleCutoff) return false
    }
    if (filters.has_issues) {
      const hasIssues =
        isBlank(p.category) ||
        isBlank(p.brand) ||
        isBlank(p.color) ||
        isBlank(p.size) ||
        !p.image_url ||
        isBlank(p.variant_id) ||
        isBlank(p.parent_product_url) ||
        isBlank(p.return_policy) ||
        (p.price_cents ?? 0) === 0
      if (!hasIssues) return false
    }
    return true
  })

  const sortDir = sort.direction === 'asc' ? 1 : -1
  filtered.sort((a, b) => {
    const av = (a as unknown as Record<string, unknown>)[sort.field]
    const bv = (b as unknown as Record<string, unknown>)[sort.field]
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sortDir
    return String(av).localeCompare(String(bv)) * sortDir
  })

  const total = filtered.length
  const paged = filtered.slice(from, to + 1)
  return { data: paged, total, page, pageSize }
}

export async function fetchPriceHistory(productId: string | number): Promise<PriceHistory[]> {
  const { data, error } = await sb
    .from('price_history')
    .select('*')
    .eq('product_id', productId)
    .order('recorded_at', { ascending: true })

  if (error) throw error
  return (data as unknown as PriceHistory[]) ?? []
}

/** Shop API price-drop events — used when Supabase `price_history` is missing or yields no derived changes. */
async function fetchPriceChangeEventsFromBackend(limit: number): Promise<PriceChangeEvent[]> {
  try {
    const payload = await backendGet('/products/price-drops', { page: 1, limit })
    const drops = extractArray<Record<string, unknown>>(payload)
    return drops
      .map((row) => ({
        product_id: toNumber(row.product_id ?? row.productId ?? row.id, 0),
        product_title: toStringOrNull(row.title ?? row.product_title ?? row.productTitle) ?? 'Untitled product',
        vendor_name: toStringOrNull(row.vendor_name ?? row.vendorName ?? row.brand) ?? 'Unknown vendor',
        image_url: toStringOrNull(row.image_url ?? row.imageUrl ?? row.image_cdn ?? row.imageCdn),
        old_price: toNumber(row.old_price_cents ?? row.old_price ?? row.oldPriceCents, 0),
        new_price: toNumber(row.new_price_cents ?? row.new_price ?? row.newPriceCents, 0),
        change_pct: toNumber(row.drop_percent ?? row.change_pct ?? row.changePct, 0) * -1,
        recorded_at: toStringOrNull(row.detected_at ?? row.recorded_at ?? row.recordedAt) ?? new Date().toISOString(),
        is_discount: true,
      }))
      .filter((e) => e.product_id > 0 && (e.old_price > 0 || e.new_price > 0))
      .sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime())
      .slice(0, limit)
  } catch {
    return []
  }
}

async function fetchCurrentSaleProductsFromBackend(limit: number): Promise<CurrentSaleProduct[]> {
  try {
    const payload = await backendGet('/products/sales', { page: 1, limit })
    const sales = extractArray<Record<string, unknown>>(payload)
    return sales
      .map((row) => {
        const price = toNumber(row.price_cents ?? row.priceCents, 0)
        const sale = toNumber(row.sales_price_cents ?? row.salesPriceCents, 0)
        return {
          product_id: toNumber(row.id ?? row.product_id ?? row.productId, 0),
          product_title: toStringOrNull(row.title ?? row.product_title ?? row.productTitle) ?? 'Untitled product',
          vendor_name: toStringOrNull(row.vendor_name ?? row.vendorName) ?? 'Unknown vendor',
          image_url: toStringOrNull(row.image_url ?? row.imageUrl ?? row.image_cdn ?? row.imageCdn),
          price_cents: price,
          sales_price_cents: sale,
          discount_pct: price > 0 && sale > 0 ? Math.round(((price - sale) / price) * 100) : 0,
          last_seen: toStringOrNull(row.last_seen ?? row.lastSeen),
        }
      })
      .filter((row) => row.price_cents > 0 && row.sales_price_cents > 0 && row.sales_price_cents < row.price_cents)
      .sort((a, b) => {
        if (b.discount_pct !== a.discount_pct) return b.discount_pct - a.discount_pct
        return (new Date(b.last_seen ?? 0).getTime()) - (new Date(a.last_seen ?? 0).getTime())
      })
      .slice(0, limit)
  } catch {
    return []
  }
}

async function fetchRecentPriceChangesFallback(limit = 50) {
  const fromDate = new Date()
  fromDate.setDate(fromDate.getDate() - 30)

  type RawHistoryRow = {
    product_id: number
    price_cents: number
    recorded_at: string
    product?: {
      title?: string | null
      image_url?: string | null
      vendor?: { name?: string | null } | Array<{ name?: string | null }>
    } | null
  }

  const data: RawHistoryRow[] = []
  let from = 0

  while (true) {
    const to = from + BATCH_SIZE - 1
    const { data: batchData, error } = await sb
      .from('price_history')
      .select(`
        product_id,
        price_cents,
        recorded_at,
        product:products(
          title,
          image_url,
          vendor:vendors(name)
        )
      `)
      .gte('recorded_at', fromDate.toISOString())
      .order('recorded_at', { ascending: true })
      .range(from, to)

    if (error) {
      return fetchPriceChangeEventsFromBackend(limit)
    }

    const batch = (batchData as RawHistoryRow[]) ?? []
    data.push(...batch)

    if (batch.length < BATCH_SIZE) break
    from += BATCH_SIZE
  }

  const byProduct = new Map<number, RawHistoryRow[]>()
  for (const row of data) {
    const bucket = byProduct.get(row.product_id) ?? []
    bucket.push(row)
    byProduct.set(row.product_id, bucket)
  }

  const events: PriceChangeEvent[] = []

  for (const [productId, rows] of byProduct.entries()) {
    rows.sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime())

    for (let i = 1; i < rows.length; i += 1) {
      const previous = rows[i - 1]
      const current = rows[i]
      if (previous.price_cents === current.price_cents) continue

      const vendorField = current.product?.vendor
      const vendorName = Array.isArray(vendorField)
        ? vendorField[0]?.name ?? 'Unknown vendor'
        : vendorField?.name ?? 'Unknown vendor'

      events.push({
        product_id: productId,
        product_title: current.product?.title ?? 'Untitled product',
        vendor_name: vendorName,
        image_url: current.product?.image_url ?? null,
        old_price: previous.price_cents,
        new_price: current.price_cents,
        change_pct: previous.price_cents
          ? Number((((current.price_cents - previous.price_cents) / previous.price_cents) * 100).toFixed(1))
          : 0,
        recorded_at: current.recorded_at,
        is_discount: current.price_cents < previous.price_cents,
      })
    }
  }

  const sorted = events
    .sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime())
    .slice(0, limit)
  if (sorted.length > 0) return sorted
  return fetchPriceChangeEventsFromBackend(limit)
}

export async function fetchRecentPriceChanges(limit = 50) {
  return fetchRecentPriceChangesFallback(limit)
}

async function fetchCurrentSaleProductsFallback(limit = 20): Promise<CurrentSaleProduct[]> {
  type RawSaleRow = {
    id: number
    title: string | null
    image_url: string | null
    price_cents: number | null
    sales_price_cents: number | null
    last_seen: string | null
    vendor?: { name?: string | null } | Array<{ name?: string | null }>
  }

  const rows: RawSaleRow[] = []
  let from = 0

  while (true) {
    const to = from + BATCH_SIZE - 1
    const { data, error } = await sb
      .from('products')
      .select(`
        id,
        title,
        image_url,
        price_cents,
        sales_price_cents,
        last_seen,
        vendor:vendors(name)
      `)
      .not('sales_price_cents', 'is', null)
      .range(from, to)

    if (error) {
      return fetchCurrentSaleProductsFromBackend(limit)
    }

    const batch = (data as RawSaleRow[]) ?? []
    rows.push(...batch)

    if (batch.length < BATCH_SIZE) break
    from += BATCH_SIZE
  }

  const result = rows
    .filter((row) => (row.price_cents ?? 0) > 0 && (row.sales_price_cents ?? 0) > 0 && (row.sales_price_cents ?? 0) < (row.price_cents ?? 0))
    .map((row) => {
      const vendorField = row.vendor
      const vendorName = Array.isArray(vendorField)
        ? vendorField[0]?.name ?? 'Unknown vendor'
        : vendorField?.name ?? 'Unknown vendor'

      return {
        product_id: row.id,
        product_title: row.title ?? 'Untitled product',
        vendor_name: vendorName,
        image_url: row.image_url ?? null,
        price_cents: row.price_cents ?? 0,
        sales_price_cents: row.sales_price_cents ?? 0,
        discount_pct: Math.round((((row.price_cents ?? 0) - (row.sales_price_cents ?? 0)) / (row.price_cents ?? 1)) * 100),
        last_seen: row.last_seen ?? null,
      }
    })
    .sort((a, b) => {
      if (b.discount_pct !== a.discount_pct) return b.discount_pct - a.discount_pct
      return (new Date(b.last_seen ?? 0).getTime()) - (new Date(a.last_seen ?? 0).getTime())
    })
    .slice(0, limit)

  if (result.length > 0) return result
  return fetchCurrentSaleProductsFromBackend(limit)
}

async function fetchDailyPriceVolumeFallback(daysBack = 30): Promise<DailyScrapeStat[]> {
  const events = await fetchRecentPriceChangesFallback(100000)
  const counts = new Map<string, number>()
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - daysBack)

  for (const event of events) {
    if (new Date(event.recorded_at) < cutoff) continue
    const key = event.recorded_at.slice(0, 10)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  return Array.from(counts.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

export async function fetchDailyPriceVolume(): Promise<DailyScrapeStat[]> {
  return fetchDailyPriceVolumeFallback(30)
}

export async function fetchCurrentSaleProducts(limit = 20): Promise<CurrentSaleProduct[]> {
  return fetchCurrentSaleProductsFallback(limit)
}

export async function fetchFreshnessStats(): Promise<FreshnessStats> {
  return fetchFreshnessStatsFallback()
}

export async function fetchVendorFreshness(): Promise<VendorFreshness[]> {
  const [vendorsRes, rows] = await Promise.all([
    sb.from('vendors').select('id, name'),
    fetchProductAggregateRows(),
  ])

  // Names from `vendors` when allowed (same pattern as fetchOverviewKPIsFallback). If this query
  // fails (RLS, schema drift), we still break down freshness by vendor_id from product rows alone.
  const vendorNames = new Map<string, string>()
  if (!vendorsRes.error && vendorsRes.data) {
    for (const vendor of (vendorsRes.data as Array<{ id: number | string; name: string }>)) {
      vendorNames.set(String(vendor.id), vendor.name ?? String(vendor.id))
    }
  }

  const now = Date.now()
  const map = new Map<
    string,
    { name: string; fresh: number; recent: number; aging: number; stale: number; last: number }
  >()

  for (const row of rows) {
    const vendorId =
      row.vendor_id != null && Number.isFinite(Number(row.vendor_id))
        ? String(row.vendor_id)
        : '__none__'
    const name =
      vendorId === '__none__'
        ? 'Unknown vendor'
        : vendorNames.get(vendorId) ?? `Vendor ${vendorId}`
    if (!map.has(vendorId)) {
      map.set(vendorId, { name, fresh: 0, recent: 0, aging: 0, stale: 0, last: 0 })
    }

    const entry = map.get(vendorId)!
    const ageDays = row.last_seen ? (now - new Date(row.last_seen).getTime()) / DAY_MS : 999

    if (ageDays < 1) entry.fresh += 1
    else if (ageDays < 7) entry.recent += 1
    else if (ageDays < 14) entry.aging += 1
    else entry.stale += 1

    if (row.last_seen) {
      entry.last = Math.max(entry.last, new Date(row.last_seen).getTime())
    }
  }

  const out: VendorFreshness[] = Array.from(map.entries()).map(([vendor_id, entry]) => {
    const product_count = entry.fresh + entry.recent + entry.aging + entry.stale
    const denom = Math.max(1, product_count)
    return {
      vendor_id,
      vendor_name: entry.name,
      product_count,
      fresh_pct: Math.round((entry.fresh / denom) * 100),
      recent_pct: Math.round((entry.recent / denom) * 100),
      aging_pct: Math.round((entry.aging / denom) * 100),
      stale_pct: Math.round((entry.stale / denom) * 100),
      last_scrape: entry.last ? new Date(entry.last).toISOString() : null,
    }
  })

  out.sort((a, b) => b.product_count - a.product_count)
  return out
}

export async function fetchDistinctCategories(): Promise<string[]> {
  const rows = await fetchProductAggregateRows()
  return Array.from(new Set(rows.map((row) => row.category).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b))
}

export async function fetchDistinctVendors(): Promise<Array<{ id: number; name: string }>> {
  const byId = new Map<number, string>()

  const { data, error } = await sb
    .from('vendors')
    .select('id, name')
    .order('name')

  if (!error && data) {
    for (const vendor of data as Array<{ id: number; name: string }>) {
      const id = Number(vendor.id)
      if (Number.isFinite(id) && vendor.name) byId.set(id, vendor.name)
    }
  }

  const rows = await fetchProductAggregateRows()
  for (const row of rows) {
    const id = Number(row.vendor_id)
    if (!Number.isFinite(id) || byId.has(id)) continue
    byId.set(id, `Vendor ${id}`)
  }

  const out = Array.from(byId.entries()).map(([id, name]) => ({ id, name }))
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}
