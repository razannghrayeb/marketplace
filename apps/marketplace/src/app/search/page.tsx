'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense, useState, useCallback, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import Link from 'next/link'
import NextImage from 'next/image'
import { Search, Image, Sparkles, Layers, Camera, Upload, TrendingUp, ArrowRight, Shirt, Palette, Zap, Eye } from 'lucide-react'
import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'
import { ProductCard } from '@/components/product/ProductCard'
import { SearchBar } from '@/components/search/SearchBar'
import { useCompareStore } from '@/store/compare'
import type { Product } from '@/types/product'

function SearchProductGrid({
  products,
  addToCompare,
  inCompare,
}: {
  products: Product[]
  addToCompare: (id: number) => void
  inCompare: (id: number) => boolean
}) {
  const ids = products.map((p) => p.id)
  const { data: variantsData } = useQuery({
    queryKey: ['variants', ids.join(',')],
    queryFn: async () => {
      const res = await api.post<Record<string, { minPriceCents: number; maxPriceCents: number }>>(
        endpoints.products.variantsBatch,
        { productIds: ids }
      )
      return (res as { data?: Record<string, { minPriceCents: number; maxPriceCents: number }> }).data ?? {}
    },
    enabled: ids.length > 0,
  })

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={{
        visible: { transition: { staggerChildren: 0.05 } },
        hidden: {},
      }}
      className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6"
    >
      {products.map((product, i) => {
        const v = variantsData?.[String(product.id)]
        const variantPrice = v && v.minPriceCents !== v.maxPriceCents
          ? { minPriceCents: v.minPriceCents, maxPriceCents: v.maxPriceCents }
          : undefined
        return (
          <motion.div
            key={product.id}
            variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }}
          >
            <ProductCard
              product={product}
              index={i}
              onAddToCompare={addToCompare}
              inCompare={inCompare(product.id)}
              variantPrice={variantPrice}
            />
          </motion.div>
        )
      })}
    </motion.div>
  )
}

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
    .filter((r): r is Record<string, unknown> => Boolean(r && typeof r === 'object' && ('id' in r || 'product_id' in r || 'productId' in r)))
    .map((r) => {
      const raw = r as Record<string, unknown>
      const idRaw = raw.id ?? raw.product_id ?? raw.productId ?? 0
      const id = typeof idRaw === 'number' ? idRaw : Number(idRaw)
      const saleRaw = raw.sales_price_cents ?? raw.salesPriceCents ?? raw.sale_price
      const sales_price_cents = parseCentsField(saleRaw)
      return {
        id: Number.isFinite(id) ? id : 0,
        title: String(raw.title ?? raw.name ?? ''),
        price_cents: priceCentsFromRecord(raw),
        sales_price_cents: sales_price_cents ?? null,
        image_url: (raw.image_url ?? raw.imageUrl ?? raw.image_cdn ?? raw.imageCdn ?? null) as string | null,
        image_cdn: (raw.image_cdn ?? raw.imageCdn ?? null) as string | null,
        brand: (raw.brand as string) ?? null,
        category: (raw.category as string) ?? null,
      } as Product
    })
}

interface DetectionGroup {
  detection?: { label?: string; confidence?: number }
  category?: string
  products: Product[]
}

const CATEGORY_STYLES: Record<string, { icon: typeof Shirt; gradient: string; bg: string }> = {
  tops: { icon: Shirt, gradient: 'from-violet-500 to-fuchsia-500', bg: 'bg-violet-50' },
  bottoms: { icon: Shirt, gradient: 'from-sky-500 to-blue-500', bg: 'bg-sky-50' },
  dresses: { icon: Sparkles, gradient: 'from-rose-500 to-pink-500', bg: 'bg-rose-50' },
  outerwear: { icon: Layers, gradient: 'from-amber-500 to-orange-500', bg: 'bg-amber-50' },
  shoes: { icon: Zap, gradient: 'from-emerald-500 to-teal-500', bg: 'bg-emerald-50' },
  bags: { icon: Eye, gradient: 'from-indigo-500 to-violet-500', bg: 'bg-indigo-50' },
  accessories: { icon: Sparkles, gradient: 'from-pink-500 to-rose-500', bg: 'bg-pink-50' },
  default: { icon: Search, gradient: 'from-neutral-500 to-neutral-600', bg: 'bg-neutral-50' },
}

function formatDetectionLabel(label: string): string {
  return label
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function dedupeGroups(groups: DetectionGroup[]): DetectionGroup[] {
  const merged = new Map<string, DetectionGroup>()
  for (const g of groups) {
    const key = g.category || g.detection?.label || 'unknown'
    const existing = merged.get(key)
    if (existing) {
      const seenIds = new Set(
        toProducts(existing.products as unknown as unknown[]).map((p) => p.id),
      )
      const newProducts = toProducts(g.products as unknown as unknown[]).filter(
        (p) => !seenIds.has(p.id),
      )
      existing.products = [...existing.products, ...newProducts as unknown as Product[]]
    } else {
      merged.set(key, { ...g })
    }
  }
  return Array.from(merged.values())
}

function ShopTheLookResults({ groups, outfitImageUrl }: { groups: DetectionGroup[]; outfitImageUrl: string }) {
  const deduped = dedupeGroups(groups.filter((g) => g.products && g.products.length > 0))
  if (deduped.length === 0) return null

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
      <div className="grid lg:grid-cols-[320px_1fr] gap-8 lg:gap-12">
        {/* ── Left column: outfit image (sticky on desktop) ── */}
        <div className="lg:sticky lg:top-24 lg:self-start flex flex-col items-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="relative w-full max-w-[280px]"
          >
            <div className="absolute -inset-3 rounded-3xl bg-gradient-to-br from-violet-400 via-fuchsia-400 to-rose-400 opacity-20 blur-xl" />
            <div className="relative aspect-[3/4] rounded-2xl overflow-hidden ring-2 ring-white shadow-2xl shadow-violet-500/15">
              <img src={outfitImageUrl} alt="Your outfit" className="w-full h-full object-cover" />
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="mt-5 text-center"
          >
            <span className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-500 text-white text-xs font-bold shadow-lg shadow-violet-500/25">
              <Sparkles className="w-3.5 h-3.5" />
              {deduped.length} item{deduped.length > 1 ? 's' : ''} detected
            </span>
            <p className="text-xs text-neutral-400 mt-2">AI-detected clothing items with similar products</p>
          </motion.div>
        </div>

        {/* ── Right column: category sections ── */}
        <div className="space-y-10 min-w-0">
          {deduped.map((group, i) => {
            const label = group.detection?.label || group.category || 'Item'
            const formatted = formatDetectionLabel(label)
            const catKey = group.category || 'default'
            const style = CATEGORY_STYLES[catKey] || CATEGORY_STYLES.default
            const Icon = style.icon

            const parsed = toProducts(group.products as unknown as unknown[])
            const seen = new Set<number>()
            const unique = parsed.filter((p) => { if (seen.has(p.id)) return false; seen.add(p.id); return true })
            if (unique.length === 0) return null

            return (
              <motion.section
                key={catKey}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 + i * 0.1, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              >
                {/* Section header */}
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${style.gradient} flex items-center justify-center shadow-md`}>
                      <Icon className="w-4.5 h-4.5 text-white" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-neutral-900">{formatted}</h3>
                      <p className="text-[11px] text-neutral-400">{unique.length} similar product{unique.length !== 1 ? 's' : ''} found</p>
                    </div>
                  </div>
                </div>

                {/* Product cards grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {unique.map((product, j) => {
                    const imgUrl = product.image_cdn || product.image_url || ''
                    const cents = typeof product.price_cents === 'string' ? parseInt(product.price_cents, 10) : product.price_cents
                    const price = cents > 0
                      ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(cents / 100)
                      : null
                    return (
                      <motion.div
                        key={product.id}
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 + i * 0.1 + j * 0.04, duration: 0.35 }}
                      >
                        <Link href={`/products/${product.id}`} className="group block rounded-2xl bg-white border border-neutral-200/80 overflow-hidden shadow-sm hover:shadow-xl hover:shadow-violet-500/10 hover:border-violet-200 hover:-translate-y-1 transition-all duration-300">
                          <div className="relative aspect-[3/4] bg-neutral-50">
                            {imgUrl && (
                              <NextImage
                                src={imgUrl}
                                alt={product.title}
                                fill
                                className="object-cover group-hover:scale-105 transition-transform duration-500"
                                sizes="(max-width: 640px) 45vw, 200px"
                                onError={(e) => { e.currentTarget.src = 'https://placehold.co/320x426/f5f5f5/737373?text=No+Image' }}
                              />
                            )}
                          </div>
                          <div className="p-3">
                            {product.brand && <p className="text-[10px] font-semibold text-violet-600 uppercase tracking-wider truncate">{product.brand}</p>}
                            <p className="text-sm font-medium text-neutral-800 line-clamp-1 mt-0.5">{product.title}</p>
                            {price && <p className="text-sm font-bold text-neutral-900 mt-1">{price}</p>}
                          </div>
                        </Link>
                      </motion.div>
                    )
                  })}
                </div>

                {/* Divider between sections */}
                {i < deduped.length - 1 && (
                  <div className="border-b border-neutral-200/60 mt-8" />
                )}
              </motion.section>
            )
          })}
        </div>
      </div>
    </motion.div>
  )
}

function SearchContent() {
  const searchParams = useSearchParams()
  const q = searchParams.get('q') || ''
  const mode = searchParams.get('mode') || 'text'
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [multiImages, setMultiImages] = useState<File[]>([])
  const [multiPrompt, setMultiPrompt] = useState('')
  const [multiRequestBody, setMultiRequestBody] = useState<{ files: File[]; prompt: string } | null>(null)
  const [multiSearchVersion, setMultiSearchVersion] = useState(0)
  const [searchTrigger, setSearchTrigger] = useState(0)
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string>('')
  const [multiImageUrls, setMultiImageUrls] = useState<string[]>([])
  const addToCompare = useCompareStore((s) => s.add)
  const inCompare = useCompareStore((s) => s.has)

  useEffect(() => {
    if (!imageFile) {
      setImagePreviewUrl('')
      return
    }
    const url = URL.createObjectURL(imageFile)
    setImagePreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [imageFile])

  useEffect(() => {
    const urls = multiImages.map((f) => URL.createObjectURL(f))
    setMultiImageUrls(urls)
    return () => urls.forEach((u) => URL.revokeObjectURL(u))
  }, [multiImages])

  const handleSubmit = useCallback(() => setSearchTrigger((t) => t + 1), [])

  const runMultiSearch = useCallback(() => {
    if (multiImages.length === 0 || !multiPrompt.trim()) return
    setMultiRequestBody({ files: [...multiImages], prompt: multiPrompt.trim() })
    setMultiSearchVersion((v) => v + 1)
  }, [multiImages, multiPrompt])

  useEffect(() => {
    if (mode !== 'multi') {
      setMultiRequestBody(null)
      setMultiSearchVersion(0)
    }
  }, [mode])

  const imageKey = imageFile ? `${imageFile.name}-${imageFile.size}-${imageFile.lastModified}` : ''
  const queryKey =
    mode === 'multi'
      ? (['search', 'multi', multiSearchVersion] as const)
      : mode === 'shop'
        ? (['search', 'shop', imageKey, searchTrigger] as const)
        : mode === 'image'
          ? (['search', 'image', imageKey, searchTrigger] as const)
          : (['search', 'text', q.trim()] as const)

  const searchEnabled =
    mode === 'multi'
      ? multiSearchVersion > 0 &&
        !!multiRequestBody &&
        multiRequestBody.files.length > 0 &&
        !!multiRequestBody.prompt.trim()
      : mode === 'shop' || mode === 'image'
        ? !!imageFile && searchTrigger > 0
        : !!q.trim()

  const { data, isLoading, isFetching, isError, error } = useQuery({
    queryKey: [...queryKey],
    queryFn: async () => {
      if (mode === 'multi') {
        const body = multiRequestBody
        if (!body?.files?.length || !body.prompt.trim()) return { results: [], query: null }
        const formData = new FormData()
        body.files.forEach((f) => formData.append('images', f))
        formData.append('prompt', body.prompt.trim())
        const res = await api.postForm<unknown>(endpoints.search.multiImage, formData)
        const raw = res as {
          results?: unknown[]
          data?: unknown
          error?: string | { message?: string }
          success?: boolean
        }
        if (raw?.success === false || raw?.error) {
          const err = raw.error
          const msg =
            typeof err === 'string' ? err : err && typeof err === 'object' && 'message' in err ? String((err as { message?: string }).message) : ''
          throw new Error(msg || 'Mix & match search failed')
        }
        const nested = raw?.data && typeof raw.data === 'object' ? (raw.data as { results?: unknown[] }) : null
        const results =
          raw?.results ??
          nested?.results ??
          (Array.isArray(raw?.data) ? raw.data : undefined) ??
          []
        return { results: Array.isArray(results) ? results : [], query: { mixMatch: true } }
      }
      if (mode === 'shop' && imageFile) {
        const formData = new FormData()
        formData.append('image', imageFile)
        const res = await api.postForm(endpoints.images.search, formData)
        const raw = res as { success?: boolean; error?: { message?: string }; similarProducts?: { byDetection?: Array<{ detection?: { label?: string }; products?: unknown[] }> } }
        if (raw?.success === false) {
          throw new Error(raw?.error?.message ?? 'Shop the look failed')
        }
        const byDetection = raw?.similarProducts?.byDetection ?? []
        const results = byDetection.flatMap((d) => d.products ?? [])
        return { results, query: { shopTheLook: true }, byDetection }
      }
      if (mode === 'image' && imageFile) {
        const formData = new FormData()
        formData.append('image', imageFile)
        let res: unknown
        try {
          res = await api.postForm(endpoints.products.searchImage, formData)
        } catch {
          res = await api.postForm(endpoints.search.image, formData)
        }
        const raw = res as { success?: boolean; error?: { message?: string }; results?: unknown[]; data?: unknown[] }
        if (raw?.success === false) {
          throw new Error(raw?.error?.message ?? 'Image search failed')
        }
        const results = raw?.data ?? raw?.results ?? []
        return { results: Array.isArray(results) ? results : [], query: { original: 'Image search' } }
      }
      if (q.trim()) {
        let res = await api.get(endpoints.search.text, { q: q.trim(), limit: 24, page: 1 })
        if (res.success === false) {
          res = await api.get(endpoints.products.search, { q: q.trim(), limit: 24, page: 1 })
        }
        const resData = res as { success?: boolean; error?: { message?: string }; data?: { results?: Product[] }; results?: Product[] }
        if (resData?.success === false) {
          throw new Error(resData?.error?.message ?? 'Backend unavailable (502). Check Render dashboard.')
        }
        const results = resData?.data?.results || resData?.results || (Array.isArray(resData?.data) ? resData.data : [])
        return { results: Array.isArray(results) ? results : [], query: resData?.data }
      }
      return { results: [], query: null }
    },
    enabled: searchEnabled,
  })

  const rawResults = data && (data as { results?: unknown[] }).results
  const products = toProducts(Array.isArray(rawResults) ? rawResults : [])
  const shopDetections: DetectionGroup[] = (data as { byDetection?: DetectionGroup[] })?.byDetection ?? []

  const isLoadingState = isLoading || isFetching

  const modeTabs = [
    { key: 'text', label: 'Text', Icon: Search, href: '/search', desc: 'Describe what you want' },
    { key: 'image', label: 'Image', Icon: Image, href: '/search?mode=image', desc: 'Upload a photo' },
    { key: 'shop', label: 'Shop the look', Icon: Sparkles, href: '/search?mode=shop', desc: 'AI detects items' },
    { key: 'multi', label: 'Mix & Match', Icon: Layers, href: '/search?mode=multi', desc: 'Blend references' },
  ]

  const suggestedSearches = [
    { label: 'Summer dresses', icon: Shirt, gradient: 'from-rose-500 to-orange-400' },
    { label: 'Casual sneakers', icon: TrendingUp, gradient: 'from-violet-500 to-indigo-500' },
    { label: 'Evening outfit', icon: Sparkles, gradient: 'from-fuchsia-500 to-pink-500' },
    { label: 'Colorful accessories', icon: Palette, gradient: 'from-sky-500 to-cyan-400' },
  ]

  const { data: trendingProducts } = useQuery({
    queryKey: ['search-trending'],
    queryFn: async () => {
      const res = await api.get<Array<{
        id: number; title: string; brand?: string | null; category?: string | null
        price_cents: number; currency?: string; image_cdn?: string | null; image_url?: string | null
      }>>(endpoints.products.list, { limit: 8, page: 1 })
      const raw = Array.isArray(res?.data) ? res.data : []
      return raw.filter((p: { image_cdn?: string | null; image_url?: string | null }) => p.image_cdn || p.image_url).slice(0, 6)
    },
    staleTime: 5 * 60_000,
    enabled: !q && mode === 'text',
  })

  return (
    <>
      {/* ── Header area with mesh background ── */}
      <div className="relative overflow-hidden bg-gradient-to-b from-violet-50 via-fuchsia-50/40 to-neutral-100 border-b border-neutral-200/60">
        <div className="pointer-events-none absolute -top-20 -right-20 h-72 w-72 rounded-full bg-violet-200/40 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute top-10 -left-16 h-56 w-56 rounded-full bg-fuchsia-200/30 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute bottom-0 left-1/2 h-48 w-48 rounded-full bg-amber-200/20 blur-3xl" aria-hidden />

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-8">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
          >
            <div className="flex items-center gap-3 mb-5">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-md shadow-violet-500/20">
                <Search className="w-5 h-5" />
              </div>
              <div>
                <h1 className="font-display text-2xl sm:text-3xl font-bold text-neutral-900">Discover</h1>
                <p className="text-sm text-neutral-500 mt-0.5">Search by text, image, or blended references</p>
              </div>
            </div>

            <SearchBar placeholder='Search "red summer dress", "casual sneakers"...' initialQuery={q} />

            {/* Mode tabs as mini cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-5">
              {modeTabs.map((tab, i) => (
                <motion.a
                  key={tab.key}
                  href={tab.href}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 + i * 0.05 }}
                  className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
                    mode === tab.key
                      ? 'bg-gradient-to-r from-violet-600 to-fuchsia-500 text-white shadow-md shadow-violet-500/20'
                      : 'bg-white/80 text-neutral-600 border border-neutral-200/80 hover:border-violet-200 hover:text-violet-700 hover:bg-violet-50/50 backdrop-blur-sm'
                  }`}
                >
                  <tab.Icon className="w-4 h-4 shrink-0" />
                  <div className="min-w-0">
                    <p className="leading-tight">{tab.label}</p>
                    <p className={`text-[10px] font-normal leading-tight mt-0.5 ${mode === tab.key ? 'text-white/80' : 'text-neutral-400'}`}>{tab.desc}</p>
                  </div>
                </motion.a>
              ))}
            </div>
          </motion.div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="mb-8"
        >

          {(mode === 'image' || mode === 'shop') && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-6"
            >
              {!imageFile ? (
                <div className="relative p-8 sm:p-10 rounded-2xl border-2 border-dashed border-violet-200 bg-gradient-to-br from-violet-50/60 via-white to-fuchsia-50/40 hover:border-violet-300 transition-colors">
                  <div className="text-center">
                    <div className="relative w-16 h-16 mx-auto mb-4">
                      <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 opacity-15 blur-lg" />
                      <div className="relative w-16 h-16 rounded-xl bg-gradient-to-br from-violet-100 to-fuchsia-100 flex items-center justify-center">
                        {mode === 'shop' ? <Sparkles className="w-7 h-7 text-violet-600" /> : <Image className="w-7 h-7 text-violet-600" />}
                      </div>
                    </div>
                    <p className="text-base font-semibold text-neutral-800 mb-1">
                      {mode === 'shop' ? 'Upload an outfit photo' : 'Upload a fashion image'}
                    </p>
                    <p className="text-sm text-neutral-500 mb-6 max-w-sm mx-auto">
                      {mode === 'shop'
                        ? 'AI will detect individual items and find similar products for each one.'
                        : 'Find visually similar products from our catalog instantly.'}
                    </p>

                    <input type="file" accept="image/*" id="image-file-pick" className="hidden"
                      onChange={(e) => { setImageFile(e.target.files?.[0] || null); e.target.value = '' }} />
                    <input type="file" accept="image/*" capture="environment" id="image-camera-capture" className="hidden"
                      onChange={(e) => { setImageFile(e.target.files?.[0] || null); e.target.value = '' }} />

                    <div className="flex flex-wrap justify-center gap-3">
                      <label htmlFor="image-file-pick"
                        className="cursor-pointer inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-white text-violet-700 text-sm font-semibold border border-violet-200 hover:bg-violet-50 hover:border-violet-300 shadow-sm active:scale-[0.97] transition-all">
                        <Upload className="w-4 h-4" />
                        Choose file
                      </label>
                      <label htmlFor="image-camera-capture"
                        className="cursor-pointer inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-500 text-white text-sm font-semibold hover:from-violet-500 hover:to-fuchsia-400 shadow-md shadow-violet-500/20 active:scale-[0.97] transition-all">
                        <Camera className="w-4 h-4" />
                        Take a photo
                      </label>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-5 rounded-2xl bg-white border border-neutral-200 shadow-sm">
                  <div className="flex items-start gap-5">
                    <div className="relative w-28 h-28 sm:w-36 sm:h-36 rounded-xl overflow-hidden bg-neutral-100 flex-shrink-0 ring-1 ring-neutral-200">
                      <img src={imagePreviewUrl} alt="Preview" className="object-cover w-full h-full" />
                    </div>
                    <div className="flex-1 min-w-0 pt-1">
                      <p className="text-sm font-semibold text-neutral-800 truncate">{imageFile.name}</p>
                      <p className="text-xs text-neutral-500 mt-0.5">{(imageFile.size / 1024).toFixed(0)} KB</p>
                      <div className="flex flex-wrap gap-2 mt-4">
                        <button type="button" onClick={handleSubmit}
                          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-500 text-white text-sm font-semibold hover:from-violet-500 hover:to-fuchsia-400 shadow-md shadow-violet-500/20 active:scale-[0.97] transition-all">
                          <Search className="w-4 h-4" />
                          Search
                        </button>
                        <button type="button" onClick={() => setImageFile(null)}
                          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100 transition-all">
                          Change image
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {mode === 'multi' && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-6 p-6 rounded-2xl bg-gradient-to-br from-indigo-50/60 via-white to-violet-50/40 border border-indigo-100"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white flex items-center justify-center shadow-md">
                  <Layers className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-neutral-800">Mix & Match</p>
                  <p className="text-xs text-neutral-500">Upload 1–5 images and describe what you want from each</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 mb-4">
                <input type="file" accept="image/*" multiple id="multi-image-input" className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files || [])
                    setMultiImages((prev) => [...prev, ...files].slice(0, 5))
                    e.target.value = ''
                  }}
                />
                <label htmlFor="multi-image-input"
                  className="cursor-pointer flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white text-indigo-700 font-semibold text-sm border border-indigo-200 hover:bg-indigo-50 hover:border-indigo-300 shadow-sm transition-all">
                  <Image className="w-4 h-4" />
                  Choose images
                </label>
                {multiImages.length > 0 && (
                  <button type="button" onClick={() => setMultiImages([])}
                    className="text-sm text-neutral-500 hover:text-neutral-700 px-3 py-2">
                    Clear all
                  </button>
                )}
              </div>

              {multiImages.length > 0 && (
                <div className="flex flex-wrap gap-3 mb-4">
                  {multiImages.map((file, i) => (
                    <motion.div
                      key={`${file.name}-${i}`}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="relative group"
                    >
                      <div className="w-20 h-24 rounded-xl overflow-hidden bg-neutral-100 border border-neutral-200 ring-2 ring-offset-1 ring-indigo-200 shadow-sm">
                        <img src={multiImageUrls[i] ?? ''} alt={`Preview ${i + 1}`} className="object-cover w-full h-full" />
                      </div>
                      <button type="button" onClick={() => setMultiImages((p) => p.filter((_, j) => j !== i))}
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-rose-500 text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                        aria-label="Remove">×</button>
                      <div className="absolute bottom-0 inset-x-0 bg-black/50 text-white text-[10px] font-bold text-center py-0.5 rounded-b-xl">
                        {i + 1}
                      </div>
                    </motion.div>
                  ))}
                  {multiImages.length < 5 && (
                    <label htmlFor="multi-image-input"
                      className="w-20 h-24 rounded-xl border-2 border-dashed border-neutral-300 flex flex-col items-center justify-center text-neutral-400 hover:border-indigo-300 hover:text-indigo-500 cursor-pointer transition-colors">
                      <span className="text-2xl leading-none">+</span>
                      <span className="text-[10px] mt-0.5">Add</span>
                    </label>
                  )}
                </div>
              )}

              {multiImages.length > 0 && (
                <p className="text-xs text-indigo-600 font-medium mb-3">
                  {multiImages.length}/5 image{multiImages.length > 1 ? 's' : ''} selected
                </p>
              )}

              <textarea
                placeholder="e.g. &quot;Use the color from the first image and the style from the second&quot;"
                value={multiPrompt}
                onChange={(e) => setMultiPrompt(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-neutral-200 bg-white text-neutral-700 placeholder-neutral-400 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 resize-none mb-4"
                rows={3}
              />
              {multiImages.length > 0 && multiPrompt.trim() && (
                <button type="button" onClick={runMultiSearch}
                  className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-500 text-white font-semibold text-sm hover:from-indigo-500 hover:to-violet-400 shadow-md shadow-indigo-500/20 active:scale-[0.97] transition-all">
                  <Search className="w-4 h-4" />
                  Search
                </button>
              )}
            </motion.div>
          )}
        </motion.div>

        <div className="min-h-[320px]">
          {isLoadingState ? (
            mode === 'shop' ? (
              <div className="grid lg:grid-cols-[320px_1fr] gap-8 lg:gap-12">
                <div className="flex flex-col items-center">
                  <div className="w-full max-w-[280px] aspect-[3/4] rounded-2xl skeleton-shimmer ring-1 ring-neutral-200/60" />
                  <div className="h-6 w-32 rounded-full skeleton-shimmer mt-5" />
                </div>
                <div className="space-y-8">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="space-y-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl skeleton-shimmer" />
                        <div className="space-y-1.5">
                          <div className="h-4 w-28 rounded skeleton-shimmer" />
                          <div className="h-2.5 w-20 rounded skeleton-shimmer" />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                        {[0, 1, 2].map((j) => (
                          <div key={j} className="rounded-2xl border border-neutral-200/60 overflow-hidden">
                            <div className="aspect-[3/4] skeleton-shimmer" />
                            <div className="p-3 space-y-2">
                              <div className="h-2.5 w-1/3 rounded skeleton-shimmer" />
                              <div className="h-3 w-3/4 rounded skeleton-shimmer" />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5 sm:gap-6">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="space-y-3">
                    <div className="aspect-[3/4] rounded-2xl skeleton-shimmer ring-1 ring-neutral-200/60" />
                    <div className="h-3 w-2/3 rounded-md skeleton-shimmer" />
                    <div className="h-3 w-1/2 rounded-md skeleton-shimmer" />
                  </div>
                ))}
              </div>
            )
          ) : mode === 'shop' && shopDetections.length > 0 && imagePreviewUrl ? (
            <ShopTheLookResults groups={shopDetections} outfitImageUrl={imagePreviewUrl} />
          ) : products.length > 0 ? (
            <>
              <div className="flex items-center justify-between mb-6">
                <p className="text-sm font-medium text-neutral-500">{products.length} result{products.length !== 1 ? 's' : ''} found</p>
              </div>
              <SearchProductGrid
                products={products}
                addToCompare={addToCompare}
                inCompare={inCompare}
              />
            </>
          ) : isError ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center py-16 max-w-lg mx-auto"
            >
              <div className="w-16 h-16 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center mx-auto mb-5">
                <Search className="w-8 h-8" />
              </div>
              <p className="font-bold text-neutral-900 text-lg mb-2">Connection issue</p>
              <p className="text-sm text-neutral-600 mb-4">{(error as Error)?.message ?? 'The backend is down or not responding.'}</p>
              <p className="text-xs text-neutral-400">Check that the API is running and configured correctly.</p>
            </motion.div>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15, duration: 0.5 }}
              className="py-12"
            >
              {mode === 'multi' ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-center max-w-md mx-auto py-4"
                >
                  <p className="text-neutral-500">
                    {multiImages.length === 0 || !multiPrompt.trim()
                      ? 'Upload images and describe what you want to get started.'
                      : multiSearchVersion === 0
                        ? 'Click Search above to find products.'
                        : 'No matching products found. Try a different prompt or images.'}
                  </p>
                </motion.div>
              ) : (mode === 'image' || mode === 'shop') && !imageFile ? (
                null
              ) : imageFile && searchTrigger === 0 ? (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center max-w-md mx-auto py-6">
                  <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-violet-100 to-fuchsia-100 flex items-center justify-center mx-auto mb-4">
                    <ArrowRight className="w-6 h-6 text-violet-600 -rotate-45" />
                  </div>
                  <p className="text-neutral-600 font-medium">Hit <span className="text-violet-600 font-bold">Search</span> above to find similar products.</p>
                </motion.div>
              ) : imageFile ? (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center max-w-md mx-auto py-6">
                  <div className="w-14 h-14 rounded-xl bg-neutral-100 flex items-center justify-center mx-auto mb-4">
                    <Search className="w-6 h-6 text-neutral-400" />
                  </div>
                  <p className="font-semibold text-neutral-800 mb-1">No similar products found</p>
                  <p className="text-sm text-neutral-500">Try text search or a different image.</p>
                </motion.div>
              ) : q ? (
                <div className="text-center max-w-md mx-auto">
                  <div className="w-16 h-16 rounded-2xl bg-neutral-100 text-neutral-400 flex items-center justify-center mx-auto mb-5">
                    <Search className="w-8 h-8" />
                  </div>
                  <p className="font-bold text-neutral-900 text-lg mb-2">No results for &ldquo;{q}&rdquo;</p>
                  <p className="text-neutral-500">Try different keywords or browse by category.</p>
                </div>
              ) : (
                /* ── Rich empty state ── */
                <div className="max-w-5xl mx-auto">
                  {/* Hero prompt */}
                  <div className="text-center mb-10">
                    <motion.div
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                      className="relative w-20 h-20 mx-auto mb-6"
                    >
                      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 opacity-20 blur-xl animate-pulse" />
                      <div className="relative w-20 h-20 rounded-2xl bg-gradient-to-br from-violet-100 to-fuchsia-100 flex items-center justify-center">
                        <Search className="w-9 h-9 text-violet-600" />
                      </div>
                    </motion.div>
                    <motion.h2
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.1 }}
                      className="font-display text-xl sm:text-2xl font-bold text-neutral-900 mb-2"
                    >
                      What are you looking for?
                    </motion.h2>
                    <motion.p
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.18 }}
                      className="text-neutral-500 max-w-md mx-auto"
                    >
                      Type a description, upload an image, or try one of these popular searches.
                    </motion.p>
                  </div>

                  {/* Quick search categories */}
                  <motion.div
                    initial="hidden"
                    animate="visible"
                    variants={{ visible: { transition: { staggerChildren: 0.06 } }, hidden: {} }}
                    className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-10"
                  >
                    {suggestedSearches.map((s) => (
                      <motion.a
                        key={s.label}
                        href={`/search?q=${encodeURIComponent(s.label)}`}
                        variants={{ hidden: { opacity: 0, y: 14 }, visible: { opacity: 1, y: 0 } }}
                        whileHover={{ y: -4, scale: 1.02 }}
                        className="group relative flex flex-col items-center gap-3 p-5 rounded-2xl border border-neutral-200/80 bg-white overflow-hidden hover:shadow-xl hover:shadow-violet-500/10 transition-shadow duration-300"
                      >
                        <div className={`absolute inset-0 bg-gradient-to-br ${s.gradient} opacity-0 group-hover:opacity-[0.06] transition-opacity duration-300`} />
                        <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${s.gradient} text-white flex items-center justify-center shadow-lg`}>
                          <s.icon className="w-5.5 h-5.5" />
                        </div>
                        <span className="text-sm font-semibold text-neutral-700 group-hover:text-neutral-900 transition-colors">{s.label}</span>
                        <ArrowRight className="w-4 h-4 text-neutral-300 group-hover:text-violet-500 group-hover:translate-x-1 transition-all" />
                      </motion.a>
                    ))}
                  </motion.div>

                  {/* Trending products */}
                  {trendingProducts && trendingProducts.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.35, duration: 0.5 }}
                    >
                      <div className="flex items-center gap-2 mb-5">
                        <Zap className="w-4 h-4 text-amber-500" />
                        <h3 className="font-display text-base font-bold text-neutral-800">Trending now</h3>
                      </div>
                      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                        {(trendingProducts as Array<{
                          id: number; title: string; brand?: string | null
                          price_cents: number; image_cdn?: string | null; image_url?: string | null
                        }>).map((p, i) => (
                          <motion.div
                            key={p.id}
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.4 + i * 0.06 }}
                          >
                            <Link
                              href={`/products/${p.id}`}
                              className="group block rounded-2xl overflow-hidden bg-white border border-neutral-200/80 hover:shadow-lg hover:shadow-violet-500/10 hover:-translate-y-1 transition-all duration-300"
                            >
                              <div className="relative aspect-[3/4] bg-neutral-100">
                                <NextImage
                                  src={p.image_cdn || p.image_url || ''}
                                  alt={p.title}
                                  fill
                                  sizes="(max-width: 640px) 33vw, 16vw"
                                  className="object-cover group-hover:scale-105 transition-transform duration-500"
                                />
                                <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                              </div>
                              <div className="p-2.5">
                                {p.brand && <p className="text-[10px] font-semibold uppercase tracking-wider text-violet-600 truncate">{p.brand}</p>}
                                <p className="text-xs font-medium text-neutral-700 truncate mt-0.5">{p.title}</p>
                                <p className="text-xs font-bold text-neutral-900 mt-1">
                                  {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(p.price_cents / 100)}
                                </p>
                              </div>
                            </Link>
                          </motion.div>
                        ))}
                      </div>
                    </motion.div>
                  )}

                  {/* Trending tags */}
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.6 }}
                    className="flex flex-wrap justify-center gap-2 text-xs mt-10"
                  >
                    {['Floral maxi dress', 'White sneakers', 'Leather jacket', 'Silk blouse', 'Denim jeans', 'Boho chic', 'Minimalist bags'].map((term) => (
                      <a
                        key={term}
                        href={`/search?q=${encodeURIComponent(term)}`}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white border border-neutral-200/80 text-neutral-600 hover:bg-violet-50 hover:border-violet-200 hover:text-violet-700 transition-all duration-200 shadow-sm"
                      >
                        <TrendingUp className="w-3 h-3" />
                        {term}
                      </a>
                    ))}
                  </motion.div>

                  {/* How it works strip */}
                  <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.7 }}
                    className="mt-14 p-6 rounded-2xl bg-gradient-to-r from-violet-50 via-fuchsia-50 to-rose-50 border border-violet-100/60"
                  >
                    <p className="text-xs font-bold uppercase tracking-wider text-violet-600 mb-4 text-center">How it works</p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                      {[
                        { step: '01', title: 'Choose a mode', desc: 'Text, image, shop the look, or mix & match.', Icon: Sparkles },
                        { step: '02', title: 'Provide input', desc: 'Type a query, upload a photo, or combine references.', Icon: Upload },
                        { step: '03', title: 'Get results', desc: 'AI finds visually similar products instantly.', Icon: Zap },
                      ].map((s) => (
                        <div key={s.step} className="flex items-start gap-3">
                          <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-white flex items-center justify-center shadow-sm border border-violet-100/60">
                            <s.Icon className="w-4 h-4 text-violet-600" />
                          </div>
                          <div>
                            <p className="text-xs font-bold text-violet-400 mb-0.5">{s.step}</p>
                            <p className="text-sm font-semibold text-neutral-800">{s.title}</p>
                            <p className="text-xs text-neutral-500 mt-0.5">{s.desc}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                </div>
              )}
            </motion.div>
          )}
        </div>
      </div>
    </>
  )
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="min-h-[60vh] flex items-center justify-center">Loading...</div>}>
      <SearchContent />
    </Suspense>
  )
}
