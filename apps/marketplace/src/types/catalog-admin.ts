// ─── Database Row Types ────────────────────────────────────────────────────────

export interface Vendor {
  id: number
  name: string
  url: string
  ship_to_lebanon: boolean
  created_at?: string
}

export interface Product {
  id: number
  vendor_id: number
  product_url: string
  parent_product_url: string | null
  variant_id: string | null
  title: string
  brand: string | null
  category: string | null
  description: string | null
  size: string | null
  color: string | null
  currency: string | null
  price_cents: number | null
  sales_price_cents: number | null
  availability: boolean | null
  last_seen: string | null
  image_url: string | null
  image_urls: string[] | null
  image_cdn: string | null
  primary_image_id: number | null
  p_hash: string | null
  return_policy: string | null
  // joined
  vendor?: Vendor
}

export interface PriceHistory {
  id: number
  product_id: number
  price_cents: number
  sales_price_cents: number | null
  currency: string
  recorded_at: string
  // joined
  product?: Pick<Product, 'id' | 'title' | 'vendor_id' | 'image_url'>
}

// ─── Dashboard / Derived Types ─────────────────────────────────────────────────

export interface VendorStats extends Vendor {
  total_products: number
  available_products: number
  unavailable_products: number
  missing_category: number
  missing_image_url: number
  missing_image_urls: number
  missing_variant_id: number
  missing_parent_url: number
  missing_color: number
  missing_size: number
  latest_last_seen: string | null
  health_score: number // 0-100
}

export interface OverviewKPIs {
  total_vendors: number
  total_products: number
  available_products: number
  unavailable_products: number
  products_seen_today: number
  missing_category: number
  missing_color: number
  missing_size: number
  missing_image_url: number
  missing_image_urls: number
  missing_variant_id: number
  missing_parent_url: number
  with_sale_price: number
  updated_last_24h: number
}

export interface CategoryCount {
  category: string | null
  count: number
}

export interface VendorProductCount {
  vendor_name: string
  total: number
  available: number
  unavailable: number
}

// ─── Quality Flag Types ──────────────────────────────────────────────────────

export type IssueSeverity = 'critical' | 'warning' | 'stale' | 'info'

export interface ProductQualityFlags {
  missing_category: boolean
  missing_brand: boolean
  missing_color: boolean
  missing_size: boolean
  missing_image_url: boolean
  missing_image_urls: boolean
  missing_variant_id: boolean
  missing_parent_url: boolean
  color_looks_like_size: boolean
  size_looks_like_color: boolean
  sale_exceeds_base: boolean
  price_is_zero: boolean
  is_stale: boolean // last_seen > 14d
  is_aging: boolean // last_seen 7-14d
  missing_return_policy: boolean
}

// ─── Filter / Query Types ──────────────────────────────────────────────────────

export interface ProductFilters {
  search?: string
  vendor_id?: string | number
  category?: string
  brand?: string
  color?: string
  size?: string
  availability?: boolean
  currency?: string
  price_min?: number
  price_max?: number
  last_seen_after?: string
  last_seen_before?: string
  has_sale?: boolean
  has_issues?: boolean
  // issue-specific
  missing_category?: boolean
  missing_image_url?: boolean
  missing_variant_id?: boolean
  sale_exceeds_base?: boolean
  is_stale?: boolean
}

export type ProductSortField =
  | 'price_cents'
  | 'last_seen'
  | 'title'
  | 'vendor_id'
  | 'category'
  | 'brand'

export interface SortConfig {
  field: ProductSortField
  direction: 'asc' | 'desc'
}

export interface PaginationConfig {
  page: number
  pageSize: number
}

export interface ProductsQueryResult {
  data: Product[]
  total: number
  page: number
  pageSize: number
  /** Live API has another page (exact total may be unknown). */
  has_more?: boolean
}

// ─── Freshness Types ───────────────────────────────────────────────────────────

export interface FreshnessStats {
  fresh_count: number    // < 1 day
  recent_count: number   // 1–7 days
  aging_count: number    // 7–14 days
  stale_count: number    // > 14 days
}

export interface VendorFreshness {
  vendor_id: number | string
  vendor_name: string
  /** Row count in aggregate (same basis as KPI totals). */
  product_count: number
  fresh_pct: number
  recent_pct: number
  aging_pct: number
  stale_pct: number
  last_scrape: string | null
}

export interface DailyScrapeStat {
  date: string  // YYYY-MM-DD
  count: number
}

// ─── Price Types ───────────────────────────────────────────────────────────────

export interface PriceChangeEvent {
  product_id: number
  product_title: string
  vendor_name: string
  image_url: string | null
  old_price: number
  new_price: number
  change_pct: number
  recorded_at: string
  is_discount: boolean
}

export interface CurrentSaleProduct {
  product_id: number
  product_title: string
  vendor_name: string
  image_url: string | null
  price_cents: number
  sales_price_cents: number
  discount_pct: number
  last_seen: string | null
}

export interface PriceVolumeStat {
  date: string
  change_count: number
}
