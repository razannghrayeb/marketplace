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
  completionMode?: 'product' | 'tryon'
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

function inferFallbackCategoryFromTitle(value: string): string | undefined {
  const text = value.toLowerCase()

  if (/\b(maxi\s*dress|mini\s*dress|midi\s*dress|dress|gown|jumpsuit|romper)\b/.test(text)) return 'dress'
  if (/\b(skirt|skorts?)\b/.test(text)) return 'skirt'
  if (/\b(pants?|trousers?|jeans?|denim|leggings?)\b/.test(text)) return 'pants'
  if (/\b(shorts?|bermuda)\b/.test(text)) return 'shorts'
  if (/\b(blazer|jacket|coat|cardigan|hoodie|sweatshirt|sweater|top|shirt|blouse|tee|t-?shirt|tank|crop)\b/.test(text)) return 'top'
  if (/\b(clutch|tote|backpack|crossbody|shoulder bag|handbag|purse|bag|wallet)\b/.test(text)) return 'bag'

  return undefined
}

function inferAudienceGenderFromTitle(value: string): 'men' | 'women' | 'unisex' | undefined {
  const text = value.toLowerCase()
  if (/\b(unisex|all gender|all-gender)\b/.test(text)) return 'unisex'
  if (/\b(women|womens|women's|ladies|female|girl|girls)\b/.test(text)) return 'women'
  if (/\b(men|mens|men's|male|boy|boys)\b/.test(text)) return 'men'
  return undefined
}

/** Dedicated try-on mode: never remap garment to a "similar" catalog item first. */
export async function fetchCompleteStyleForGarmentFile(
  garmentFile: File,
): Promise<TryOnCompleteStyleData | null> {
  const options = { maxPerCategory: 5, maxTotal: 20 }
  const fallbackTitle =
    garmentFile.name.replace(/\.[^/.]+$/, '').replace(/[-_]+/g, ' ').trim() || 'Your try-on piece'
  const inferredCategory = inferFallbackCategoryFromTitle(fallbackTitle)
  const audienceGenderHint = inferAudienceGenderFromTitle(fallbackTitle)
  const res = await api.post<TryOnCompleteStyleData>(endpoints.products.completeStyleTryOn, {
    product: {
      title: fallbackTitle,
      ...(inferredCategory ? { category: inferredCategory } : {}),
    },
    options: {
      ...options,
      sourceMode: 'tryon',
      ...(audienceGenderHint ? { audienceGenderHint } : {}),
    },
  })
  if (res.success && res.data) return res.data
  return null
}
