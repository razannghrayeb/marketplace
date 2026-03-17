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
} from '../../types'

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

    if (error) throw error

    const batch = (data as ProductAggregateRow[]) ?? []
    rows.push(...batch)

    if (batch.length < BATCH_SIZE) break
    from += BATCH_SIZE
  }

  return rows
}

async function fetchOverviewKPIsFallback(): Promise<OverviewKPIs> {
  const [vendorsRes, rows] = await Promise.all([
    sb.from('vendors').select('id', { count: 'exact', head: true }),
    fetchProductAggregateRows(),
  ])

  if (vendorsRes.error) throw vendorsRes.error

  const now = Date.now()
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
    total_vendors: vendorsRes.count ?? 0,
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
  const [vendorsRes, rows] = await Promise.all([
    sb.from('vendors').select('id, name'),
    fetchProductAggregateRows(),
  ])

  if (vendorsRes.error) throw vendorsRes.error

  const vendorNames = new Map<number, string>()
  for (const vendor of ((vendorsRes.data ?? []) as Array<{ id: number | string; name: string }>)) {
    vendorNames.set(Number(vendor.id), vendor.name)
  }

  const totals = new Map<number, VendorProductCount>()

  for (const row of rows) {
    const vendorId = Number(row.vendor_id)
    const entry = totals.get(vendorId) ?? {
      vendor_name: vendorNames.get(vendorId) ?? `Vendor ${vendorId}`,
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

  if (vendorsRes.error) throw vendorsRes.error

  const vendorMap = new Map<number, VendorStats>()

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

  const sevenDaysAgo = Date.now() - 7 * DAY_MS

  for (const row of rows) {
    const vendorId = Number(row.vendor_id)
    const stats = vendorMap.get(vendorId)
    if (!stats) continue

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
  if (error) throw error

  return {
    data: (data as unknown as Product[]) ?? [],
    total: count ?? 0,
    page,
    pageSize,
  }
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

    if (error) throw error

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

  return events
    .sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime())
    .slice(0, limit)
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

    if (error) throw error

    const batch = (data as RawSaleRow[]) ?? []
    rows.push(...batch)

    if (batch.length < BATCH_SIZE) break
    from += BATCH_SIZE
  }

  return rows
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

  if (vendorsRes.error) throw vendorsRes.error

  const now = Date.now()
  const map = new Map<string, { name: string; fresh: number; recent: number; aging: number; stale: number; last: number }>()
  const vendorNames = new Map<string, string>()

  for (const vendor of ((vendorsRes.data ?? []) as Array<{ id: number | string; name: string }>)) {
    vendorNames.set(String(vendor.id), vendor.name)
  }

  for (const row of rows) {
    const vendorId = String(row.vendor_id)
    const name = vendorNames.get(vendorId) ?? vendorId
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

  return Array.from(map.entries()).map(([vendor_id, entry]) => {
    const total = entry.fresh + entry.recent + entry.aging + entry.stale || 1
    return {
      vendor_id,
      vendor_name: entry.name,
      fresh_pct: Math.round((entry.fresh / total) * 100),
      recent_pct: Math.round((entry.recent / total) * 100),
      aging_pct: Math.round((entry.aging / total) * 100),
      stale_pct: Math.round((entry.stale / total) * 100),
      last_scrape: entry.last ? new Date(entry.last).toISOString() : null,
    }
  })
}

export async function fetchDistinctCategories(): Promise<string[]> {
  const rows = await fetchProductAggregateRows()
  return Array.from(new Set(rows.map((row) => row.category).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b))
}

export async function fetchDistinctVendors(): Promise<Array<{ id: number; name: string }>> {
  const { data, error } = await sb
    .from('vendors')
    .select('id, name')
    .order('name')

  if (error) throw error
  return ((data as Array<{ id: number; name: string }>) ?? []).map((vendor) => ({
    id: Number(vendor.id),
    name: vendor.name,
  }))
}
