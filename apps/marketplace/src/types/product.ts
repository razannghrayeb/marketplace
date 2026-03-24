export interface Product {
  id: number
  vendor_id?: number
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
}

export interface ProductImage {
  id: number
  product_id: number
  cdn_url: string
  is_primary?: boolean
}
