import type { Product } from '@/types/product'

/**
 * Narrative copy from compare / quality APIs often uses "Product 12345 …".
 * Replace those numeric references with the catalog title (or a short description
 * fallback) when we have hydrated `products` on the client.
 */
const PRODUCT_NUMERIC_ID = /\b([Pp])roduct\s+(\d{1,15})\b/g

function truncateLabel(s: string, maxLen: number): string {
  const t = s.trim()
  if (t.length <= maxLen) return t
  return `${t.slice(0, Math.max(1, maxLen - 1))}…`
}

function labelForProduct(p: Product): string {
  const title = (p.title && String(p.title).trim()) || ''
  if (title) return truncateLabel(title, 100)
  const desc = (p.description && String(p.description).trim()) || ''
  if (desc) return truncateLabel(desc, 80)
  return `Product #${p.id}`
}

/** Map of numeric product id → display string for copy substitution. */
export function productIdToDisplayLabel(products: Product[] | undefined): Map<number, string> {
  const m = new Map<number, string>()
  if (!products?.length) return m
  for (const p of products) {
    const id = typeof p.id === 'number' && Number.isFinite(p.id) ? p.id : Number(p.id)
    if (!Number.isFinite(id) || id < 1) continue
    m.set(id, labelForProduct(p))
  }
  return m
}

export function humanizeProductIdInCopy(text: string, products: Product[] | undefined): string {
  if (!text || !products?.length) return text
  const map = productIdToDisplayLabel(products)
  return text.replace(PRODUCT_NUMERIC_ID, (_match, pChar: string, idStr: string) => {
    const id = parseInt(idStr, 10)
    if (!Number.isFinite(id)) return _match
    const label = map.get(id)
    if (!label) return _match
    const safe = label.includes('"') ? label.replace(/"/g, "'") : label
    const productWord = pChar === 'P' ? 'Product' : 'product'
    return `${productWord} “${safe}”`
  })
}

export function humanizeProductIdInCopyLines(lines: string[], products: Product[] | undefined): string[] {
  return lines.map((line) => humanizeProductIdInCopy(line, products))
}

export function displayNameForCompareProduct(
  products: Product[] | undefined,
  productId: number,
  letterFallback: string,
): string {
  const p = products?.find((x) => x.id === productId)
  const t = p?.title?.trim()
  if (t) return truncateLabel(t, 90)
  return letterFallback
}
