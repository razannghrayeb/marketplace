import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'

export interface TryOnCategoryRec {
  category: string
  reason: string
  priority: number
  priorityLabel: string
  products: Array<{
    id?: number
    product_id?: number
    title: string
    brand?: string
    price?: number
    price_cents?: number
    currency?: string
    image?: string
  }>
}

export interface TryOnCompleteStyleData {
  sourceProduct: {
    id: number
    title: string
    image_cdn?: string
    image_url?: string
    category?: string
    price_cents?: number
    currency?: string
  }
  detectedCategory: string
  outfitSuggestion?: string
  recommendations: TryOnCategoryRec[]
  totalRecommendations: number
}

function firstSearchProductId(results: unknown[]): { id: number; title?: string } | null {
  const first = results[0]
  if (!first || typeof first !== 'object') return null
  const o = first as Record<string, unknown>
  const id = Number(o.id ?? o.product_id)
  if (!Number.isFinite(id) || id < 1) return null
  const title = typeof o.title === 'string' ? o.title : typeof o.name === 'string' ? o.name : undefined
  return { id: Math.floor(id), title }
}

/**
 * Match the garment image to catalog (if possible), then load complete-style; otherwise POST synthetic product.
 */
export async function fetchCompleteStyleForGarmentFile(
  garmentFile: File,
): Promise<TryOnCompleteStyleData | null> {
  const options = { maxPerCategory: 5, maxTotal: 20 }
  const fallbackTitle =
    garmentFile.name.replace(/\.[^/.]+$/, '').replace(/[-_]+/g, ' ').trim() || 'Your try-on piece'

  let matchedId: number | null = null
  let matchedTitle = fallbackTitle

  try {
    const fd = new FormData()
    fd.append('image', garmentFile)
    let res = await api.postForm<unknown>(endpoints.products.searchImage, fd)
    if (res.success === false) {
      res = await api.postForm<unknown>(endpoints.search.image, fd)
    }
    if (res.success !== false) {
      const raw = res as Record<string, unknown>
      const list = (Array.isArray(raw.data) ? raw.data : Array.isArray(raw.results) ? raw.results : []) as unknown[]
      const hit = firstSearchProductId(list)
      if (hit) {
        matchedId = hit.id
        if (hit.title) matchedTitle = hit.title
      }
    }
  } catch {
    /* use POST fallback */
  }

  if (matchedId != null) {
    const res = await api.get<TryOnCompleteStyleData>(endpoints.products.completeStyle(matchedId), options)
    if (res.success && res.data) return res.data
  }

  const res2 = await api.post<TryOnCompleteStyleData>(endpoints.products.completeStylePost, {
    product: {
      title: matchedTitle,
      category: 'tops',
    },
    options,
  })
  if (res2.success && res2.data) return res2.data
  return null
}
