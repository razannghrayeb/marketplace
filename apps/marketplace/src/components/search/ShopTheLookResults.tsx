'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
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
} from 'lucide-react'
import type { Product } from '@/types/product'
import { saveListingScrollY } from '@/lib/navigation/listingScrollRestore'
import { formatStoredPriceAsUsd } from '@/lib/money/displayUsd'
import {
  shopDetectionHitsToProducts,
  type DetectionBox,
  type DetectionMeta,
  type DetectionGroup,
  type ShopTheLookStats,
} from '@/lib/shopTheLookNormalize'

export type { DetectionBox, DetectionMeta, DetectionGroup, ShopTheLookStats }

/** Shop the Look — luxury editorial palette */
const STL_TEXT = '#2B2521'
const STL_SURFACE = '#F5F1EC'

const CATEGORY_STYLES: Record<string, { icon: typeof Shirt; ring: string }> = {
  tops: { icon: Shirt, ring: 'ring-[#d8c6bb]' },
  bottoms: { icon: Shirt, ring: 'ring-slate-200' },
  dress: { icon: Sparkles, ring: 'ring-[#d8c6bb]' },
  dresses: { icon: Sparkles, ring: 'ring-[#d8c6bb]' },
  outerwear: { icon: Layers, ring: 'ring-amber-200' },
  shoes: { icon: Zap, ring: 'ring-emerald-200' },
  bags: { icon: Eye, ring: 'ring-[#d8c6bb]' },
  accessories: { icon: Sparkles, ring: 'ring-[#d8c6bb]' },
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
  return formatStoredPriceAsUsd(cents, product.currency, { minimumFractionDigits: 0, maximumFractionDigits: 0 })
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

/** First detection meta in a group that has a usable bounding box (for 3D spotlight crop). */
function firstBoxMeta(group: DetectionGroup): DetectionMeta | null {
  for (const meta of detectionMetasWithBoxes(group)) {
    const box = meta.box
    if (box && [box.x1, box.y1, box.x2, box.y2].every((n) => typeof n === 'number' && Number.isFinite(n))) {
      if (box.x2 > box.x1 && box.y2 > box.y1) return meta
    }
  }
  return null
}

function topMatchProduct(group: DetectionGroup): Product | null {
  const parsed = shopDetectionHitsToProducts(Array.isArray(group.products) ? group.products : [])
  return parsed.find((p) => p.id >= 1) ?? parsed[0] ?? null
}

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
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)
  const [highlightedIdx, setHighlightedIdx] = useState<number | null>(null)
  const sectionRefs = useRef<(HTMLElement | null)[]>([])

  const rows = groups.filter((g) => g.products && g.products.length > 0)
  if (rows.length === 0) return null

  useEffect(() => {
    setSelectedIdx(null)
    setHoveredIdx(null)
    setHighlightedIdx(null)
    sectionRefs.current = []
  }, [outfitImageUrl])

  useEffect(() => {
    if (highlightedIdx === null) return
    const id = window.setTimeout(() => setHighlightedIdx((cur) => (cur === highlightedIdx ? null : cur)), 950)
    return () => window.clearTimeout(id)
  }, [highlightedIdx])

  const refW = imgNatural?.w ?? imageMeta?.width ?? 0
  const refH = imgNatural?.h ?? imageMeta?.height ?? 0
  const canDrawBoxes = refW > 0 && refH > 0

  const displayIndices =
    selectedIdx !== null && selectedIdx >= 0 && selectedIdx < rows.length
      ? [selectedIdx]
      : rows.map((_, i) => i)

  const focusDetection = useCallback((idx: number) => {
    setSelectedIdx((cur) => {
      const next = cur === idx ? null : idx
      if (next !== null) {
        setHighlightedIdx(next)
        requestAnimationFrame(() => {
          sectionRefs.current[next]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        })
      } else {
        setHighlightedIdx(null)
      }
      return next
    })
  }, [])

  const selectedGroup =
    selectedIdx !== null && selectedIdx >= 0 && selectedIdx < rows.length ? rows[selectedIdx] : null
  const selectedMeta = selectedGroup ? firstBoxMeta(selectedGroup) : null
  const selectedCrop =
    selectedMeta?.box && canDrawBoxes ? boxStylePercents(selectedMeta.box, refW, refH) : null

  const productHref = useCallback(
    (id: number) =>
      returnPath &&
      (returnPath.startsWith('/search') ||
        returnPath.startsWith('/products') ||
        returnPath.startsWith('/sales'))
        ? `/products/${id}?from=${encodeURIComponent(returnPath)}`
        : `/products/${id}`,
    [returnPath],
  )

  const saveScrollBeforeProduct = useCallback(() => {
    saveListingScrollY(returnPath, typeof window !== 'undefined' ? window.scrollY : 0)
  }, [returnPath])

  const floatingProduct =
    selectedIdx !== null && selectedIdx >= 0 && selectedIdx < rows.length
      ? topMatchProduct(rows[selectedIdx]!)
      : null

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="space-y-8 rounded-[24px] px-3 py-6 sm:px-5 sm:py-8"
      style={{ backgroundColor: STL_SURFACE }}
    >
      <header className="mx-auto flex max-w-7xl flex-col gap-4 border-b border-[#e5ddd4] pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-brand/25 bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-brand shadow-sm">
            <Sparkles className="h-3.5 w-3.5 shrink-0 opacity-90" aria-hidden />
            AI styling
          </div>
          <h2
            className="mt-3 font-display text-2xl font-bold tracking-[-0.03em] sm:text-3xl"
            style={{ color: STL_TEXT }}
          >
            Shop this look
          </h2>
          <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-[#5c534c]">
            Explore pieces mapped from your photo — tap highlights on the image or pick an item in the panel.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-brand/35 bg-white px-3.5 py-2 text-[12px] font-semibold text-brand shadow-sm transition-colors duration-[250ms] ease-out">
            <ScanSearch className="h-3.5 w-3.5 shrink-0 opacity-90" aria-hidden />
            {rows.length} piece{rows.length !== 1 ? 's' : ''}
          </span>
          {shopTheLookStats?.totalDetections ? (
            <span className="rounded-full border border-[#e0d8cf] bg-white/90 px-3 py-2 text-[12px] font-medium text-[#6b5348]">
              {shopTheLookStats.coveredDetections}/{shopTheLookStats.totalDetections} detected
            </span>
          ) : null}
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(260px,340px)] xl:gap-10">
        {/* Main lifestyle image + interactive hotspots */}
        <div className="relative min-w-0">
          <div
            className="relative w-full overflow-hidden rounded-[18px] shadow-[0_24px_60px_-28px_rgba(43,37,33,0.45),0_12px_28px_-18px_rgba(43,37,33,0.12)] ring-1 ring-black/[0.06]"
            style={{ backgroundColor: '#ebe6df' }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={outfitImageUrl}
              alt="Outfit with AI-detected pieces highlighted"
              className="w-full max-h-[min(88vh,920px)] object-contain object-center"
              onLoad={(e) => {
                const el = e.currentTarget
                setImgNatural({ w: el.naturalWidth, h: el.naturalHeight })
              }}
            />

            <div className="pointer-events-none absolute left-4 top-4 z-[5] flex flex-wrap gap-2">
              <span className="rounded-full border border-black/15 bg-[#2b2521]/92 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-white shadow-[0_6px_20px_-8px_rgba(0,0,0,0.35)]">
                AI detected items
              </span>
            </div>

            {canDrawBoxes &&
              rows.flatMap((group, rowIdx) => {
                const metas = detectionMetasWithBoxes(group).filter((meta) => {
                  const box = meta.box
                  if (!box) return false
                  return (
                    [box.x1, box.y1, box.x2, box.y2].every((n) => typeof n === 'number' && Number.isFinite(n)) &&
                    box.x2 > box.x1 &&
                    box.y2 > box.y1
                  )
                })
                return metas.map((meta, boxIdx) => {
                  const box = meta.box!
                  const p = boxStylePercents(box, refW, refH)
                  const isSelected = selectedIdx === rowIdx
                  const label = formatDetectionLabel(String(group.detection?.label || group.category || 'Item'))
                  return (
                    <button
                      key={`hotspot-${rowIdx}-${boxIdx}-${group.detectionIndex ?? ''}`}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        focusDetection(rowIdx)
                      }}
                      onMouseEnter={() => setHoveredIdx(rowIdx)}
                      onMouseLeave={() => setHoveredIdx((cur) => (cur === rowIdx ? null : cur))}
                      aria-label={`Select ${label}`}
                      aria-pressed={isSelected}
                      className={`absolute box-border rounded-[12px] border-2 border-brand bg-transparent shadow-none transition-[transform,box-shadow,border-color] duration-[250ms] ease-out [will-change:transform] hover:z-[22] hover:scale-[1.03] hover:shadow-[0_8px_20px_rgba(0,0,0,0.08)] ${
                        isSelected
                          ? 'z-[21] cursor-pointer scale-[1.035] hover:border-brand shadow-[0_0_0_3px_rgb(61_48_48/0.2),0_0_28px_rgb(61_48_48/0.28)]'
                          : 'z-10 cursor-pointer hover:border-brand-hover'
                      }`}
                      style={{
                        left: `${p.left}%`,
                        top: `${p.top}%`,
                        width: `${Math.max(p.width, 6)}%`,
                        height: `${Math.max(p.height, 6)}%`,
                      }}
                    >
                      <span
                        className={`pointer-events-none absolute left-2 top-2 inline-flex h-6 min-w-6 select-none items-center justify-center rounded-full px-1.5 text-[11px] font-bold shadow-sm transition-colors duration-[250ms] ease-out ${
                          isSelected
                            ? 'bg-brand text-white ring-2 ring-white/95'
                            : 'bg-white text-[#2B2521] ring-2 ring-black/[0.06]'
                        }`}
                      >
                        {rowIdx + 1}
                      </span>
                    </button>
                  )
                })
              })}

            <AnimatePresence>
              {selectedIdx !== null &&
              selectedCrop &&
              floatingProduct &&
              floatingProduct.id >= 1 ? (
                <motion.div
                  key={`stl-pop-${selectedIdx}-${floatingProduct.id}`}
                  role="dialog"
                  aria-label="Top match for selection"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                  transition={{ duration: 0.25, ease: 'easeOut' }}
                  className="stl-product-pop absolute z-[35] w-[min(296px,calc(100%-1.75rem))]"
                  style={{
                    left: `${selectedCrop.left + selectedCrop.width / 2}%`,
                    top: `${selectedCrop.top + selectedCrop.height}%`,
                    transform: 'translate(-50%, 12px)',
                    perspective: '1000px',
                  }}
                >
                  <div className="[transform-style:preserve-3d]">
                    <div
                      className="overflow-hidden rounded-2xl border border-[#e8e4df] bg-white shadow-[0_20px_50px_rgba(0,0,0,0.15)] transition-[transform] duration-[250ms] ease-out hover:[transform:perspective(1000px)_rotateY(0deg)] motion-reduce:transition-none"
                      style={{
                        transform: 'perspective(1000px) rotateY(8deg)',
                        transformOrigin: 'center center',
                      }}
                    >
                      <div className="flex gap-3.5 p-3.5 sm:p-4">
                        <div className="relative h-[76px] w-[60px] shrink-0 overflow-hidden rounded-xl bg-[#ece8e3] ring-1 ring-black/[0.04]">
                          {floatingProduct.image_cdn || floatingProduct.image_url ? (
                            <NextImage
                              src={(floatingProduct.image_cdn || floatingProduct.image_url) as string}
                              alt={floatingProduct.title}
                              fill
                              className="object-cover"
                              sizes="60px"
                            />
                          ) : null}
                        </div>
                        <div className="min-w-0 flex-1 pt-0.5">
                          {floatingProduct.brand ? (
                            <p className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-brand">
                              {floatingProduct.brand}
                            </p>
                          ) : null}
                          <p className="mt-0.5 line-clamp-2 text-[13px] font-semibold leading-snug text-[#2B2521]">
                            {floatingProduct.title}
                          </p>
                          {formatProductPrice(floatingProduct) ? (
                            <p className="mt-1 text-[14px] font-semibold tabular-nums text-[#2B2521]">
                              {formatProductPrice(floatingProduct)}
                            </p>
                          ) : null}
                          <Link
                            href={productHref(floatingProduct.id)}
                            onClick={saveScrollBeforeProduct}
                            className="mt-3 inline-flex w-full items-center justify-center rounded-full bg-brand px-4 py-2 text-[12px] font-semibold text-white shadow-md transition-all duration-[250ms] ease-out hover:bg-brand-hover hover:shadow-[0_10px_24px_-8px_rgb(61_48_48/0.45)] active:scale-[0.98]"
                          >
                            View item
                          </Link>
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>

          <p className="mt-3 text-center text-[12px] text-[#6b5348] sm:text-left">
            Drag isn't needed — click a framed region to preview our closest catalog match.
          </p>
        </div>

        {/* Right: detected items panel */}
        <aside className="flex flex-col gap-4 lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)]">
          <div className="rounded-[18px] border border-[#e0d8cf] bg-white p-4 shadow-[0_16px_40px_-28px_rgba(43,37,33,0.2)]">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-brand">Wardrobe map</p>
              <button
                type="button"
                onClick={() => {
                  setSelectedIdx(null)
                  setHighlightedIdx(null)
                }}
                className="text-[12px] font-semibold text-brand underline-offset-4 transition-opacity duration-[250ms] ease-out hover:underline"
              >
                Show all
              </button>
            </div>
            <p className="mt-1 font-display text-lg font-semibold text-[#2B2521]">AI detected items</p>
            <p className="mt-1 text-[13px] leading-snug text-[#6b5348]">
              Select a piece to spotlight its crop and scroll matches below.
            </p>

            <ul className="mt-4 flex max-h-[min(52vh,440px)] flex-col gap-2 overflow-y-auto pr-1 [-ms-overflow-style:none] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-brand/35">
              {rows.map((group, i) => {
                const label = formatDetectionLabel(String(group.detection?.label || group.category || 'Item'))
                const match = topMatchProduct(group)
                const img = match?.image_cdn || match?.image_url || ''
                const price = match ? formatProductPrice(match) : null
                const active = selectedIdx === i
                return (
                  <li key={`panel-${i}-${group.detectionIndex ?? ''}`}>
                    <button
                      type="button"
                      onClick={() => focusDetection(i)}
                      className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-all duration-[250ms] ease-out ${
                        active
                          ? 'border-brand bg-white shadow-[0_0_0_2px_rgb(61_48_48/0.2),0_12px_36px_-16px_rgb(61_48_48/0.35)]'
                          : 'border-transparent bg-[#F5F1EC] hover:border-brand/35 hover:bg-white'
                      }`}
                    >
                      <div className="relative h-14 w-11 shrink-0 overflow-hidden rounded-lg bg-[#ebe6df] ring-1 ring-black/[0.05]">
                        {img ? (
                          <NextImage src={img} alt="" fill className="object-cover" sizes="44px" />
                        ) : (
                          <div className="flex h-full items-center justify-center text-[10px] text-[#9c9088]">—</div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-semibold text-[#2B2521]">{label}</p>
                        <p className="truncate text-[12px] text-brand">Match preview</p>
                        {price ? (
                          <p className="mt-0.5 text-[13px] font-semibold tabular-nums text-[#2B2521]">{price}</p>
                        ) : (
                          <p className="mt-0.5 text-[12px] text-[#9c9088]">Catalog match</p>
                        )}
                      </div>
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px] font-bold transition-colors duration-[250ms] ease-out ${
                          active ? 'bg-brand text-white' : 'bg-white text-brand ring-1 ring-brand/25'
                        }`}
                      >
                        {i + 1}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        </aside>
      </div>

      <section className="mx-auto max-w-7xl space-y-5 pt-2">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-[15px] leading-snug text-[#5c534c]">
              Curated matches for{' '}
              <span className="font-semibold text-[#2B2521]">
                {selectedGroup
                  ? formatDetectionLabel(String(selectedGroup.detection?.label || selectedGroup.category || 'Item'))
                  : 'every detected piece'}
              </span>
            </p>
            <p className="mt-1 text-[13px] text-[#8a7f76]">
              Similar silhouettes and textures from our catalog — refined per region.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setSelectedIdx(null)
              setHighlightedIdx(null)
            }}
            className="inline-flex shrink-0 items-center self-start rounded-full border border-brand/40 bg-white px-4 py-2 text-[12px] font-semibold text-brand transition-[background-color,transform] duration-[250ms] ease-out hover:bg-[#efeae4] active:scale-[0.98]"
          >
            Clear selection
          </button>
        </div>

        {displayIndices.map((i) => {
            const group = rows[i]
            const label = formatDetectionLabel(String(group.detection?.label || group.category || 'Item'))
            const catKeyRaw = String(group.category || 'default').toLowerCase()
            const style = CATEGORY_STYLES[catKeyRaw] || CATEGORY_STYLES.default
            const Icon = style.icon
            const parsed = shopDetectionHitsToProducts(group.products as unknown[])
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
            const hasMore = unique.length > visibleProducts.length
            const selected = selectedIdx === i
            const highlighted = highlightedIdx === i

            return (
              <motion.section
                key={sectionKey}
                ref={(el) => {
                  sectionRefs.current[i] = el
                }}
                initial={{ opacity: 0, y: 12 }}
                animate={{
                  opacity: 1,
                  y: 0,
                  scale: highlighted ? [1, 1.016, 1] : 1,
                }}
                transition={{
                  duration: highlighted ? 0.46 : 0.26,
                  delay: i * 0.04,
                  ease: [0.22, 1, 0.36, 1],
                }}
                className={`rounded-[18px] border bg-white p-4 sm:p-5 shadow-[0_6px_28px_-16px_rgba(42,38,35,0.12)] transition-[box-shadow,border-color] duration-[250ms] ease-out ${
                  highlighted
                    ? 'border-brand ring-2 ring-brand/22 shadow-[0_12px_40px_-18px_rgb(61_48_48/0.28)]'
                    : selected
                      ? 'border-brand/45 shadow-[0_8px_32px_-14px_rgb(61_48_48/0.18)]'
                      : 'border-[#e8e2da]'
                }`}
              >
                <div className="mb-4 flex items-start gap-3">
                  <div className={`flex h-9 w-9 items-center justify-center rounded-lg bg-[#faf9f7] text-[#2a2623] ring-1 ring-[#ebe8e4] ${style.ring}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-[15px] font-semibold text-[#2a2623] truncate">{label}</p>
                    <p className="mt-0.5 text-[13px] text-[#8a847d]">
                      {unique.length} match{unique.length !== 1 ? 'es' : ''}
                    </p>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
                      selected
                        ? 'border-[#d8d2cd] bg-[#ebe6e0] text-[#2a2623]'
                        : 'border-[#e8e4df] bg-white text-[#6b6560]'
                    }`}
                  >
                    Region {i + 1}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 sm:gap-5">
                  {visibleProducts.map((product) => {
                    const img = product.image_cdn || product.image_url || ''
                    const price = formatProductPrice(product)
                    return (
                      <Link
                        key={product.id}
                        href={productHref(product.id)}
                        onClick={saveScrollBeforeProduct}
                        className="group overflow-hidden rounded-2xl border border-[#eadfd7] bg-white transition-all duration-300 hover:-translate-y-1 hover:scale-[1.01] hover:border-[#d8c6bb] hover:shadow-[0_20px_36px_-20px_rgba(90,24,20,0.25)]"
                      >
                        <div className="relative aspect-[3/4] bg-slate-100/90">
                          {img ? (
                            <NextImage
                              src={img}
                              alt={product.title}
                              fill
                              className="object-cover transition-transform duration-300 group-hover:scale-[1.035]"
                              sizes="(max-width: 1024px) 45vw, 220px"
                            />
                          ) : null}
                        </div>
                        <div className="p-3">
                          {product.brand ? (
                            <p className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-[#2a2623]">
                              {product.brand}
                            </p>
                          ) : null}
                          <p className="mt-1 line-clamp-2 text-xs font-medium text-slate-800">{product.title}</p>
                          {price ? <p className="mt-1.5 text-xs font-semibold text-slate-900">{price}</p> : null}
                        </div>
                      </Link>
                    )
                  })}
                </div>

                {hasMore ? (
                  <div className="mt-4 flex justify-center">
                    <button
                      type="button"
                      onClick={() =>
                        setVisibleByKey((prev) => ({
                          ...prev,
                          [sectionKey]: (prev[sectionKey] ?? SHOP_THE_LOOK_INITIAL) + SHOP_THE_LOOK_STEP,
                        }))
                      }
                      className="inline-flex items-center gap-2 rounded-full border-2 border-brand/35 bg-white px-5 py-2.5 text-[13px] font-semibold text-brand hover:bg-brand-muted transition-colors"
                    >
                      <ChevronDown className="w-4 h-4" />
                      Show more
                    </button>
                  </div>
                ) : null}
              </motion.section>
            )
          })}
      </section>
    </motion.div>
  )
}

export default ShopTheLookResults