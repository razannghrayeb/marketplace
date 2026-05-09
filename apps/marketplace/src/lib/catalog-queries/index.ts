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
const SLOW_QUERY_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes — slow COUNT queries cached server-side

type CacheEntry<T> = { data: T; expiresAt: number; inFlight?: Promise<T> }

function makeCache<T>() {
  let entry: CacheEntry<T> | null = null
  return {
    get: () => (entry && entry.expiresAt > Date.now() ? entry.data : null),
    getInflight: () => entry?.inFlight ?? null,
    set: (data: T) => { entry = { data, expiresAt: Date.now() + SLOW_QUERY_CACHE_TTL_MS } },
    setInflight: (p: Promise<T>) => { if (!entry) { entry = { data: null as unknown as T, expiresAt: 0, inFlight: p } } else { entry.inFlight = p } },
    clearInflight: () => { if (entry) entry.inFlight = undefined },
  }
}

const _overviewCache = makeCache<import('@/types/catalog-admin').OverviewKPIs>()
const _vendorStatsCache = makeCache<import('@/types/catalog-admin').VendorStats[]>()
const _vendorCountsCache = makeCache<import('@/types/catalog-admin').VendorProductCount[]>()
const _freshnessCache = makeCache<import('@/types/catalog-admin').FreshnessStats>()
const _catCountsCache = makeCache<import('@/types/catalog-admin').CategoryCount[]>()
const _vendorFreshnessCache = makeCache<import('@/types/catalog-admin').VendorFreshness[]>()

const EXCLUDED_VENDOR_NAMES = ['H&M']

let _excludedVendorIds: Promise<number[]> | null = null
async function getExcludedVendorIds(): Promise<number[]> {
  if (EXCLUDED_VENDOR_NAMES.length === 0) return []
  if (!_excludedVendorIds) {
    _excludedVendorIds = (async () => {
      const { data } = await sb.from('vendors').select('id').in('name', EXCLUDED_VENDOR_NAMES)
      return (data ?? []).map((v: { id: number }) => Number(v.id)).filter(Number.isFinite)
    })()
  }
  return _excludedVendorIds!
}

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

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'https://marketplace-96918972071.asia-southeast1.run.app').replace(/\/+$/, '')

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

async function sbRestCount(table: string, params: Record<string, string> = {}): Promise<number> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || ''
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  if (!supabaseUrl || !serviceKey) return 0
  const url = new URL(`${supabaseUrl}/rest/v1/${table}`)
  url.searchParams.set('select', 'id')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url.toString(), {
    method: 'HEAD',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Prefer: 'count=exact',
    },
    cache: 'no-store',
  })
  const range = res.headers.get('content-range') ?? ''
  const match = range.match(/\/(\d+)$/)
  return match ? parseInt(match[1], 10) : 0
}

async function fetchOverviewKPIsFallback(): Promise<OverviewKPIs> {
  const cached = _overviewCache.get()
  if (cached) return cached
  const inflight = _overviewCache.getInflight()
  if (inflight) return inflight

  const promise = (async () => {
    const since24h = new Date(Date.now() - DAY_MS).toISOString()
    const excludedIds = await getExcludedVendorIds()
    const exStr = excludedIds.length > 0 ? `(${excludedIds.join(',')})` : null

    const pq = (q: ReturnType<typeof sb.from>) =>
      exStr ? q.not('vendor_id', 'in', exStr) : q

    const vendorExclude = EXCLUDED_VENDOR_NAMES.map(n => `"${n}"`).join(',')
    const vendorIdExclude = exStr ? `not.in.${exStr}` : undefined

    const [
      totalVendors, totalProducts, availableProducts, unavailableProducts,
      seenToday, missingCategoryRes, missingColorRes, missingSizeRes,
      missingImageUrlRes, missingVariantIdRes, missingParentUrlRes, withSalePriceRes,
    ] = await Promise.all([
      sbRestCount('vendors', vendorExclude ? { 'name': `not.in.(${vendorExclude})` } : {}),
      sbRestCount('products', vendorIdExclude ? { vendor_id: vendorIdExclude } : {}),
      sbRestCount('products', { availability: 'eq.true', ...(vendorIdExclude ? { vendor_id: vendorIdExclude } : {}) }),
      sbRestCount('products', { availability: 'eq.false', ...(vendorIdExclude ? { vendor_id: vendorIdExclude } : {}) }),
      sbRestCount('products', { last_seen: `gte.${since24h}`, ...(vendorIdExclude ? { vendor_id: vendorIdExclude } : {}) }),
      pq(sb.from('products').select('*', { count: 'exact', head: true })).is('category', null),
      pq(sb.from('products').select('*', { count: 'exact', head: true })).is('color', null),
      pq(sb.from('products').select('*', { count: 'exact', head: true })).is('size', null),
      pq(sb.from('products').select('*', { count: 'exact', head: true })).is('image_url', null),
      pq(sb.from('products').select('*', { count: 'exact', head: true })).is('variant_id', null),
      pq(sb.from('products').select('*', { count: 'exact', head: true })).is('parent_product_url', null),
      sbRestCount('products', { sales_price_cents: 'not.is.null', ...(vendorIdExclude ? { vendor_id: vendorIdExclude } : {}) }),
    ])

    const result: OverviewKPIs = {
      total_vendors: totalVendors,
      total_products: totalProducts,
      available_products: availableProducts,
      unavailable_products: unavailableProducts,
      products_seen_today: seenToday,
      missing_category: missingCategoryRes.count ?? 0,
      missing_color: missingColorRes.count ?? 0,
      missing_size: missingSizeRes.count ?? 0,
      missing_image_url: missingImageUrlRes.count ?? 0,
      missing_image_urls: missingImageUrlRes.count ?? 0,
      missing_variant_id: missingVariantIdRes.count ?? 0,
      missing_parent_url: missingParentUrlRes.count ?? 0,
      with_sale_price: withSalePriceRes,
      updated_last_24h: seenToday,
    }
    _overviewCache.set(result)
    return result
  })()

  _overviewCache.setInflight(promise)
  try {
    return await promise
  } finally {
    _overviewCache.clearInflight()
  }
}

async function fetchCategoryCountsFallback(): Promise<CategoryCount[]> {
  const cached = _catCountsCache.get()
  if (cached) return cached
  const inflight = _catCountsCache.getInflight()
  if (inflight) return inflight

  const promise = (async () => {
    const excludedIds = await getExcludedVendorIds()
    const exStr = excludedIds.length > 0 ? `(${excludedIds.join(',')})` : null

    const counts = new Map<string, number>()
    let from = 0
    while (true) {
      let q = sb.from('products').select('category').range(from, from + BATCH_SIZE - 1)
      if (exStr) q = q.not('vendor_id', 'in', exStr)
      const { data, error } = await q
      if (error || !data || data.length === 0) break
      for (const row of data as Array<{ category: string | null }>) {
        const cat = row.category ?? '(uncategorized)'
        counts.set(cat, (counts.get(cat) ?? 0) + 1)
      }
      if (data.length < BATCH_SIZE) break
      from += BATCH_SIZE
    }
    const result = Array.from(counts.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20)
    _catCountsCache.set(result)
    return result
  })()

  _catCountsCache.setInflight(promise)
  try {
    return await promise
  } finally {
    _catCountsCache.clearInflight()
  }
}

async function fetchVendorProductCountsFallback(): Promise<VendorProductCount[]> {
  const cached = _vendorCountsCache.get()
  if (cached) return cached
  const inflight = _vendorCountsCache.getInflight()
  if (inflight) return inflight

  const promise = (async () => {
    const [vendorsRes, statsRes] = await Promise.all([
      sb.from('vendors').select('id, name')
        .not('name', 'in', `(${EXCLUDED_VENDOR_NAMES.map(n => `"${n}"`).join(',')})`),
      sb.rpc('get_vendor_stats'),
    ])
    if (vendorsRes.error || !vendorsRes.data) return []

    type StatRow = { vendor_id: number; total: number; available: number }
    const statsMap = new Map<number, StatRow>()
    for (const row of ((statsRes.data ?? []) as StatRow[])) {
      statsMap.set(Number(row.vendor_id), row)
    }

    const result = (vendorsRes.data as Array<{ id: number; name: string }>)
      .map((v) => {
        const s = statsMap.get(v.id)
        const total = Number(s?.total ?? 0)
        const available = Number(s?.available ?? 0)
        return { vendor_name: v.name, total, available, unavailable: total - available }
      })
      .filter((v) => v.total > 0)
      .sort((a, b) => b.total - a.total)

    _vendorCountsCache.set(result)
    return result
  })()

  _vendorCountsCache.setInflight(promise)
  try {
    return await promise
  } finally {
    _vendorCountsCache.clearInflight()
  }
}

async function fetchVendorStatsFallback(): Promise<VendorStats[]> {
  const cached = _vendorStatsCache.get()
  if (cached) return cached
  const inflight = _vendorStatsCache.getInflight()
  if (inflight) return inflight

  const promise = (async () => {
    const [vendorsRes, statsRes] = await Promise.all([
      sb.from('vendors').select('id, name, url, ship_to_lebanon')
        .not('name', 'in', `(${EXCLUDED_VENDOR_NAMES.map(n => `"${n}"`).join(',')})`),
      sb.rpc('get_vendor_stats').then(r => r).catch(() => ({ data: null, error: new Error('timeout') })),
    ])

    if (vendorsRes.error || !vendorsRes.data) return []

    const vendors = vendorsRes.data as Array<{ id: number; name: string; url: string; ship_to_lebanon: boolean }>
    type StatRow = { vendor_id: number; total: number; available: number; missing_category: number; missing_image_url: number; missing_image_urls: number; missing_variant_id: number; missing_parent_url: number; missing_color: number; missing_size: number; healthy: number; latest_last_seen: string | null }
    const statsMap = new Map<number, StatRow>()
    const hasStats = !statsRes.error && Array.isArray(statsRes.data) && statsRes.data.length > 0
    for (const row of ((statsRes.data ?? []) as StatRow[])) {
      statsMap.set(Number(row.vendor_id), row)
    }

    const result = vendors
      .map((vendor) => {
        const s = statsMap.get(vendor.id)
        const total = Number(s?.total ?? 0)
        const available = Number(s?.available ?? 0)
        const healthy = Number(s?.healthy ?? 0)
        return {
          id: vendor.id,
          name: vendor.name,
          url: vendor.url,
          ship_to_lebanon: vendor.ship_to_lebanon,
          total_products: total,
          available_products: available,
          unavailable_products: total - available,
          missing_category: Number(s?.missing_category ?? 0),
          missing_image_url: Number(s?.missing_image_url ?? 0),
          missing_image_urls: Number(s?.missing_image_urls ?? 0),
          missing_variant_id: Number(s?.missing_variant_id ?? 0),
          missing_parent_url: Number(s?.missing_parent_url ?? 0),
          missing_color: Number(s?.missing_color ?? 0),
          missing_size: Number(s?.missing_size ?? 0),
          latest_last_seen: s?.latest_last_seen ?? null,
          health_score: total > 0 ? Math.round((healthy / total) * 100) : 0,
        }
      })
      .filter((v) => !hasStats || v.total_products > 0)
      .sort((a, b) => b.total_products - a.total_products)

    _vendorStatsCache.set(result)
    return result
  })()

  _vendorStatsCache.setInflight(promise)
  try {
    return await promise
  } finally {
    _vendorStatsCache.clearInflight()
  }
}

async function fetchFreshnessStatsFallback(): Promise<FreshnessStats> {
  const cached = _freshnessCache.get()
  if (cached) return cached
  const inflight = _freshnessCache.getInflight()
  if (inflight) return inflight

  const promise = (async () => {
    const now = Date.now()
    const freshCut = new Date(now - DAY_MS).toISOString()
    const recentCut = new Date(now - 7 * DAY_MS).toISOString()
    const agingCut = new Date(now - 14 * DAY_MS).toISOString()
    const excludedIds = await getExcludedVendorIds()
    const exStr = excludedIds.length > 0 ? `(${excludedIds.join(',')})` : null

    const pq = (q: ReturnType<typeof sb.from>) =>
      exStr ? q.not('vendor_id', 'in', exStr) : q

    const [freshRes, recentRes, agingRes, staleRes] = await Promise.all([
      pq(sb.from('products').select('*', { count: 'exact', head: true })).gte('last_seen', freshCut),
      pq(sb.from('products').select('*', { count: 'exact', head: true })).gte('last_seen', recentCut).lt('last_seen', freshCut),
      pq(sb.from('products').select('*', { count: 'exact', head: true })).gte('last_seen', agingCut).lt('last_seen', recentCut),
      pq(sb.from('products').select('*', { count: 'exact', head: true })).lt('last_seen', agingCut),
    ])

    const result: FreshnessStats = {
      fresh_count: freshRes.count ?? 0,
      recent_count: recentRes.count ?? 0,
      aging_count: agingRes.count ?? 0,
      stale_count: staleRes.count ?? 0,
    }
    _freshnessCache.set(result)
    return result
  })()

  _freshnessCache.setInflight(promise)
  try {
    return await promise
  } finally {
    _freshnessCache.clearInflight()
  }
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

  const excludedIds = await getExcludedVendorIds()
  if (excludedIds.length > 0 && !filters.vendor_id) {
    query = query.not('vendor_id', 'in', `(${excludedIds.join(',')})`)
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
    sales_price_cents: number | null
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
        sales_price_cents,
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

      // Use effective price: sale price if active, otherwise regular price
      const prevEffective = (previous.sales_price_cents && previous.sales_price_cents > 0)
        ? previous.sales_price_cents
        : previous.price_cents
      const currEffective = (current.sales_price_cents && current.sales_price_cents > 0)
        ? current.sales_price_cents
        : current.price_cents

      if (prevEffective === currEffective) continue
      if (currEffective <= 0 || prevEffective <= 0) continue

      const vendorField = current.product?.vendor
      const vendorName = Array.isArray(vendorField)
        ? vendorField[0]?.name ?? 'Unknown vendor'
        : vendorField?.name ?? 'Unknown vendor'

      events.push({
        product_id: productId,
        product_title: current.product?.title ?? 'Untitled product',
        vendor_name: vendorName,
        image_url: current.product?.image_url ?? null,
        old_price: prevEffective,
        new_price: currEffective,
        change_pct: Number((((currEffective - prevEffective) / prevEffective) * 100).toFixed(1)),
        recorded_at: current.recorded_at,
        is_discount: currEffective < prevEffective,
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

  const excludedIds = await getExcludedVendorIds()
  let saleQuery = sb
    .from('products')
    .select(`id, title, image_url, price_cents, sales_price_cents, last_seen, vendor:vendors(name)`)
    .not('sales_price_cents', 'is', null)
    .gt('price_cents', 0)
    .order('last_seen', { ascending: false })
    .limit(limit * 10)
  if (excludedIds.length > 0) saleQuery = saleQuery.not('vendor_id', 'in', `(${excludedIds.join(',')})`)
  const { data, error } = await saleQuery

  if (error) return fetchCurrentSaleProductsFromBackend(limit)

  const result = ((data as RawSaleRow[]) ?? [])
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
  const cached = _vendorFreshnessCache.get()
  if (cached) return cached
  const inflight = _vendorFreshnessCache.getInflight()
  if (inflight) return inflight

  const promise = (async () => {
    const now = Date.now()
    const freshCut = new Date(now - DAY_MS).toISOString()
    const recentCut = new Date(now - 7 * DAY_MS).toISOString()
    const agingCut = new Date(now - 14 * DAY_MS).toISOString()

    const vendorsRes = await sb
      .from('vendors')
      .select('id, name')
      .not('name', 'in', `(${EXCLUDED_VENDOR_NAMES.map(n => `"${n}"`).join(',')})`)
    if (vendorsRes.error || !vendorsRes.data?.length) return []

    const vendors = vendorsRes.data as Array<{ id: number | string; name: string }>

    const results = await Promise.all(
      vendors.map(async (vendor) => {
        const vid = vendor.id
        const [freshRes, recentRes, agingRes, staleRes, lastRes] = await Promise.all([
          sb.from('products').select('*', { count: 'exact', head: true }).eq('vendor_id', vid).gte('last_seen', freshCut),
          sb.from('products').select('*', { count: 'exact', head: true }).eq('vendor_id', vid).gte('last_seen', recentCut).lt('last_seen', freshCut),
          sb.from('products').select('*', { count: 'exact', head: true }).eq('vendor_id', vid).gte('last_seen', agingCut).lt('last_seen', recentCut),
          sb.from('products').select('*', { count: 'exact', head: true }).eq('vendor_id', vid).lt('last_seen', agingCut),
          sb.from('products').select('last_seen').eq('vendor_id', vid).not('last_seen', 'is', null).order('last_seen', { ascending: false }).limit(1),
        ])

        const fresh = freshRes.count ?? 0
        const recent = recentRes.count ?? 0
        const aging = agingRes.count ?? 0
        const stale = staleRes.count ?? 0
        const product_count = fresh + recent + aging + stale
        const denom = Math.max(1, product_count)
        const lastRow = lastRes.data?.[0] as { last_seen: string } | undefined

        return {
          vendor_id: String(vid),
          vendor_name: vendor.name ?? String(vid),
          product_count,
          fresh_pct: Math.round((fresh / denom) * 100),
          recent_pct: Math.round((recent / denom) * 100),
          aging_pct: Math.round((aging / denom) * 100),
          stale_pct: Math.round((stale / denom) * 100),
          last_scrape: lastRow?.last_seen ?? null,
        }
      })
    )

    const result = results
      .filter((v) => v.product_count > 0)
      .sort((a, b) => b.product_count - a.product_count)
    _vendorFreshnessCache.set(result)
    return result
  })()

  _vendorFreshnessCache.setInflight(promise)
  try {
    return await promise
  } finally {
    _vendorFreshnessCache.clearInflight()
  }
}

export async function fetchDistinctCategories(): Promise<string[]> {
  const excludedIds = await getExcludedVendorIds()
  const exStr = excludedIds.length > 0 ? `(${excludedIds.join(',')})` : null

  const categories = new Set<string>()
  let from = 0
  while (true) {
    const to = from + BATCH_SIZE - 1
    const baseQ = sb.from('products').select('category').not('category', 'is', null).range(from, to)
    const res = await (exStr ? baseQ.not('vendor_id', 'in', exStr) : baseQ)
    const data = res.data as Array<{ category: string | null }> | null
    const error = res.error
    if (error || !data?.length) break
    for (const row of data) {
      if (row.category) categories.add(row.category)
    }
    if (data.length < BATCH_SIZE) break
    from += BATCH_SIZE
  }
  return Array.from(categories).sort((a, b) => a.localeCompare(b))
}

export async function fetchDistinctVendors(): Promise<Array<{ id: number; name: string }>> {
  const { data, error } = await sb
    .from('vendors')
    .select('id, name')
    .not('name', 'in', `(${EXCLUDED_VENDOR_NAMES.map(n => `"${n}"`).join(',')})`)
    .order('name')
  if (error || !data) return []
  return (data as Array<{ id: number; name: string }>)
    .filter((v) => Number.isFinite(Number(v.id)) && !!v.name)
    .map((v) => ({ id: Number(v.id), name: v.name }))
}
