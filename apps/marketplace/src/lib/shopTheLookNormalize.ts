import type { Product } from '@/types/product'
import { mergeVendorFromHit } from '@/lib/vendorLogo'

function parseCentsField(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v)
  if (typeof v === 'string') {
    const n = parseInt(v, 10)
    if (Number.isFinite(n)) return n
  }
  return null
}

function priceCentsFromRecord(raw: Record<string, unknown>): number {
  const nested =
    raw.product && typeof raw.product === 'object' ? (raw.product as Record<string, unknown>) : null
  for (const o of [raw, nested].filter(Boolean) as Record<string, unknown>[]) {
    const pc = parseCentsField(o.price_cents)
    if (pc !== null && pc > 0) return pc
    const pcCamel = parseCentsField(o.priceCents)
    if (pcCamel !== null && pcCamel > 0) return pcCamel
    const p = o.price ?? o.price_usd ?? o.priceUsd ?? o.min_price ?? o.minPrice
    if (typeof p === 'string') {
      const n = parseFloat(p)
      if (!Number.isFinite(n)) continue
      if (n >= 1000 && Number.isInteger(n)) return Math.round(n)
      return Math.round(n * 100)
    }
    if (typeof p === 'number' && Number.isFinite(p)) {
      if (p >= 1000 && Number.isInteger(p)) return Math.round(p)
      return Math.round(p * 100)
    }
  }
  return 0
}

/** Map API hit rows to catalog `Product` rows (shared by Shop the look UI + normalization). */
export function shopDetectionHitsToProducts(results: unknown[]): Product[] {
  return results
    .filter((r): r is Record<string, unknown> => {
      if (!r || typeof r !== 'object') return false
      const o = r as Record<string, unknown>
      if ('id' in o || 'product_id' in o || 'productId' in o) return true
      const src = o._source
      return Boolean(src && typeof src === 'object' && ('product_id' in src || 'id' in src))
    })
    .map((r) => {
      const raw = r as Record<string, unknown>
      const nested =
        raw._source && typeof raw._source === 'object' ? (raw._source as Record<string, unknown>) : null
      const src = nested ?? raw
      const idRaw = src.id ?? src.product_id ?? src.productId ?? raw.id ?? raw.product_id ?? raw.productId ?? 0
      const id = typeof idRaw === 'number' && Number.isFinite(idRaw) ? idRaw : Number(String(idRaw).replace(/\D/g, '') || 0)
      const saleRaw = src.sales_price_cents ?? src.salesPriceCents ?? raw.sales_price_cents ?? raw.salesPriceCents ?? raw.sale_price
      const sales_price_cents = parseCentsField(saleRaw)
      return {
        id: Number.isFinite(id) && id >= 1 ? id : 0,
        title: String(src.title ?? src.name ?? raw.title ?? raw.name ?? ''),
        price_cents: priceCentsFromRecord(src),
        sales_price_cents: sales_price_cents ?? null,
        image_url: (src.image_url ?? src.imageUrl ?? src.image_cdn ?? src.imageCdn ?? raw.image_url ?? raw.imageUrl ?? null) as string | null,
        image_cdn: (src.image_cdn ?? src.imageCdn ?? raw.image_cdn ?? null) as string | null,
        brand: (src.brand ?? raw.brand) as string | null,
        category: (src.category ?? raw.category) as string | null,
        ...mergeVendorFromHit(src, raw),
      } as Product
    })
}

export interface DetectionBox {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface DetectionMeta {
  label?: string
  confidence?: number
  box?: DetectionBox
  area_ratio?: number
  style?: { occasion?: string; aesthetic?: string; formality?: number }
}

export interface DetectionGroup {
  detection?: DetectionMeta
  category?: string
  products: Product[]
  count?: number
  detectionIndex?: number
  /** Extra YOLO regions merged into this row (e.g. two shoe detections → one panel). */
  secondaryDetections?: DetectionMeta[]
}

export interface ShopTheLookStats {
  totalDetections: number
  coveredDetections: number
  emptyDetections: number
  coverageRatio: number
}

function isShoeDetectionGroup(group: DetectionGroup): boolean {
  const cat = String(group.category || '').toLowerCase()
  const lab = String(group.detection?.label || '').toLowerCase()
  const blob = `${cat} ${lab}`
  return (
    /footwear|shoe|sneaker|boot|sandal|heel|pump|loafer|oxford|mule|slide|stiletto|wedge|flats?\b|clog|espadrilles?/.test(blob) ||
    /\bfoot\b/.test(cat)
  )
}

/** Headwear detections are often false positives on bare heads; we omit them from Shop this look. */
function isHatDetectionGroup(group: DetectionGroup): boolean {
  const cat = String(group.category || '').toLowerCase().replace(/_/g, ' ')
  const lab = String(group.detection?.label || '').toLowerCase().replace(/_/g, ' ')
  const blob = ` ${cat} ${lab} `
  return (
    /\bhats?\b/.test(blob) ||
    /\bcaps?\b/.test(blob) ||
    /\bbeanie\b/.test(blob) ||
    /\bberet\b/.test(blob) ||
    /\bfedora\b/.test(blob) ||
    /\bheadwear\b/.test(blob) ||
    /\bbucket hat\b/.test(blob) ||
    /\bbaseball cap\b/.test(blob) ||
    /\bsnapback\b/.test(blob) ||
    /\bvisor\b/.test(blob) ||
    /\btuque\b/.test(blob) ||
    /\bsun hat\b/.test(blob) ||
    /\bcowboy hat\b/.test(blob) ||
    /\btrucker hat\b/.test(blob)
  )
}

/** Remove hat/headwear rows after shoe merging (catalog does not sell hats). */
export function excludeHatDetectionGroups(groups: DetectionGroup[]): DetectionGroup[] {
  return groups.filter((g) => !isHatDetectionGroup(g))
}

function mergeShoeDetectionRun(list: DetectionGroup[]): DetectionGroup {
  const [first, ...rest] = list
  const seen = new Set<number>()
  const products: Product[] = []
  for (const g of list) {
    for (const p of shopDetectionHitsToProducts(Array.isArray(g.products) ? g.products : [])) {
      if (p.id >= 1 && !seen.has(p.id)) {
        seen.add(p.id)
        products.push(p)
      }
    }
  }
  const secondary: DetectionMeta[] = []
  for (const g of rest) {
    if (g.detection) secondary.push(g.detection)
  }
  let apiCount = 0
  for (const g of list) {
    if (typeof g.count === 'number' && Number.isFinite(g.count)) apiCount += g.count
    else apiCount += Array.isArray(g.products) ? g.products.length : 0
  }
  const baseDet: DetectionMeta = first.detection
    ? { ...first.detection, label: 'shoes' }
    : { label: 'shoes' }
  return {
    ...first,
    detection: baseDet,
    category: first.category,
    products: products as unknown as Product[],
    count: apiCount,
    secondaryDetections: secondary.length ? secondary : undefined,
    detectionIndex: first.detectionIndex,
  }
}

/** Merge adjacent shoe/footwear detections into one row (one “Shoes” category, combined products, all boxes). */
export function mergeConsecutiveShoeDetectionGroups(groups: DetectionGroup[]): DetectionGroup[] {
  const rows = groups.filter((g) => Array.isArray(g.products) && g.products.length > 0)
  if (rows.length <= 1) return rows
  const out: DetectionGroup[] = []
  let shoeRun: DetectionGroup[] = []
  const flush = () => {
    if (shoeRun.length === 0) return
    if (shoeRun.length === 1) out.push(shoeRun[0]!)
    else out.push(mergeShoeDetectionRun(shoeRun))
    shoeRun = []
  }
  for (const g of rows) {
    if (isShoeDetectionGroup(g)) shoeRun.push(g)
    else {
      flush()
      out.push(g)
    }
  }
  flush()
  return out
}

/** Merge shoe rows, then drop hat/headwear detections for storefront display. */
export function normalizeShopTheLookGroups(groups: DetectionGroup[]): DetectionGroup[] {
  return excludeHatDetectionGroups(mergeConsecutiveShoeDetectionGroups(groups))
}
