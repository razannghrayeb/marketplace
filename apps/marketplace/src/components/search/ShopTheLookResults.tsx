'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import Link from 'next/link'
import NextImage from 'next/image'
import {
  Search,
  Sparkles,
  Layers,
  Shirt,
  Zap,
  Eye,
  ChevronDown,
  ScanSearch,
  ArrowDown,
} from 'lucide-react'
import type { Product } from '@/types/product'

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

function toProducts(results: unknown[]): Product[] {
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

const CATEGORY_STYLES: Record<string, { icon: typeof Shirt; ring: string }> = {
  tops: { icon: Shirt, ring: 'ring-violet-200' },
  bottoms: { icon: Shirt, ring: 'ring-slate-200' },
  dress: { icon: Sparkles, ring: 'ring-fuchsia-200' },
  dresses: { icon: Sparkles, ring: 'ring-fuchsia-200' },
  outerwear: { icon: Layers, ring: 'ring-amber-200' },
  shoes: { icon: Zap, ring: 'ring-emerald-200' },
  bags: { icon: Eye, ring: 'ring-indigo-200' },
  accessories: { icon: Sparkles, ring: 'ring-rose-200' },
  default: { icon: Search, ring: 'ring-neutral-200' },
}

function formatDetectionLabel(label: string): string {
  return label
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatProductPrice(product: Product): string | null {
  const cents =
    typeof product.price_cents === 'string' ? parseInt(String(product.price_cents), 10) : product.price_cents
  if (cents == null || !Number.isFinite(cents) || cents <= 0) return null
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
  }).format(cents / 100)
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

function mergeShoeDetectionRun(list: DetectionGroup[]): DetectionGroup {
  const [first, ...rest] = list
  const seen = new Set<number>()
  const products: Product[] = []
  for (const g of list) {
    for (const p of toProducts(Array.isArray(g.products) ? g.products : [])) {
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

function detectionMetasWithBoxes(group: DetectionGroup): DetectionMeta[] {
  const list: DetectionMeta[] = []
  if (group.detection) list.push(group.detection)
  for (const d of group.secondaryDetections ?? []) list.push(d)
  return list
}

function boxStylePercents(box: DetectionBox, refW: number, refH: number) {
  const w = Math.max(1, refW)
  const h = Math.max(1, refH)
  const left = Math.max(0, Math.min(100, (box.x1 / w) * 100))
  const top = Math.max(0, Math.min(100, (box.y1 / h) * 100))
  const width = Math.max(0, Math.min(100 - left, ((box.x2 - box.x1) / w) * 100))
  const height = Math.max(0, Math.min(100 - top, ((box.y2 - box.y1) / h) * 100))
  return { left, top, width, height }
}

/** One restrained overlay system so the outfit photo stays the hero. */
const OVERLAY = {
  border: 'border-white shadow-[0_0_0_1px_rgba(139,92,246,0.55)]',
  fill: 'bg-violet-600/15',
  fillHi: 'bg-violet-600/28',
  ring: 'ring-2 ring-violet-400/90 ring-offset-2 ring-offset-black/20',
} as const

const SHOP_THE_LOOK_INITIAL = 6
const SHOP_THE_LOOK_STEP = 6

export function ShopTheLookResults({
  groups,
  outfitImageUrl,
  imageMeta,
  shopTheLookStats,
  returnPath,
}: {
  groups: DetectionGroup[]
  outfitImageUrl: string
  imageMeta?: { width: number; height: number }
  shopTheLookStats?: ShopTheLookStats
  /** Full `/search?...` URL for product links (back to Discover). */
  returnPath?: string
}) {
  const [visibleByKey, setVisibleByKey] = useState<Record<string, number>>({})
  const [imgNatural, setImgNatural] = useState<{ w: number; h: number } | null>(null)
  const [activeIdx, setActiveIdx] = useState<number | null>(null)
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)
  /** One expanded product at a time — shows other picks from the same detection below the row. */
  const [expandedProduct, setExpandedProduct] = useState<{ sectionKey: string; productId: number } | null>(null)
  const sectionRefs = useRef<(HTMLElement | null)[]>([])

  const rows = groups.filter((g) => g.products && g.products.length > 0)
  if (rows.length === 0) return null

  useEffect(() => {
    setSelectedIdx(null)
    setActiveIdx(null)
    setExpandedProduct(null)
    sectionRefs.current = []
  }, [outfitImageUrl])

  const refW = imgNatural?.w ?? imageMeta?.width ?? 0
  const refH = imgNatural?.h ?? imageMeta?.height ?? 0
  const canDrawBoxes = refW > 0 && refH > 0

  const displayIndices =
    selectedIdx !== null && selectedIdx >= 0 && selectedIdx < rows.length
      ? [selectedIdx]
      : rows.map((_, i) => i)

  const focusDetection = useCallback((i: number) => {
    setExpandedProduct(null)
    setSelectedIdx((cur) => {
      const next = cur === i ? null : i
      if (next !== null) {
        requestAnimationFrame(() => {
          sectionRefs.current[i]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        })
      }
      return next
    })
  }, [])

  const boxHighlight = (i: number) => selectedIdx === i || (selectedIdx === null && activeIdx === i)
  const boxDimmed = (i: number) => selectedIdx !== null && selectedIdx !== i

  const productHref = useCallback(
    (id: number) =>
      returnPath && returnPath.startsWith('/search')
        ? `/products/${id}?from=${encodeURIComponent(returnPath)}`
        : `/products/${id}`,
    [returnPath],
  )

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}>
      {/* Region picker — compact, centered */}
      <div className="max-w-3xl mx-auto mb-8 rounded-2xl border border-slate-200/90 bg-white px-4 py-4 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-3">
          <div>
            <p className="font-display text-sm font-semibold text-slate-900">Pieces in your photo</p>
            <p className="text-xs text-slate-500 mt-0.5 max-w-xl">
              Tap a chip or a highlighted area on the photo to see similar products for that piece only.
            </p>
          </div>
          {selectedIdx !== null ? (
            <button
              type="button"
              onClick={() => {
                setExpandedProduct(null)
                setSelectedIdx(null)
              }}
              className="shrink-0 text-xs font-semibold text-violet-700 hover:text-violet-900 px-3 py-1.5 rounded-lg border border-violet-200 bg-white hover:bg-violet-50 transition-colors"
            >
              Show all pieces
            </button>
          ) : null}
        </div>
        <div
          className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1"
          role="tablist"
          aria-label="Detected fashion items"
        >
          <button
            type="button"
            role="tab"
            aria-selected={selectedIdx === null}
            onClick={() => {
              setExpandedProduct(null)
              setSelectedIdx(null)
            }}
            className={`shrink-0 rounded-xl px-3.5 py-2.5 text-left transition-all border min-w-[108px] ${
              selectedIdx === null
                ? 'border-violet-300 bg-violet-50/90 text-slate-900 shadow-sm'
                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
            }`}
          >
            <span className="text-xs font-semibold">All</span>
            <span className="block text-[11px] text-slate-500 mt-0.5">{rows.length} pieces</span>
          </button>
          {rows.map((group, i) => {
            const yoloLabel = formatDetectionLabel(String(group.detection?.label || group.category || 'Item'))
            const catalog =
              group.category && String(group.category) !== String(group.detection?.label)
                ? formatDetectionLabel(String(group.category))
                : null
            const n = toProducts(group.products as unknown[]).filter(
              (p, idx, arr) => arr.findIndex((x) => x.id === p.id) === idx,
            ).length
            const pressed = selectedIdx === i
            return (
              <button
                key={`det-chip-${i}-${group.detectionIndex ?? ''}`}
                type="button"
                role="tab"
                aria-selected={pressed}
                onClick={() => focusDetection(i)}
                className={`shrink-0 min-w-[132px] max-w-[220px] rounded-xl px-3.5 py-2.5 text-left transition-all border ${
                  pressed
                    ? 'border-violet-400 bg-white text-slate-900 shadow-md ring-2 ring-violet-200/80 ring-offset-1 ring-offset-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:shadow-sm'
                }`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold tabular-nums ${
                      pressed ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-600'
                    }`}
                    aria-hidden
                  >
                    {i + 1}
                  </span>
                  <span className="truncate text-xs font-semibold">{yoloLabel}</span>
                  <span
                    className={`ml-auto shrink-0 text-[10px] font-semibold tabular-nums px-1.5 py-0.5 rounded-md ${
                      pressed ? 'bg-violet-100 text-violet-800' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {n}
                  </span>
                </span>
                {catalog ? (
                  <span className="mt-1.5 block text-[10px] text-slate-500 truncate pl-8">{catalog}</span>
                ) : (
                  <span className="mt-1.5 block text-[10px] text-slate-400 truncate pl-8">Similar picks</span>
                )}
              </button>
            )
          })}
        </div>
        {selectedIdx !== null && rows[selectedIdx] ? (
          <p className="mt-3 text-xs text-slate-600 border-t border-slate-100 pt-3">
            Showing matches for{' '}
            <span className="font-semibold text-slate-900">
              {formatDetectionLabel(String(rows[selectedIdx].detection?.label || rows[selectedIdx].category || 'item'))}
            </span>
            {rows[selectedIdx].category ? (
              <>
                <span className="text-slate-400"> · </span>
                <span className="text-slate-700">{formatDetectionLabel(String(rows[selectedIdx].category))}</span>
              </>
            ) : null}
          </p>
        ) : null}
      </div>

      {/* Centered hero photo */}
      <div
        className="max-w-[min(92vw,760px)] mx-auto mb-10 flex flex-col items-center"
        onMouseLeave={() => setActiveIdx(null)}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="relative w-full"
        >
          <div className="relative rounded-3xl overflow-hidden border border-slate-200/90 bg-slate-950 shadow-xl shadow-slate-900/15">
            <div className="relative inline-block w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={outfitImageUrl}
                alt="Your outfit — tap highlighted regions for similar products"
                className="w-full h-auto max-h-[min(82vh,860px)] object-contain object-top bg-slate-900 block mx-auto"
                onLoad={(e) => {
                  const el = e.currentTarget
                  setImgNatural({ w: el.naturalWidth, h: el.naturalHeight })
                }}
              />
                {canDrawBoxes &&
                  rows.flatMap((group, i) => {
                    const hi = boxHighlight(i)
                    const dim = boxDimmed(i)
                    return detectionMetasWithBoxes(group)
                      .map((meta, bi) => {
                        const box = meta.box
                        if (
                          !box ||
                          ![box.x1, box.y1, box.x2, box.y2].every((n) => typeof n === 'number' && Number.isFinite(n))
                        ) {
                          return null
                        }
                        const { left, top, width, height } = boxStylePercents(box, refW, refH)
                        if (width <= 0 || height <= 0) return null
                        const label = meta.label || group.category || 'Item'
                        return (
                          <button
                            key={`box-${i}-${bi}`}
                            type="button"
                            aria-label={`Select region: ${formatDetectionLabel(String(label))}`}
                            aria-pressed={selectedIdx === i}
                            className={`absolute rounded-lg transition-all duration-200 ${OVERLAY.border} ${
                              hi ? `${OVERLAY.fillHi} ${OVERLAY.ring} z-10 scale-[1.01]` : `${OVERLAY.fill} hover:bg-violet-600/25`
                            } ${dim ? 'opacity-35' : 'opacity-100'}`}
                            style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` }}
                            onClick={() => focusDetection(i)}
                            onMouseEnter={() => setActiveIdx(i)}
                            onFocus={() => setActiveIdx(i)}
                            onBlur={() => setActiveIdx((cur) => (cur === i ? null : cur))}
                          />
                        )
                      })
                      .filter(Boolean)
                  })}
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08 }}
          className="mt-5 w-full flex flex-col items-center text-center"
        >
          <div className="flex flex-wrap items-center justify-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-900 text-white text-[11px] font-semibold tracking-tight">
              <ScanSearch className="w-3.5 h-3.5 shrink-0 opacity-90" />
              {rows.length} piece{rows.length !== 1 ? 's' : ''} matched
            </span>
            {shopTheLookStats && shopTheLookStats.totalDetections > 0 ? (
              <span className="text-[11px] text-slate-500">
                {shopTheLookStats.coveredDetections}/{shopTheLookStats.totalDetections} detected
                {shopTheLookStats.coverageRatio != null && Number.isFinite(shopTheLookStats.coverageRatio)
                  ? ` · ${Math.round(shopTheLookStats.coverageRatio * 100)}%`
                  : ''}
              </span>
            ) : null}
          </div>
        </motion.div>
      </div>

      {/* Matches — single column, calm */}
      <div className="max-w-3xl mx-auto space-y-8 pb-4">
          {displayIndices.map((i) => {
            const group = rows[i]
            const formatted = formatDetectionLabel(
              String(group.detection?.label || group.category || 'Item'),
            )
            const catKeyRaw = String(group.category || 'default').toLowerCase()
            const style = CATEGORY_STYLES[catKeyRaw] || CATEGORY_STYLES.default
            const Icon = style.icon
            const parsed = toProducts(group.products as unknown as unknown[])
            const seen = new Set<number>()
            const unique = parsed.filter((p) => {
              if (seen.has(p.id)) return false
              seen.add(p.id)
              return true
            })
            if (unique.length === 0) return null

            const sectionKey = `stl-${group.detectionIndex ?? i}-${i}`
            const visibleCap = visibleByKey[sectionKey] ?? SHOP_THE_LOOK_INITIAL
            const visibleProducts = unique.slice(0, visibleCap)
            const hasMoreInSection = unique.length > visibleProducts.length
            const sectionActive = selectedIdx === i || (selectedIdx === null && activeIdx === i)
            return (
              <motion.section
                key={sectionKey}
                ref={(el) => {
                  sectionRefs.current[i] = el
                }}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.06 + i * 0.05, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                className={`rounded-2xl border bg-white p-5 sm:p-6 transition-all duration-200 ${
                  sectionActive
                    ? 'border-violet-200 shadow-md shadow-violet-500/5 ring-1 ring-violet-100'
                    : 'border-slate-200/90 shadow-sm hover:border-slate-300'
                }`}
                onMouseEnter={() => setActiveIdx(i)}
              >
                <div className="flex items-start gap-3 mb-5 pb-4 border-b border-slate-100">
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-50 text-slate-600 ring-1 ${style.ring}`}
                  >
                    <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-display text-base sm:text-lg font-semibold text-slate-900 tracking-tight">
                      {formatted}
                    </h3>
                    {group.category ? (
                      <p className="text-xs text-slate-500 mt-0.5">{formatDetectionLabel(String(group.category))}</p>
                    ) : null}
                    <p className="text-[11px] text-slate-400 mt-2">
                      {unique.length} similar item{unique.length !== 1 ? 's' : ''}
                      {visibleProducts.length < unique.length ? ` · showing ${visibleProducts.length}` : ''}
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] font-medium tabular-nums text-slate-400 bg-slate-50 px-2 py-1 rounded-lg">
                    {i + 1}/{rows.length}
                  </span>
                </div>

                <div className="flex flex-col gap-3">
                  {visibleProducts.map((product, j) => {
                    const imgUrl = product.image_cdn || product.image_url || ''
                    const price = formatProductPrice(product)
                    const isExpanded =
                      expandedProduct?.sectionKey === sectionKey && expandedProduct?.productId === product.id
                    const related = unique.filter((p) => p.id !== product.id).slice(0, 12)
                    const canShowRelated = related.length > 0

                    return (
                      <motion.div
                        key={product.id}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.04 + j * 0.03, duration: 0.25 }}
                        className="rounded-2xl border border-slate-200/90 bg-white overflow-hidden shadow-sm"
                      >
                        <button
                          type="button"
                          className={`flex w-full gap-4 p-4 text-left items-stretch transition-colors ${
                            canShowRelated ? 'hover:bg-slate-50/80 cursor-pointer' : 'cursor-default opacity-95'
                          }`}
                          onClick={() => {
                            if (!canShowRelated) return
                            setExpandedProduct((cur) =>
                              cur?.sectionKey === sectionKey && cur?.productId === product.id
                                ? null
                                : { sectionKey, productId: product.id },
                            )
                          }}
                          aria-expanded={canShowRelated ? isExpanded : undefined}
                          disabled={!canShowRelated}
                        >
                          <div className="relative w-[4.75rem] sm:w-[5.5rem] shrink-0 aspect-[3/4] rounded-xl overflow-hidden bg-slate-100 ring-1 ring-slate-200/60">
                            {imgUrl ? (
                              <NextImage
                                src={imgUrl}
                                alt={product.title}
                                fill
                                className="object-cover"
                                sizes="88px"
                                onError={(e) => {
                                  e.currentTarget.src =
                                    'https://placehold.co/320x426/f5f5f5/737373?text=No+Image'
                                }}
                              />
                            ) : null}
                          </div>
                          <div className="flex-1 min-w-0 flex flex-col justify-center py-0.5">
                            {product.brand ? (
                              <p className="text-[10px] font-semibold text-violet-700 uppercase tracking-wider truncate">
                                {product.brand}
                              </p>
                            ) : null}
                            <p className="text-sm font-medium text-slate-900 line-clamp-2 leading-snug mt-0.5">
                              {product.title}
                            </p>
                            {price ? (
                              <p className="text-sm font-semibold text-slate-800 mt-1 tabular-nums">{price}</p>
                            ) : null}
                            {canShowRelated ? (
                              <span className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-violet-700">
                                Related in this look
                                <ChevronDown
                                  className={`w-4 h-4 shrink-0 transition-transform duration-200 ${
                                    isExpanded ? 'rotate-180' : ''
                                  }`}
                                  aria-hidden
                                />
                              </span>
                            ) : (
                              <span className="mt-3 text-xs text-slate-400">Only result for this region</span>
                            )}
                          </div>
                        </button>

                        {isExpanded && canShowRelated ? (
                          <div className="border-t border-slate-100 bg-slate-50/90">
                            <div className="flex flex-col items-center py-1">
                              <div className="h-3 w-px bg-violet-200" aria-hidden />
                              <ArrowDown className="w-5 h-5 text-violet-500 -mt-0.5" strokeWidth={2} aria-hidden />
                            </div>
                            <div className="px-4 pb-4">
                              <p className="text-[11px] font-medium text-slate-500 mb-3 text-center sm:text-left">
                                More you may like from this same piece
                              </p>
                              <div className="flex gap-3 overflow-x-auto pb-2 pt-0.5 snap-x snap-mandatory">
                                {related.map((rp) => {
                                  const rImg = rp.image_cdn || rp.image_url || ''
                                  const rPrice = formatProductPrice(rp)
                                  return (
                                    <Link
                                      key={rp.id}
                                      href={productHref(rp.id)}
                                      className="snap-start shrink-0 w-[6.5rem] rounded-xl border border-slate-200/90 bg-white overflow-hidden shadow-sm hover:border-violet-200 hover:shadow-md transition-all"
                                    >
                                      <div className="relative aspect-[3/4] bg-slate-100">
                                        {rImg ? (
                                          <NextImage
                                            src={rImg}
                                            alt={rp.title}
                                            fill
                                            className="object-cover"
                                            sizes="104px"
                                            onError={(e) => {
                                              e.currentTarget.src =
                                                'https://placehold.co/320x426/f5f5f5/737373?text=+'
                                            }}
                                          />
                                        ) : null}
                                      </div>
                                      <div className="p-2">
                                        <p className="text-[10px] font-medium text-slate-800 line-clamp-2 leading-tight min-h-[2rem]">
                                          {rp.title}
                                        </p>
                                        {rPrice ? (
                                          <p className="text-[10px] font-semibold text-slate-700 mt-1 tabular-nums">
                                            {rPrice}
                                          </p>
                                        ) : null}
                                      </div>
                                    </Link>
                                  )
                                })}
                              </div>
                            </div>
                          </div>
                        ) : null}

                        <Link
                          href={productHref(product.id)}
                          className="block text-center py-3 text-sm font-medium text-violet-800 bg-white border-t border-slate-100 hover:bg-violet-50/50 transition-colors"
                        >
                          Open product page
                        </Link>
                      </motion.div>
                    )
                  })}
                </div>

                {hasMoreInSection && (
                  <div className="mt-5 flex justify-center">
                    <button
                      type="button"
                      onClick={() =>
                        setVisibleByKey((prev) => ({
                          ...prev,
                          [sectionKey]: (prev[sectionKey] ?? SHOP_THE_LOOK_INITIAL) + SHOP_THE_LOOK_STEP,
                        }))
                      }
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm font-semibold text-slate-700 hover:bg-white hover:border-slate-300 transition-colors"
                    >
                      <ChevronDown className="w-4 h-4" />
                      Load more
                    </button>
                  </div>
                )}
              </motion.section>
            )
          })}
        </div>
    </motion.div>
  )
}