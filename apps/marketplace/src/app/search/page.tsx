'use client'

import dynamic from 'next/dynamic'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState, useCallback, useEffect, useMemo, memo } from 'react'
import { useQuery, useMutation, keepPreviousData } from '@tanstack/react-query'
import { getStablePagination } from '@/lib/shopPagination'
import { compressImageForShopUpload } from '@/lib/image/compressImageForShopUpload'
import { motion } from 'framer-motion'
import Link from 'next/link'
import {
  Search,
  Sparkles,
  Zap,
  ArrowRight,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Camera,
  Upload,
  SlidersHorizontal,
  Loader2,
} from 'lucide-react'
import { api, type ApiResponse } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'
import { ProductCard } from '@/components/product/ProductCard'
import { SearchBar } from '@/components/search/SearchBar'
import { TextSearchProductCard } from '@/components/search/TextSearchProductCard'
import { DiscoverHeroMasonry } from '@/components/search/DiscoverHeroMasonry'
import {
  normalizeShopTheLookGroups,
  type DetectionGroup,
  type ShopTheLookStats,
} from '@/lib/shopTheLookNormalize'
import { useCompareStore } from '@/store/compare'
import type { Product } from '@/types/product'
import { mergeVendorFromHit } from '@/lib/vendorLogo'
import { readAndClearListingScrollY } from '@/lib/navigation/listingScrollRestore'

const ShopTheLookResultsPanel = dynamic(() => import('@/components/search/ShopTheLookResults'), {
  ssr: false,
  loading: () => (
    <div className="flex flex-col items-center justify-center gap-3 py-16 min-h-[200px]" aria-busy>
      <Loader2 className="h-9 w-9 animate-spin text-brand" aria-hidden />
      <p className="text-sm text-neutral-500">Loading shop-the-look…</p>
    </div>
  ),
})

const TRYON_SHOP_SESSION_KEY = 'styleai_tryon_shop_payload'

type HydratedShopPayload = {
  byDetection?: DetectionGroup[]
  shopImageMeta?: { width: number; height: number }
  shopTheLookStats?: ShopTheLookStats
  outfitImageUrl?: string
  source?: string
  savedAt?: number
}

const SearchProductGrid = memo(function SearchProductGrid({
  products,
  addToCompare,
  fromReturnPath,
}: {
  products: Product[]
  addToCompare: (id: number) => void
  fromReturnPath?: string
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
      {products.map((product, i) => (
        <div key={product.id}>
          <ProductCard
            product={product}
            index={i}
            snappyMotion
            fromReturnPath={fromReturnPath}
            onAddToCompare={addToCompare}
          />
        </div>
      ))}
    </div>
  )
})

const TEXT_SEARCH_GENDER_CHIPS = ['All', 'Men', 'Women'] as const

const TRY_SEARCHING_TAGS = [
  'blue striped shirt',
  'black formal shirt',
  'oversized t-shirt',
  'linen kurta',
  'summer dress',
] as const

const TextSearchProductGrid = memo(function TextSearchProductGrid({
  products,
  fromReturnPath,
}: {
  products: Product[]
  fromReturnPath?: string
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 sm:gap-5">
      {products.map((product) => (
        <TextSearchProductCard key={product.id} product={product} fromReturnPath={fromReturnPath} />
      ))}
    </div>
  )
})

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

const TEXT_SEARCH_PAGE_SIZE = 24

/** Normalize GET /products/search (and legacy GET /search) responses for paginated text search */
function extractTextSearchPage(res: unknown): { results: unknown[]; total: number } {
  const r = res as {
    success?: boolean
    error?: { message?: string }
    results?: unknown[]
    data?: unknown[] | { results?: unknown[] }
    total?: number
    meta?: {
      open_search_total_estimate?: number
      total_results?: number
      total_above_threshold?: number
      total?: number
      pages?: number
    }
    pagination?: { total?: number; pages?: number }
  }
  if (r?.success === false) {
    throw new Error(r?.error?.message ?? 'Search failed')
  }
  let results: unknown[] = []
  if (Array.isArray(r.results)) results = r.results
  else if (r.data && Array.isArray(r.data)) results = r.data
  else if (r.data && typeof r.data === 'object' && Array.isArray((r.data as { results?: unknown[] }).results)) {
    results = (r.data as { results: unknown[] }).results
  }
  let total = typeof r.total === 'number' && Number.isFinite(r.total) ? r.total : 0
  const pag = r.pagination
  if (!total && pag && typeof pag.total === 'number' && pag.total > 0) total = pag.total
  if (!total && r.meta && typeof r.meta === 'object') {
    const mt = r.meta.total
    const est = r.meta.open_search_total_estimate
    const tr = r.meta.total_results
    const ta = r.meta.total_above_threshold
    if (typeof mt === 'number' && mt > 0) total = mt
    else if (typeof est === 'number' && est > 0) total = est
    else if (typeof tr === 'number' && tr > 0) total = tr
    else if (typeof ta === 'number' && ta > 0) total = ta
  }
  return { results, total }
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
        ...mergeVendorFromHit(src, raw),
      } as Product
    })
}


function SearchContent() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const q = searchParams.get('q') || ''
  const pageFromUrl = Math.max(1, Math.min(999, parseInt(searchParams.get('page') || '1', 10) || 1))
  const rawMode = searchParams.get('mode')
  const mode = rawMode === 'shop' ? 'shop' : 'text'
  const genderRaw = (searchParams.get('gender') ?? '').toLowerCase()
  const genderFilter = genderRaw === 'men' || genderRaw === 'women' ? genderRaw : null

  useEffect(() => {
    if (rawMode === 'image' || rawMode === 'multi') {
      const next = new URLSearchParams(searchParams.toString())
      next.delete('mode')
      const qs = next.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname)
    }
  }, [rawMode, pathname, router, searchParams])

  const discoverReturnPath = useMemo(() => {
    const qs = searchParams.toString()
    return qs ? `/search?${qs}` : '/search'
  }, [searchParams])

  useEffect(() => {
    const y = readAndClearListingScrollY(discoverReturnPath)
    if (y == null) return
    const id = requestAnimationFrame(() => {
      window.scrollTo({ top: y, behavior: 'instant' })
    })
    return () => cancelAnimationFrame(id)
  }, [discoverReturnPath])

  const goSearchPage = useCallback(
    (p: number) => {
      const next = new URLSearchParams(searchParams.toString())
      if (p <= 1) next.delete('page')
      else next.set('page', String(p))
      const qs = next.toString()
      router.push(qs ? `${pathname}?${qs}` : pathname)
    },
    [router, pathname, searchParams],
  )

  const setGenderFilter = useCallback(
    (chip: string) => {
      const next = new URLSearchParams(searchParams.toString())
      const lower = chip.toLowerCase()
      if (lower === 'all') next.delete('gender')
      else if (lower === 'men' || lower === 'women') next.set('gender', lower)
      next.delete('page')
      const qs = next.toString()
      router.push(qs ? `${pathname}?${qs}` : pathname)
    },
    [pathname, router, searchParams],
  )

  const addToCompare = useCompareStore((s) => s.add)

  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreviewUrl, setImagePreviewUrl] = useState('')
  const [hydratedShop, setHydratedShop] = useState<HydratedShopPayload | null>(null)
  const [pageJumpDraft, setPageJumpDraft] = useState(() => String(pageFromUrl))

  useEffect(() => {
    setPageJumpDraft(String(pageFromUrl))
  }, [pageFromUrl])

  useEffect(() => {
    if (mode !== 'shop') {
      setImageFile(null)
      setHydratedShop(null)
    }
  }, [mode])

  useEffect(() => {
    if (mode !== 'shop' || imageFile) return
    try {
      const raw = sessionStorage.getItem(TRYON_SHOP_SESSION_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as HydratedShopPayload
      const detections = Array.isArray(parsed?.byDetection) ? parsed.byDetection : []
      if (!detections.length || !parsed?.outfitImageUrl) return
      setHydratedShop({
        byDetection: detections,
        shopImageMeta: parsed.shopImageMeta,
        shopTheLookStats: parsed.shopTheLookStats,
        outfitImageUrl: parsed.outfitImageUrl,
        source: parsed.source,
        savedAt: parsed.savedAt,
      })
      setImagePreviewUrl(parsed.outfitImageUrl)
      sessionStorage.removeItem(TRYON_SHOP_SESSION_KEY)
    } catch {
      // ignore invalid session payload
    }
  }, [mode, imageFile])

  useEffect(() => {
    if (!imageFile) {
      setImagePreviewUrl('')
      return
    }
    const url = URL.createObjectURL(imageFile)
    setImagePreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [imageFile])

  const imageKey = imageFile ? `${imageFile.name}-${imageFile.size}-${imageFile.lastModified}` : ''

  const textSearchActive = mode === 'text' && !!q.trim()

  /** useMutation avoids double POST in React 18 Strict Mode (dev), which useQuery can trigger twice when `enabled` flips on. */
  const shopImageSearch = useMutation({
    mutationFn: async (file: File) => {
      const uploadFile = await compressImageForShopUpload(file)
      const formData = new FormData()
      formData.append('image', uploadFile)
      const res = await api.postForm(endpoints.images.search, formData)
      const raw = res as Record<string, unknown>
      if (raw?.success === false) {
        const err = raw.error as { message?: string } | string | undefined
        const msg = typeof err === 'string' ? err : err?.message
        throw new Error(msg ?? 'Shop the look failed')
      }
      const sp = (raw.similarProducts ?? raw.data) as {
        byDetection?: unknown[]
        shopTheLookStats?: ShopTheLookStats
      } | undefined
      let byDetection = sp?.byDetection ?? raw.byDetection
      if (!Array.isArray(byDetection)) byDetection = []
      const shopTheLookStats =
        sp && typeof sp.shopTheLookStats === 'object' && sp.shopTheLookStats !== null
          ? (sp.shopTheLookStats as ShopTheLookStats)
          : undefined
      const ri = raw.image as { width?: number; height?: number } | undefined
      const shopImageMeta =
        ri && typeof ri.width === 'number' && typeof ri.height === 'number' && ri.width > 0 && ri.height > 0
          ? { width: ri.width, height: ri.height }
          : undefined
      const groups = normalizeShopTheLookGroups((byDetection as DetectionGroup[]) || [])
      const results = groups.flatMap((d) => (Array.isArray(d.products) ? d.products : []))
      return {
        results,
        query: { shopTheLook: true },
        byDetection: groups,
        shopImageMeta,
        shopTheLookStats,
      }
    },
    retry: false,
  })

  const resetShopImageSearch = shopImageSearch.reset
  useEffect(() => {
    resetShopImageSearch()
    if (imageFile) setHydratedShop(null)
  }, [imageFile, imageKey, resetShopImageSearch])

  const handleShopSearch = useCallback(() => {
    if (!imageFile || shopImageSearch.isPending) return
    shopImageSearch.mutate(imageFile)
  }, [imageFile, shopImageSearch])

  const textSearchPaged = useQuery({
    queryKey: ['search', 'text', 'page', q.trim(), TEXT_SEARCH_PAGE_SIZE, pageFromUrl, genderFilter ?? ''],
    queryFn: async () => {
      const params: Record<string, string | number> = {
        q: q.trim(),
        limit: TEXT_SEARCH_PAGE_SIZE,
        page: pageFromUrl,
        includeRelated: 'false',
      }
      if (genderFilter) params.gender = genderFilter

      const res = await api.get<unknown>(endpoints.products.search, params)
      if ((res as ApiResponse<unknown>).success === false) {
        throw new Error((res as ApiResponse<unknown>).error?.message ?? 'Search failed')
      }
      const { results, total } = extractTextSearchPage(res)
      const stable = getStablePagination(res as ApiResponse<unknown>, TEXT_SEARCH_PAGE_SIZE)
      const totalItems = stable?.totalItems ?? total
      const totalPages =
        stable && stable.totalPages >= 1
          ? stable.totalPages
          : totalItems > 0
            ? Math.max(1, Math.ceil(totalItems / TEXT_SEARCH_PAGE_SIZE))
            : null
      return {
        results,
        page: pageFromUrl,
        totalItems,
        totalPages,
        resultCount: results.length,
      }
    },
    enabled: textSearchActive,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    gcTime: 600_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  })

  const products = useMemo(() => {
    if (!textSearchActive) return []
    const list = toProducts(textSearchPaged.data?.results ?? [])
    const seen = new Set<number>()
    return list.filter((p) => {
      if (p.id < 1 || seen.has(p.id)) return false
      seen.add(p.id)
      return true
    })
  }, [textSearchActive, textSearchPaged.data])

  const shopPayload = shopImageSearch.data as {
    byDetection?: DetectionGroup[]
    shopImageMeta?: { width: number; height: number }
    shopTheLookStats?: ShopTheLookStats
  } | null
  const shopDetections = useMemo(() => {
    const raw = shopPayload?.byDetection ?? hydratedShop?.byDetection ?? []
    return normalizeShopTheLookGroups(raw)
  }, [shopPayload?.byDetection, hydratedShop?.byDetection])
  const shopImageMeta = shopPayload?.shopImageMeta ?? hydratedShop?.shopImageMeta
  const shopTheLookStats = shopPayload?.shopTheLookStats ?? hydratedShop?.shopTheLookStats

  /** Don’t replace the grid with skeletons while loading — `keepPreviousData` keeps prior page during fetch. */
  const textSearchBlocking =
    textSearchActive &&
    !textSearchPaged.data &&
    (textSearchPaged.isPending || textSearchPaged.isFetching)

  /** Shop image analysis only — text search uses inline loading so the hero strip stays put. */
  const isLoadingState = mode === 'shop' && !!imageFile && shopImageSearch.isPending

  const searchFailed = textSearchActive
    ? textSearchPaged.isError
    : mode === 'shop' && !!imageFile && shopImageSearch.isError

  const searchError = textSearchActive ? textSearchPaged.error : shopImageSearch.error

  const modeTabs = [
    { key: 'text', label: 'Text', Icon: Search, href: '/search', desc: 'Describe what you want' },
    { key: 'shop', label: 'Shop the look', Icon: Sparkles, href: '/search?mode=shop', desc: 'AI detects items' },
  ] as const

  const textReportedTotal = textSearchPaged.data?.totalItems ?? 0
  const textPageResultCount = textSearchPaged.data?.resultCount ?? textSearchPaged.data?.results?.length ?? 0
  const totalPagesFromApi = textSearchPaged.data?.totalPages
  const textTotalPagesDisplay =
    totalPagesFromApi != null && totalPagesFromApi >= 1
      ? totalPagesFromApi
      : textReportedTotal > 0
        ? Math.max(1, Math.ceil(textReportedTotal / TEXT_SEARCH_PAGE_SIZE))
        : null
  const knownTotalPages = totalPagesFromApi != null && totalPagesFromApi >= 1 ? totalPagesFromApi : 0
  const hasFullTextPage = textPageResultCount >= TEXT_SEARCH_PAGE_SIZE
  const canGoNextDiscover = knownTotalPages > 1 ? pageFromUrl < knownTotalPages : hasFullTextPage
  const textHasPrevPage = textSearchActive && pageFromUrl > 1
  const textHasNextPage = textSearchActive && canGoNextDiscover
  const textShowPagination =
    textSearchActive && products.length > 0 && (pageFromUrl > 1 || textHasNextPage || knownTotalPages > 1)

  const HOW_IT_WORKS_STEPS = [
    {
      step: '01',
      title: 'Text or outfit',
      desc: 'Search by keywords or open Shop the look for an outfit photo.',
      Icon: Search,
    },
    {
      step: '02',
      title: 'Refine',
      desc: 'Try synonyms, brands, or a clearer full-body photo.',
      Icon: Sparkles,
    },
    {
      step: '03',
      title: 'Browse results',
      desc: 'Open products and add favorites to compare.',
      Icon: Zap,
    },
  ] as const

  /** Hide onboarding strip once Shop the look has run, has results, or user landed with a hydrated session (e.g. try-on). */
  const shopHideHowItWorks =
    shopImageSearch.status !== 'idle' || Boolean(hydratedShop) || shopDetections.length > 0

  const discoverLanding = mode === 'text' && !q.trim()
  const discoverTextCompactRock = mode === 'text' && Boolean(q.trim())

  return (
    <div className="min-h-screen bg-white">
      {discoverLanding ? (
        <header className="-mt-[72px] relative w-full discover-hero-premium-bg overflow-x-clip">
          <div className="relative z-10 mx-auto w-full max-w-7xl px-4 pb-4 pt-[72px] sm:px-6 sm:pb-5 lg:px-10 lg:pb-6">
            <div className="grid w-full grid-cols-1 items-start gap-4 lg:grid-cols-12 lg:items-start lg:gap-5 xl:gap-6">
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                className="flex flex-col justify-center text-center lg:col-span-6 lg:text-left"
              >
                <p className="mx-auto mb-2 inline-flex max-w-full items-center justify-center rounded-full border border-white/40 bg-white/20 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#2B2521]/90 backdrop-blur-sm sm:px-3.5 sm:text-[10px] lg:mx-0">
                  AI fashion discovery
                </p>
                <h1 className="font-display text-[clamp(1.875rem,4.5vw,2.5rem)] font-extrabold leading-[1] tracking-[-0.03em] text-white drop-shadow-[0_2px_16px_rgba(43,37,33,0.18)] sm:text-[clamp(2rem,4vw,2.75rem)]">
                  Discover
                </h1>
                <p className="mx-auto mt-2 max-w-lg text-[13px] leading-snug text-[#2B2521]/88 sm:mt-3 sm:text-[14px] lg:mx-0">
                  Search naturally. Discover curated pieces. Build your look with AI.
                </p>
                <div className="mx-auto mt-3 flex flex-wrap items-center justify-center gap-2 sm:gap-2.5 lg:mx-0 lg:justify-start">
                  <button
                    type="button"
                    onClick={() => {
                      document.querySelector<HTMLInputElement>('#discover-hero-search input')?.focus()
                    }}
                    className="inline-flex items-center justify-center rounded-full bg-[#5c493a] px-5 py-2.5 text-[14px] font-semibold text-[#F8F3EE] shadow-[0_8px_24px_-10px_rgba(43,37,33,0.3)] transition hover:bg-[#4d3f35] active:scale-[0.98] sm:px-6 sm:py-3 sm:text-[15px]"
                  >
                    Start discovering
                  </button>
                  <Link
                    href="/search?mode=shop"
                    className="inline-flex items-center gap-2 rounded-full border border-[#2B2521]/22 bg-white/30 px-5 py-2.5 text-[14px] font-semibold text-[#2B2521] backdrop-blur-md transition hover:border-[#2B2521]/35 hover:bg-white/45 sm:px-6 sm:py-3 sm:text-[15px]"
                  >
                    Shop the look
                    <ArrowUpRight className="h-4 w-4 opacity-80" aria-hidden />
                  </Link>
                </div>
                <div className="mx-auto mt-3 w-full max-w-xl lg:mx-0 lg:max-w-none sm:mt-4">
                  <SearchBar
                    variant="discoverHero"
                    rotatingPlaceholders={TRY_SEARCHING_TAGS}
                    initialQuery={q}
                    isLoading={textSearchActive && textSearchPaged.isFetching}
                  />
                </div>
              </motion.div>
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
                className="relative flex w-full shrink-0 flex-col items-center justify-center self-start lg:col-span-6 lg:items-end lg:justify-start lg:pr-2 xl:pr-6"
              >
                <DiscoverHeroMasonry className="w-full max-w-[min(92vw,340px)] shrink-0 sm:max-w-[380px] lg:max-w-[min(100%,400px)]" variant="full" />
              </motion.div>
            </div>
          </div>
        </header>
      ) : discoverTextCompactRock ? (
        <div className="-mt-[72px] w-full discover-hero-premium-bg overflow-x-clip">
          <div className="relative z-10 mx-auto w-full max-w-7xl px-4 pb-4 pt-[72px] sm:px-6 sm:pb-5 lg:px-10">
            <div className="relative mx-auto w-full max-w-md py-1 sm:max-w-lg">
              <DiscoverHeroMasonry className="h-full w-full min-h-0" variant="compact" />
            </div>
          </div>
        </div>
      ) : null}
      {mode === 'text' ? (
        <header className="border-b border-[#ebe8e4] bg-white">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 sm:pt-8 pb-5">
            {!q.trim() ? (
              <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
                aria-labelledby="text-search-how-it-works-heading"
                className="max-w-5xl mx-auto mb-6 p-6 rounded-2xl bg-gradient-to-r from-[#f7f0eb] via-[#f3ece6] to-[#f7f0eb] border border-[#eadfd7]"
              >
                <p
                  id="text-search-how-it-works-heading"
                  className="text-xs font-semibold uppercase tracking-wider text-[#2a2623] mb-4 text-center"
                >
                  How it works
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                  {HOW_IT_WORKS_STEPS.map((s) => (
                    <div key={s.step} className="flex items-start gap-3">
                      <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-white flex items-center justify-center shadow-sm border border-[#eadfd7]">
                        <s.Icon className="w-4 h-4 text-[#2a2623]" aria-hidden />
              </div>
              <div>
                        <p className="text-xs font-semibold text-[#3d3030] mb-0.5">{s.step}</p>
                        <p className="text-sm font-medium text-[#2a2623]">{s.title}</p>
                        <p className="text-xs text-[#7a726b] mt-0.5">{s.desc}</p>
              </div>
            </div>
                  ))}
                </div>
              </motion.section>
            ) : null}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.06 }}
              className="text-center max-w-3xl mx-auto"
            >
              {q.trim() ? (
                <>
                  <h1 className="font-display text-[1.95rem] sm:text-[2.5rem] font-semibold text-[#2a2623] tracking-[-0.02em]">
                    Discover
                  </h1>
                  <p className="mt-3 text-base sm:text-lg text-[#6b6560] leading-relaxed px-2 font-normal">
                    Find exactly what you&apos;re looking for using natural language.
                  </p>
                </>
              ) : null}
              {!discoverLanding || q.trim() ? (
                <div className={q.trim() ? 'mt-8 px-1' : 'mt-2 px-1 sm:mt-3'}>
                  <SearchBar
                    variant="textSearch"
                    placeholder='Try "white linen shirt for summer"'
                    initialQuery={q}
                    isLoading={textSearchActive && textSearchPaged.isFetching}
                  />
                </div>
              ) : null}
              <div className={`flex flex-wrap justify-center gap-3 sm:gap-4 max-w-2xl mx-auto ${q.trim() ? 'mt-6' : 'mt-5'}`}>
                {modeTabs.map((tab, i) => (
                  <motion.div
                    key={tab.key}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.08 + i * 0.04 }}
                  >
                    <Link
                      href={tab.href}
                      scroll={false}
                      prefetch={true}
                      className={`inline-flex items-center gap-2.5 rounded-full px-6 sm:px-8 py-3.5 sm:py-4 text-base sm:text-lg font-medium border transition-all ${
                        mode === tab.key
                          ? 'bg-[#ebe6e0] border-[#d8d2cd] text-[#2a2623] shadow-sm'
                          : 'bg-white border-[#e8e4df] text-[#5c534c] hover:border-[#d4cdc4] hover:text-[#2a2623]'
                      }`}
                    >
                      <tab.Icon className="w-5 h-5 sm:w-6 sm:h-6 shrink-0 opacity-85" aria-hidden />
                      <span>{tab.label}</span>
                    </Link>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </div>
        </header>
      ) : (
        <header className="border-b border-[#ebe8e4] bg-white">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 sm:pt-8 pb-5">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45 }}
            >
              {!shopHideHowItWorks ? (
                <motion.section
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4 }}
                  aria-labelledby="discover-how-it-works-heading"
                  className="max-w-5xl mx-auto mb-6 p-6 rounded-2xl bg-gradient-to-r from-[#f7f0eb] via-[#f3ece6] to-[#f7f0eb] border border-[#eadfd7]"
                >
                  <p
                    id="discover-how-it-works-heading"
                    className="text-xs font-semibold uppercase tracking-wider text-[#2a2623] mb-4 text-center"
                  >
                    How it works
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                    {HOW_IT_WORKS_STEPS.map((s) => (
                      <div key={s.step} className="flex items-start gap-3">
                        <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-white flex items-center justify-center shadow-sm border border-[#eadfd7]">
                          <s.Icon className="w-4 h-4 text-[#2a2623]" aria-hidden />
                  </div>
                        <div>
                          <p className="text-xs font-semibold text-[#3d3030] mb-0.5">{s.step}</p>
                          <p className="text-sm font-medium text-[#2a2623]">{s.title}</p>
                          <p className="text-xs text-[#7a726b] mt-0.5">{s.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.section>
              ) : null}

              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: 0.06 }}
                className="text-center max-w-3xl mx-auto"
              >
                <h1 className="font-display text-[1.95rem] sm:text-[2.5rem] font-semibold text-[#2a2623] tracking-[-0.02em]">
                  Discover
                </h1>
                <p className="mt-3 text-base sm:text-lg text-[#6b6560] leading-relaxed px-2 font-normal">
                  Upload an outfit photo to shop the look, or switch to Text search for keywords.
                </p>
                <div className="mt-8 flex flex-wrap justify-center gap-3 sm:gap-4">
                  {modeTabs.map((tab, i) => (
                    <motion.a
                      key={tab.key}
                      href={tab.href}
                      title={tab.desc}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.08 + i * 0.04 }}
                      className={`inline-flex items-center gap-2.5 rounded-full px-6 sm:px-8 py-3.5 sm:py-4 text-base sm:text-lg font-medium border transition-all ${
                        mode === tab.key
                          ? 'bg-[#ebe6e0] border-[#d8d2cd] text-[#2a2623] shadow-sm'
                          : 'bg-white border-[#e8e4df] text-[#5c534c] hover:border-[#d4cdc4] hover:text-[#2a2623]'
                      }`}
                    >
                      <tab.Icon className="w-5 h-5 sm:w-6 sm:h-6 shrink-0 opacity-85" aria-hidden />
                      <span>{tab.label}</span>
                    </motion.a>
                  ))}
                </div>
              </motion.div>
          </motion.div>
        </div>
        </header>
      )}

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 pt-3 sm:pt-4 pb-10">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className={mode === 'shop' ? 'mb-8' : ''}
        >
          {mode === 'shop' && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-6">
              {!imageFile ? (
                <div className="relative p-8 sm:p-10 rounded-[18px] border border-dashed border-[#d8d2cd] bg-white shadow-[0_6px_28px_-16px_rgba(42,38,35,0.08)] hover:border-[#c9ae9f] transition-colors">
                  <div className="text-center">
                    <div className="relative w-16 h-16 mx-auto mb-5">
                      <div className="absolute inset-0 rounded-2xl bg-[#eadfd7]/90 blur-lg" aria-hidden />
                      <div className="relative w-16 h-16 rounded-2xl bg-[#faf9f7] ring-1 ring-[#ebe8e4] flex items-center justify-center">
                        <Sparkles className="w-7 h-7 text-[#3d3030]" strokeWidth={1.75} aria-hidden />
                      </div>
                    </div>
                    <p className="font-display text-base font-semibold text-[#2a2623] mb-1">Upload an outfit photo</p>
                    <p className="text-sm text-[#7a726b] mb-7 max-w-sm mx-auto leading-relaxed">
                      We detect pieces in your shot and match each one to similar products you can shop.
                    </p>
                    <input
                      type="file"
                      accept="image/*"
                      id="shop-image-file-pick"
                      className="hidden"
                      onChange={(e) => {
                        setImageFile(e.target.files?.[0] || null)
                        e.target.value = ''
                      }}
                    />
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      id="shop-image-camera-capture"
                      className="hidden"
                      onChange={(e) => {
                        setImageFile(e.target.files?.[0] || null)
                        e.target.value = ''
                      }}
                    />
                    <div className="flex flex-wrap justify-center gap-3">
                      <label
                        htmlFor="shop-image-file-pick"
                        className="cursor-pointer inline-flex items-center gap-2 px-6 py-3 rounded-full bg-white text-[#2a2623] text-sm font-semibold border border-[#e8e4df] hover:bg-[#f3f1ee] hover:border-[#d8d2cd] active:scale-[0.98] transition-all"
                      >
                        <Upload className="w-4 h-4 text-[#3d3030]" aria-hidden />
                        Choose file
                      </label>
                      <label
                        htmlFor="shop-image-camera-capture"
                        className="cursor-pointer inline-flex items-center gap-2 px-6 py-3 rounded-full bg-brand text-white text-sm font-semibold hover:bg-brand-hover shadow-sm active:scale-[0.98] transition-all"
                      >
                        <Camera className="w-4 h-4 opacity-90" aria-hidden />
                        Take a photo
                      </label>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-5 sm:p-6 rounded-[18px] bg-white border border-[#ebe8e4] shadow-[0_6px_28px_-16px_rgba(42,38,35,0.08)]">
                  <div className="flex flex-col sm:flex-row sm:items-start gap-5">
                    <div className="relative w-[min(100%,200px)] h-[200px] sm:w-36 sm:h-36 sm:max-w-none rounded-[14px] overflow-hidden bg-[#faf9f7] flex-shrink-0 ring-1 ring-[#ebe8e4] mx-auto sm:mx-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={imagePreviewUrl} alt="Preview" className="object-cover w-full h-full" />
                    </div>
                    <div className="flex-1 min-w-0 pt-1 text-center sm:text-left">
                      <p className="text-sm font-semibold text-[#2a2623] truncate">{imageFile.name}</p>
                      <p className="text-xs text-[#9c9590] mt-0.5">{(imageFile.size / 1024).toFixed(0)} KB</p>
                      <div className="flex flex-wrap gap-2 mt-5 justify-center sm:justify-start">
                        <button
                          type="button"
                          onClick={handleShopSearch}
                          disabled={shopImageSearch.isPending}
                          className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-brand text-white text-sm font-semibold hover:bg-brand-hover shadow-sm transition-all disabled:opacity-60 disabled:pointer-events-none"
                        >
                          <Search className="w-4 h-4 opacity-90" aria-hidden />
                          Search
                        </button>
                        <button
                          type="button"
                          onClick={() => setImageFile(null)}
                          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold text-[#6b6560] border border-[#e8e4df] bg-[#faf9f7] hover:bg-[#f3f1ee] hover:border-[#d8d2cd] transition-all"
                        >
                          Change image
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </motion.div>

        <div className="min-h-[320px]">
          {isLoadingState ? (
            <div className="flex flex-col items-center justify-center gap-4 py-14 min-h-[220px]">
              <Loader2 className="h-10 w-10 animate-spin text-brand" aria-hidden />
              <p className="text-sm text-neutral-600">Analyzing your outfit…</p>
            </div>
          ) : mode === 'shop' && shopDetections.length > 0 && imagePreviewUrl ? (
            <ShopTheLookResultsPanel
              groups={shopDetections}
              outfitImageUrl={imagePreviewUrl}
              imageMeta={shopImageMeta}
              shopTheLookStats={shopTheLookStats}
              returnPath={discoverReturnPath}
            />
          ) : textSearchBlocking ? (
            <div className="flex flex-col items-center justify-center gap-4 py-14 min-h-[200px]">
              <Loader2 className="h-10 w-10 animate-spin text-brand" aria-hidden />
              <p className="text-sm text-neutral-600">Searching the catalog…</p>
            </div>
          ) : products.length > 0 ? (
            <>
                  {textSearchActive ? (
                <>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between mb-4">
                    <p className="text-[14px] sm:text-[15px] text-[#5c5752] leading-snug">
                      Results for{' '}
                      <span className="font-semibold text-[#2a2623]">&ldquo;{q.trim()}&rdquo;</span>
                    </p>
                    <p className="text-[13px] sm:text-[14px] text-[#9c9590] tabular-nums shrink-0">
                      {(textReportedTotal || products.length).toLocaleString()} item
                      {(textReportedTotal || products.length) !== 1 ? 's' : ''} found
                      {genderFilter ? (
                        <span className="text-[#b8aea5]">
                          {' '}
                          · {genderFilter === 'men' ? 'Men' : 'Women'}
                        </span>
                      ) : null}
                    </p>
                  </div>

                  <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3 mb-5">
                    <div className="flex flex-wrap items-center gap-2">
                      {TEXT_SEARCH_GENDER_CHIPS.map((chip) => {
                        const key = chip.toLowerCase()
                        const active =
                          key === 'all' ? genderFilter === null : genderFilter === key
                        return (
                          <button
                            key={chip}
                            type="button"
                            onClick={() => setGenderFilter(chip)}
                            className={`px-4 py-2 rounded-full text-[12px] sm:text-[13px] font-semibold border transition-colors ${
                              active
                                ? 'bg-[#ebe6e0] border-[#d8d2cd] text-[#2a2623]'
                                : 'bg-white border-[#e8e4df] text-[#6b6560] hover:border-[#d4cdc4]'
                            }`}
                          >
                            {chip}
                          </button>
                        )
                      })}
                    </div>
                    <Link
                      href={
                        q.trim()
                          ? `/products?q=${encodeURIComponent(q.trim())}${genderFilter ? `&gender=${genderFilter}` : ''}`
                          : genderFilter
                            ? `/products?gender=${genderFilter}`
                            : '/products'
                      }
                      className="inline-flex items-center gap-2 rounded-full border-2 border-brand/35 bg-white px-4 py-2.5 text-[13px] font-semibold text-brand hover:bg-brand-muted transition-colors min-h-[44px] shrink-0 self-start xl:self-auto"
                    >
                      <SlidersHorizontal className="w-4 h-4 text-[#9c9590]" aria-hidden />
                      Filter
                    </Link>
                  </div>

                  <TextSearchProductGrid
                    products={products}
                    fromReturnPath={discoverReturnPath}
                  />

                  <div className="mt-8 rounded-[20px] bg-[#f3f1ee] border border-[#e8e4df] px-5 py-5 sm:px-8 sm:py-6">
                    <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                      <div className="flex items-center gap-2 text-[13px] font-semibold text-[#5c5752] shrink-0">
                        <Sparkles className="w-4 h-4 text-[#b8aea5]" aria-hidden />
                        Try searching for something like:
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {TRY_SEARCHING_TAGS.map((tag) => (
                          <Link
                            key={tag}
                            href={`/search?q=${encodeURIComponent(tag)}`}
                            className="px-3.5 py-2 rounded-full bg-white border border-[#e8e4df] text-[12px] sm:text-[13px] text-[#5c5752] hover:border-[#d8d2cd] hover:text-[#2a2623] transition-colors"
                          >
                            {tag}
                          </Link>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
                  ) : (
                    <>
                  <div className="flex items-center justify-between mb-6">
                    <p className="text-sm font-medium text-neutral-500">
                      {products.length} result{products.length !== 1 ? 's' : ''} shown
                </p>
              </div>
              <SearchProductGrid
                products={products}
                addToCompare={addToCompare}
                fromReturnPath={discoverReturnPath}
              />
                </>
              )}
              {textShowPagination ? (
                <nav
                  className="mt-10 flex flex-col items-center gap-5"
                  aria-label="Search results pagination"
                >
                  <div className="flex flex-col sm:flex-row items-center justify-center gap-4 w-full max-w-3xl">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => goSearchPage(pageFromUrl - 1)}
                        disabled={!textHasPrevPage || textSearchPaged.isFetching}
                        className="p-2.5 rounded-xl border border-neutral-200 bg-white text-neutral-600 hover:bg-[#f7f0eb] hover:border-[#d8c6bb] hover:text-[#2a2623] disabled:opacity-40 disabled:pointer-events-none transition-colors"
                        aria-label="Previous page"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>

                      <div className="flex items-center gap-1 px-1 flex-wrap justify-center max-w-[min(100vw-8rem,28rem)]">
                        {(() => {
                          const tp =
                            knownTotalPages > 0
                              ? knownTotalPages
                              : pageFromUrl + (textHasNextPage ? 1 : 0)
                          const windowSize = Math.min(Math.max(tp, 1), 7)
                          return Array.from({ length: windowSize }).map((_, i) => {
                            let pageNum: number
                            if (tp <= 7) {
                              pageNum = i + 1
                            } else if (pageFromUrl <= 4) {
                              pageNum = i + 1
                            } else if (pageFromUrl >= tp - 3) {
                              pageNum = tp - 6 + i
                            } else {
                              pageNum = pageFromUrl - 3 + i
                            }
                            return (
                              <button
                                key={pageNum}
                                type="button"
                                onClick={() => goSearchPage(pageNum)}
                                disabled={textSearchPaged.isFetching}
                                className={`w-9 h-9 rounded-lg text-sm font-semibold transition-all shrink-0 ${
                                  pageNum === pageFromUrl
                                    ? 'bg-brand text-white shadow-md shadow-brand/20'
                                    : 'text-neutral-600 hover:bg-[#f7f0eb] hover:text-[#2a2623]'
                                }`}
                              >
                                {pageNum}
                              </button>
                            )
                          })
                        })()}

                        {knownTotalPages === 0 && textHasNextPage && (
                          <span className="w-9 h-9 flex items-center justify-center text-sm text-neutral-400" aria-hidden>
                            …
                          </span>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => goSearchPage(pageFromUrl + 1)}
                        disabled={!textHasNextPage || textSearchPaged.isFetching}
                        className="p-2.5 rounded-xl border border-neutral-200 bg-white text-neutral-600 hover:bg-[#f7f0eb] hover:border-[#d8c6bb] hover:text-[#2a2623] disabled:opacity-40 disabled:pointer-events-none transition-colors"
                        aria-label="Next page"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>

                    <form
                      className="flex items-center gap-2 flex-wrap justify-center"
                      onSubmit={(e) => {
                        e.preventDefault()
                        const n = parseInt(pageJumpDraft, 10)
                        if (!Number.isFinite(n) || n < 1) return
                        const maxP = knownTotalPages > 0 ? knownTotalPages : n
                        goSearchPage(knownTotalPages > 0 ? Math.min(n, maxP) : n)
                      }}
                    >
                      <label htmlFor="discover-page-jump" className="text-sm text-neutral-500 whitespace-nowrap">
                        Go to page
                      </label>
                      <input
                        id="discover-page-jump"
                        type="number"
                        min={1}
                        {...(knownTotalPages > 0 ? { max: knownTotalPages } : {})}
                        value={pageJumpDraft}
                        onChange={(e) => setPageJumpDraft(e.target.value)}
                        className="w-16 px-2 py-2 rounded-lg border border-neutral-200 bg-white text-neutral-800 text-center text-sm focus:ring-2 focus:ring-[#d8c6bb] focus:border-[#c9ae9f]"
                      />
                      <button
                        type="submit"
                        className="px-3 py-2 rounded-lg text-sm font-semibold bg-[#f4ece6] text-[#2a2623] hover:bg-[#eadfd7] transition-colors"
                      >
                        Go
                      </button>
                    </form>

                    <p className="text-sm text-neutral-500 tabular-nums whitespace-nowrap">
                      Page {pageFromUrl}
                      {textTotalPagesDisplay != null ? ` of ${textTotalPagesDisplay}` : ''}
                    </p>
                  </div>
                </nav>
              ) : null}
            </>
          ) : searchFailed ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center py-16 max-w-lg mx-auto"
            >
              <div className="w-16 h-16 rounded-2xl bg-[#f4ece6] text-[#2a2623] flex items-center justify-center mx-auto mb-5">
                <Search className="w-8 h-8" />
              </div>
              <p className="font-bold text-neutral-900 text-lg mb-2">Connection issue</p>
              <p className="text-sm text-neutral-600 mb-4">
                {(searchError as Error)?.message ?? 'The backend is down or not responding.'}
              </p>
              <p className="text-xs text-neutral-400">Check that the API is running and configured correctly.</p>
            </motion.div>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15, duration: 0.5 }}
              className="py-12"
            >
              {mode === 'shop' && !imageFile ? null : mode === 'shop' &&
                imageFile &&
                !shopImageSearch.isPending &&
                !shopImageSearch.data &&
                !shopImageSearch.isError ? (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center max-w-md mx-auto py-6">
                  <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-[#f4ece6] to-[#ede0d7] flex items-center justify-center mx-auto mb-4">
                    <ArrowRight className="w-6 h-6 text-[#2a2623] -rotate-45" />
                  </div>
                  <p className="text-neutral-600 font-medium">
                    Hit <span className="text-[#2a2623] font-bold">Search</span> above to detect items in your photo.
                  </p>
                </motion.div>
              ) : mode === 'shop' &&
                shopImageSearch.isSuccess &&
                shopDetections.length === 0 &&
                imagePreviewUrl ? (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center max-w-md mx-auto py-6">
                  <div className="w-14 h-14 rounded-xl bg-neutral-100 flex items-center justify-center mx-auto mb-4">
                    <Search className="w-6 h-6 text-neutral-400" />
                  </div>
                  <p className="font-semibold text-neutral-800 mb-1">No matching items found</p>
                  <p className="text-sm text-neutral-500">Try a clearer full-outfit photo or switch to text search.</p>
                </motion.div>
              ) : q &&
                mode === 'text' &&
                textSearchPaged.isFetched &&
                !textSearchPaged.isPending &&
                !textSearchPaged.isFetching &&
                products.length === 0 &&
                !textSearchPaged.isError ? (
                <div className="text-center max-w-md mx-auto">
                  <div className="w-16 h-16 rounded-2xl bg-neutral-100 text-neutral-400 flex items-center justify-center mx-auto mb-5">
                    <Search className="w-8 h-8" />
                  </div>
                  <p className="font-bold text-neutral-900 text-lg mb-2">No results for &ldquo;{q}&rdquo;</p>
                  <p className="text-neutral-500">Try different keywords or browse by category.</p>
                </div>
              ) : mode === 'text' && !q ? (
                <div className="max-w-5xl mx-auto py-4">
                  <div className="text-center">
                    <motion.h2
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.35, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                      className="font-display text-xl sm:text-2xl font-bold text-neutral-900 mb-2"
                    >
                      What are you looking for?
                    </motion.h2>
                    <motion.p
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.48, duration: 0.4 }}
                      className="text-neutral-500 max-w-md mx-auto text-[15px]"
                    >
                      Use the search bar above to describe styles, brands, or occasions — then browse ranked matches from
                      the catalog.
                    </motion.p>
                  </div>
                </div>
              ) : null}
            </motion.div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="min-h-[60vh] flex items-center justify-center">Loading...</div>}>
      <SearchContent />
    </Suspense>
  )
}
