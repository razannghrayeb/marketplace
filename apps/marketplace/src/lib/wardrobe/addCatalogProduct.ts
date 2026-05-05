import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'
import type { Product } from '@/types/product'
import { resolvePrimaryImageUrl } from '@/lib/productImage'

/** POST /api/wardrobe/items without a file — links a catalog product (source `linked`). */
export async function addCatalogProductToWardrobe(product: Product): Promise<void> {
  const fd = new FormData()
  fd.append('source', 'linked')
  fd.append('product_id', String(product.id))
  fd.append('name', product.title)
  if (product.brand) fd.append('brand', product.brand)
  const img = resolvePrimaryImageUrl(product)
  if (img) fd.append('image_url', img)
  const res = await api.postForm(endpoints.wardrobe.items, fd)
  const r = res as { success?: boolean; error?: { message?: string } }
  if (r.success === false) throw new Error(r.error?.message ?? 'Could not add to wardrobe')
}
