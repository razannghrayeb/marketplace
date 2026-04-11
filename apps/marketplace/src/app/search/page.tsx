'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import Link from 'next/link'
import NextImage from 'next/image'
import { Search, Sparkles, Shirt, Palette, Zap, TrendingUp, ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react'
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
  fromReturnPath,
}: {
  products: Product[]
  addToCompare: (id: number) => void
  inCompare: (id: number) => boolean
  fromReturnPath?: string
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
              fromReturnPath={fromReturnPath}
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

const TEXT_SEARCH_PAGE_SIZE = 24

/** Normalize GET /search and GET /products/search responses for paginated text search */
function extractTextSearchPage(res: unknown): { results: unknown[]; total: number } {
  const r = res as {
    success?: boolean
    error?: { message?: string }
    results?: unknown[]
    data?: unknown[] | { results?: unknown[] }
    total?: number
    meta?: { open_search_total_estimate?: number; total_results?: number; total_above_threshold?: number }
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
  if (!total && r.meta && typeof r.meta === 'object') {
    const est = r.meta.open_search_total_estimate
    const tr = r.meta.total_results
    const ta = r.meta.total_above_threshold
    if (typeof est === 'number' && est > 0) total = est
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
      } as Product
    })
}


function SearchContent() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const q = searchParams.get('q') || ''
  const pageFromUrl = Math.max(1, Math.min(999, parseInt(searchParams.get('page') || '1', 10) || 1))
  const legacyMode = searchParams.get('mode')

  useEffect(() => {
    if (legacyMode === 'image' || legacyMode === 'shop' || legacyMode === 'multi') {
      const next = new URLSearchParams(searchParams.toString())
      next.delete('mode')
      const qs = next.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname)
    }
  }, [legacyMode, pathname, router, searchParams])

  const discoverReturnPath = useMemo(() => {
    const qs = searchParams.toString()
    return qs ? `/search?${qs}` : '/search'
  }, [searchParams])

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
  const addToCompare = useCompareStore((s) => s.add)
  const inCompare = useCompareStore((s) => s.has)

  const textSearchActive = !!q.trim()

  const textSearchPaged = useQuery({
    queryKey: ['search', 'text', 'page', q.trim(), TEXT_SEARCH_PAGE_SIZE, pageFromUrl],
    queryFn: async () => {
      let res = await api.get<unknown>(endpoints.search.text, {
        q: q.trim(),
        limit: TEXT_SEARCH_PAGE_SIZE,
        page: pageFromUrl,
      })
      if ((res as { success?: boolean }).success === false) {
        res = await api.get<unknown>(endpoints.products.search, {
          q: q.trim(),
          limit: TEXT_SEARCH_PAGE_SIZE,
          page: pageFromUrl,
        })
      }
      const { results, total } = extractTextSearchPage(res)
      return { results, page: pageFromUrl, total }
    },
    enabled: textSearchActive,
    placeholderData: (previousData) => previousData,
  })

  const products = toProducts(textSearchPaged.data?.results ?? [])
  const isLoadingState = textSearchPaged.isLoading || textSearchPaged.isFetching
  const searchFailed = textSearchPaged.isError
  const searchError = textSearchPaged.error

  const textReportedTotal = textSearchPaged.data?.total ?? 0
  const textPageResultCount = textSearchPaged.data?.results?.length ?? 0
  const textTotalPages =
    textReportedTotal > 0 ? Math.max(1, Math.ceil(textReportedTotal / TEXT_SEARCH_PAGE_SIZE)) : null
  const textHasPrevPage = textSearchActive && pageFromUrl > 1
  const textHasNextPage = textSearchActive
    ? textTotalPages != null
      ? pageFromUrl < textTotalPages
      : textPageResultCount >= TEXT_SEARCH_PAGE_SIZE
    : false

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
    enabled: !q,
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
                <p className="text-sm text-neutral-500 mt-0.5">Search the catalog by keywords</p>
              </div>
            </div>

            <SearchBar placeholder='Search "red summer dress", "casual sneakers"...' initialQuery={q} />
          </motion.div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="min-h-[320px]">
          {isLoadingState ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5 sm:gap-6">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="space-y-3">
                  <div className="aspect-[3/4] rounded-2xl skeleton-shimmer ring-1 ring-neutral-200/60" />
                  <div className="h-3 w-2/3 rounded-md skeleton-shimmer" />
                  <div className="h-3 w-1/2 rounded-md skeleton-shimmer" />
                </div>
              ))}
            </div>
          ) : products.length > 0 ? (
            <>
              <div className="flex items-center justify-between mb-6">
                <p className="text-sm font-medium text-neutral-500">
                  {textSearchActive ? (
                    products.length === 0 ? (
                      <>No results on this page</>
                    ) : (
                      <>
                        Showing {(pageFromUrl - 1) * TEXT_SEARCH_PAGE_SIZE + 1}–
                        {(pageFromUrl - 1) * TEXT_SEARCH_PAGE_SIZE + products.length}
                        {textReportedTotal > 0 ? ` of ${textReportedTotal.toLocaleString()}` : ''}
                      </>
                    )
                  ) : (
                    <>
                      {products.length} result{products.length !== 1 ? 's' : ''} shown
                    </>
                  )}
                </p>
              </div>
              <SearchProductGrid
                products={products}
                addToCompare={addToCompare}
                inCompare={inCompare}
                fromReturnPath={discoverReturnPath}
              />
              {textSearchActive && (textHasPrevPage || textHasNextPage) ? (
                <nav
                  className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4"
                  aria-label="Search results pagination"
                >
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => goSearchPage(pageFromUrl - 1)}
                      disabled={!textHasPrevPage || textSearchPaged.isFetching}
                      className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full border border-violet-200 bg-white text-sm font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-40 disabled:pointer-events-none transition-colors"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      Previous
                    </button>
                    <button
                      type="button"
                      onClick={() => goSearchPage(pageFromUrl + 1)}
                      disabled={!textHasNextPage || textSearchPaged.isFetching}
                      className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full border border-violet-200 bg-white text-sm font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-40 disabled:pointer-events-none transition-colors"
                    >
                      Next
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-sm text-neutral-500 tabular-nums">
                    Page {pageFromUrl}
                    {textTotalPages != null ? ` of ${textTotalPages}` : null}
                  </p>
                </nav>
              ) : null}
            </>
          ) : searchFailed ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center py-16 max-w-lg mx-auto"
            >
              <div className="w-16 h-16 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center mx-auto mb-5">
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
              {q ? (
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
                      Type a description or try one of these popular searches.
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
                        { step: '01', title: 'Enter keywords', desc: 'Describe what you want in the search bar.', Icon: Search },
                        { step: '02', title: 'Refine', desc: 'Try synonyms, brands, or categories.', Icon: Sparkles },
                        { step: '03', title: 'Browse results', desc: 'Open products and add favorites to compare.', Icon: Zap },
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
