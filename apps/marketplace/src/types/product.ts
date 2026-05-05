/** Optional gallery from browse/search APIs when `image_cdn` is unset in DB. */
export interface ProductGalleryImage {
  id?: number
  url?: string
  cdn_url?: string
  is_primary?: boolean
}

/** Retailer / scrape source when the API exposes it */
export interface ProductVendorSource {
  name?: string | null
  url?: string | null
  logo_url?: string | null
}

export interface Product {
  id: number
  vendor_id?: number
  /** Nested vendor row from catalog / search joins */
  vendor?: ProductVendorSource | null
  vendor_name?: string | null
  vendor_logo_url?: string | null
  /** Listing URL on the source site — used for favicon fallback when logo is missing */
  product_url?: string | null
  title: string
  brand?: string | null
  category?: string | null
  description?: string | null
  size?: string | null
  color?: string | null
  currency?: string
  price_cents: number
  sales_price_cents?: number | null
  availability?: boolean
  image_url?: string | null
  image_cdn?: string | null
  primary_image_id?: number | null
  last_seen?: string
  relevance_score?: number
  similarity_score?: number
  images?: ProductGalleryImage[]
}

export interface ProductImage {
  id: number
  product_id: number
  cdn_url: string
  is_primary?: boolean
}
