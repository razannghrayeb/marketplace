import type { Product } from '@/types/product'

type GalleryItem = { url?: string; cdn_url?: string; is_primary?: boolean }

/**
 * Shop API sometimes leaves `image_cdn` null but includes joined gallery rows on `images[]`.
 */
export function resolvePrimaryImageUrl(product: Product): string | null {
  if (product.image_cdn && String(product.image_cdn).trim()) return String(product.image_cdn).trim()
  if (product.image_url && String(product.image_url).trim()) return String(product.image_url).trim()

  const raw = product as Product & { images?: GalleryItem[] }
  if (!Array.isArray(raw.images) || raw.images.length === 0) return null

  const primary = raw.images.find((i) => i?.is_primary) || raw.images[0]
  if (!primary || typeof primary !== 'object') return null

  const u = primary.url || primary.cdn_url
  if (u && String(u).trim()) return String(u).trim()
  return null
}
