'use client'

import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { Suspense, useState, useEffect, useMemo, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Search, SlidersHorizontal, ArrowUpDown, X, ChevronLeft, ChevronRight, ShoppingBag } from 'lucide-react'
import Image from 'next/image'
import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'
import { getStablePagination } from '@/lib/shopPagination'
import { ProductCard } from '@/components/product/ProductCard'
import { useCompareStore } from '@/store/compare'
import { useAuthStore } from '@/store/auth'
import { addCatalogProductToWardrobe } from '@/lib/wardrobe/addCatalogProduct'
import type { Product } from '@/types/product'
import { storedAmountToUsdCents } from '@/lib/money/displayUsd'
import { readAndClearListingScrollY } from '@/lib/navigation/listingScrollRestore'

function asProductArray(input: unknown): Product[] {
  if (!Array.isArray(input)) return []
  return input as Product[]
}

function extractProductsFromResponse(res: unknown): Product[] {
  if (Array.isArray(res)) return asProductArray(res)
  if (!res || typeof res !== 'object') return []

  const rec = res as Record<string, unknown>
  const data = rec.data

  if (Array.isArray(data)) return asProductArray(data)
  if (Array.isArray(rec.results)) return asProductArray(rec.results)
  if (Array.isArray(rec.products)) return asProductArray(rec.products)

  if (data && typeof data === 'object') {
    const inner = data as Record<string, unknown>
    if (Array.isArray(inner.results)) return asProductArray(inner.results)
    if (Array.isArray(inner.products)) return asProductArray(inner.products)
    if (Array.isArray(inner.data)) return asProductArray(inner.data)
  }

  return []
}

function chipClass(active: boolean) {
  return `px-3.5 py-1.5 rounded-full text-[13px] font-semibold border transition-colors duration-200 ${
    active
      ? 'bg-brand border-brand text-white shadow-sm hover:bg-brand-hover'
      : 'bg-white border-[#e8e4df] text-[#6b6560] hover:border-brand/35 hover:text-brand'
  }`
}

function ProductsContent() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  const q = searchParams.get('q') ?? ''
  const gender = searchParams.get('gender') ?? ''
  const sort = searchParams.get('sort') ?? ''
  const category = searchParams.get('category') ?? ''

  const pageFromUrl = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1)
  const [page, setPage] = useState(pageFromUrl)
  const [pageJump, setPageJump] = useState('')
  const [searchDraft, setSearchDraft] = useState(q)
  const limit = 24
  const addToCompare = useCompareStore((s) => s.add)

  const [wardrobeAddedIds, setWardrobeAddedIds] = useState<Set<number>>(() => new Set())
  const addToWardrobeMutation = useMutation({
    mutationFn: (product: Product) => addCatalogProductToWardrobe(product),
    onMutate: (product) => {
      setWardrobeAddedIds((prev) => new Set(prev).add(product.id))
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['wardrobe'] })
    },
    onError: (_err, product) => {
      setWardrobeAddedIds((prev) => {
        const next = new Set(prev)
        next.delete(product.id)
        return next
      })
    },
  })

  const handleAddToWardrobe = useCallback(
    (product: Product) => {
      if (!isAuthenticated()) {
        const qs = new URLSearchParams({ next: `${pathname}${searchParams.toString() ? `?${searchParams}` : ''}` })
        router.push(`/login?${qs.toString()}`)
        return
      }
      addToWardrobeMutation.mutate(product)
    },
    [addToWardrobeMutation, isAuthenticated, pathname, router, searchParams],
  )

  useEffect(() => { setSearchDraft(q) }, [q])
  useEffect(() => {
    setPage(pageFromUrl)
  }, [pageFromUrl])

  const catalogReturnPath = useMemo(() => {
    const qs = searchParams.toString()
    return qs ? `${pathname}?${qs}` : pathname
  }, [pathname, searchParams])

  useEffect(() => {
    const y = readAndClearListingScrollY(catalogReturnPath)
    if (y == null) return
    const id = requestAnimationFrame(() => {
      window.scrollTo({ top: y, behavior: 'instant' })
    })
    return () => cancelAnimationFrame(id)
  }, [catalogReturnPath])

  const navigateShop = (patch: Record<string, string | null | undefined>) => {
    const p = new URLSearchParams(searchParams.toString())
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === null || v === '') p.delete(k)
      else p.set(k, v)
    }
    if (!('page' in patch)) p.delete('page')
    const qs = p.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  const setPageInUrl = useCallback(
    (next: number) => {
      const n = Math.max(1, next)
      setPage(n)
      const p = new URLSearchParams(searchParams.toString())
      if (n <= 1) p.delete('page')
      else p.set('page', String(n))
      const qs = p.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [pathname, router, searchParams],
  )

  const hasActiveFilters = !!q.trim() || !!gender || !!sort || !!category

  const queryKey = ['products', page, category, q, gender, sort, limit] as const

  const isSearchMode = Boolean(q.trim())

  const { data, isPending, isFetching } = useQuery({
    queryKey,
    queryFn: async () => {
      const params: Record<string, string | number> = { page, limit }
      if (category) params.category = category
      if (gender) params.gender = gender
      if (sort) params.sort = sort

      if (q.trim()) {
        return api.get<Product[]>(endpoints.products.search, {
          ...params,
          q: q.trim(),
          includeRelated: 'false',
        })
      }

      return api.get<Product[]>(endpoints.products.list, params)
    },
    placeholderData: keepPreviousData,
    staleTime: isSearchMode ? 45_000 : 120_000,
    gcTime: 600_000,
  })

  const rawProducts: Product[] = extractProductsFromResponse(data)

  const products = useMemo(() => {
    if (!sort || rawProducts.length === 0) return rawProducts
    const getEffectivePrice = (p: Product) => {
      const raw =
        (p.sales_price_cents != null && p.sales_price_cents > 0 ? p.sales_price_cents : p.price_cents) || 0
      return storedAmountToUsdCents(raw, p.currency)
    }
    const sorted = [...rawProducts]
    if (sort === 'price_asc') sorted.sort((a, b) => getEffectivePrice(a) - getEffectivePrice(b))
    else if (sort === 'price_desc') sorted.sort((a, b) => getEffectivePrice(b) - getEffectivePrice(a))
    return sorted
  }, [rawProducts, sort])

  const pagination = useMemo(() => {
    const stable = getStablePagination(data, limit)
    if (stable) return stable
    if (rawProducts.length === 0) return null
    /** Browse responses often omit `total`/`pages`; when `has_more` is false this is the last chunk — infer size. */
    if (data?.pagination?.has_more !== true) {
      const totalItems = (page - 1) * limit + rawProducts.length
      const totalPages = Math.max(1, Math.ceil(totalItems / limit))
      return { totalItems, totalPages }
    }
    return null
  }, [data, limit, page, rawProducts.length])

  const hasMoreFromApi = data?.pagination?.has_more === true
  const itemsDeliveredThisRequest = rawProducts.length
  const itemsAccountedFor = (page - 1) * limit + itemsDeliveredThisRequest
  const hasMoreByTotal =
    Boolean(pagination) &&
    !pagination!.indeterminate &&
    typeof pagination!.totalItems === 'number' &&
    pagination!.totalItems > itemsAccountedFor

  const knownTotalPages = pagination?.totalPages ?? 0
  /** `has_more`, known page count, or catalog total greater than rows returned for this page (e.g. search total 24, first payload 4). */
  const canGoNext =
    hasMoreFromApi ||
    hasMoreByTotal ||
    (knownTotalPages > 1 && page < knownTotalPages)

  /** When API total > rows but `ceil(total/limit)` is 1 (chunked responses), still show at least `page + 1` in the pager. */
  const pagerTotalPages =
    knownTotalPages > 1 ? knownTotalPages : canGoNext ? Math.max(knownTotalPages, page + 1) : Math.max(knownTotalPages, 1)

  useEffect(() => {
    if (pagerTotalPages > 0 && page > pagerTotalPages) setPageInUrl(pagerTotalPages)
  }, [pagerTotalPages, page, setPageInUrl])

  useEffect(() => { setPageJump(String(page)) }, [page])

  const showPaginationControls =
    rawProducts.length > 0 &&
    (page > 1 ||
      pagerTotalPages > 1 ||
      hasMoreFromApi ||
      hasMoreByTotal ||
      rawProducts.length >= limit)

  const onSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    navigateShop({ q: searchDraft.trim() || null })
  }

  const activeFilterCount = [gender, sort].filter(Boolean).length

  return (
    <div className="min-h-screen bg-[#F9F8F6]">
      <header className="relative overflow-hidden">
        {/* Full-bleed under fixed navbar; gradient keeps title + search readable on the left */}
        <div className="relative min-h-[300px] sm:min-h-[360px] lg:min-h-[400px]">
          <Image
            src="/brand/shop-hero.jpg"
            alt=""
            fill
            priority
            className="object-cover object-[52%_center] sm:object-[58%_center]"
            sizes="100vw"
          />
          <div
            className="absolute inset-0 bg-gradient-to-r from-[#f9f8f6] via-[#f9f8f6]/78 to-[#f9f8f6]/10 sm:from-[#f9f8f6] sm:via-[#f9f8f6]/55 sm:to-transparent"
            aria-hidden
          />
          {/* Clear ~56px fixed nav + breathing room (same idea as home hero `top-[72px]`). */}
          <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-10 sm:pt-24 sm:pb-14 lg:pt-28 lg:pb-16">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45 }}
              className="text-left max-w-xl"
            >
              <h1 className="font-display text-[1.85rem] sm:text-[2.35rem] lg:text-[2.6rem] font-bold text-[#2a2623] tracking-[-0.02em] drop-shadow-[0_1px_0_rgba(249,248,246,0.85)]">
                {q.trim()
                  ? q.trim().charAt(0).toUpperCase() + q.trim().slice(1)
                  : category
                    ? category.charAt(0).toUpperCase() + category.slice(1)
                    : 'Shop'}
              </h1>
              <p className="mt-2 sm:mt-3 text-[15px] sm:text-base text-[#4a4540] leading-relaxed max-w-md drop-shadow-[0_1px_0_rgba(249,248,246,0.9)]">
                {pagination && !pagination.approximate && !pagination.indeterminate
                  ? `${pagination.totalItems.toLocaleString()} pieces to explore`
                  : pagination?.indeterminate
                    ? 'Browse page by page — the catalog is large.'
                    : pagination?.approximate
                      ? 'More styles on the next pages — use the pager below'
                      : 'Browse the catalog'}
              </p>

              <form onSubmit={onSearchSubmit} className="mt-6 sm:mt-8 w-full max-w-xl">
                <div className="relative flex items-center h-14 sm:h-[3.75rem] rounded-full border border-[#e8e4df]/90 bg-white/95 backdrop-blur-sm shadow-[0_8px_40px_-12px_rgba(42,38,35,0.15)] transition-all duration-300 focus-within:border-[#d4cdc4] focus-within:shadow-[0_12px_48px_-14px_rgba(42,38,35,0.18)]">
                  <Search className="absolute left-5 sm:left-6 w-5 h-5 text-[#9c9590]" aria-hidden />
                  <input
                    type="search"
                    value={searchDraft}
                    onChange={(e) => setSearchDraft(e.target.value)}
                    placeholder='Search "dress", "sneakers", brand name…'
                    className="w-full h-full pl-14 sm:pl-[3.25rem] pr-[5.75rem] sm:pr-[6.25rem] bg-transparent rounded-full focus:outline-none text-[15px] sm:text-[16px] text-[#2a2623] placeholder:text-[#a39e98]"
                  />
                  <button
                    type="submit"
                    className="absolute right-2.5 sm:right-3 px-4 sm:px-5 py-2 rounded-full bg-brand text-white text-sm font-semibold hover:bg-brand-hover shadow-sm ring-1 ring-brand/25 transition-all active:scale-[0.98]"
                  >
                    Search
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        </div>

        <div className="relative z-10 bg-[#F9F8F6]/98 backdrop-blur-md border-t border-[#ebe8e4]">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2.5">
              <div className="flex items-center gap-1.5 text-[#9c9590] mr-0.5">
                <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden />
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em]">Filter</span>
              </div>
              <button type="button" className={chipClass(!gender)} onClick={() => navigateShop({ gender: null })}>
                All
              </button>
              <button type="button" className={chipClass(gender === 'women')} onClick={() => navigateShop({ gender: 'women' })}>
                Women
              </button>
              <button type="button" className={chipClass(gender === 'men')} onClick={() => navigateShop({ gender: 'men' })}>
                Men
              </button>

              <div className="w-px h-5 bg-[#e3ddd4] mx-0.5 hidden sm:block" aria-hidden />

              <div className="flex items-center gap-1.5 text-[#9c9590] mr-0.5 sm:ml-1">
                <ArrowUpDown className="w-3.5 h-3.5" aria-hidden />
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em]">Sort</span>
              </div>
              <button type="button" className={chipClass(!sort)} onClick={() => navigateShop({ sort: null })}>
                Default
              </button>
              <button type="button" className={chipClass(sort === 'price_asc')} onClick={() => navigateShop({ sort: 'price_asc' })}>
                Price ↑
              </button>
              <button type="button" className={chipClass(sort === 'price_desc')} onClick={() => navigateShop({ sort: 'price_desc' })}>
                Price ↓
              </button>

              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={() => router.push(pathname)}
                  className="ml-0.5 inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold text-brand bg-white border-2 border-brand/40 hover:bg-brand-muted transition-colors"
                >
                  <X className="w-3 h-3" aria-hidden />
                  Clear{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {isPending ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5 sm:gap-6">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="space-y-3">
                <div className="aspect-[3/4] rounded-2xl skeleton-shimmer ring-1 ring-[#ebe8e4]" />
                <div className="h-3 w-2/3 rounded-md skeleton-shimmer" />
                <div className="h-3 w-1/2 rounded-md skeleton-shimmer" />
              </div>
            ))}
          </div>
        ) : products.length > 0 ? (
          <>
            <motion.div
              initial="hidden"
              animate="visible"
              variants={{ visible: { transition: { staggerChildren: 0.04 } }, hidden: {} }}
              className={`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5 sm:gap-6 transition-opacity duration-200 ${isFetching ? 'opacity-[0.94]' : ''}`}
            >
              {products.map((product, i) => (
                <motion.div
                  key={product.id}
                  variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }}
                >
                  <ProductCard
                    product={product}
                    index={i}
                    fromReturnPath={catalogReturnPath}
                    onAddToCompare={addToCompare}
                    onAddToWardrobe={handleAddToWardrobe}
                    wardrobeStatus={
                      wardrobeAddedIds.has(product.id)
                        ? 'added'
                        : addToWardrobeMutation.isPending && addToWardrobeMutation.variables?.id === product.id
                          ? 'loading'
                          : 'idle'
                    }
                  />
                </motion.div>
              ))}
            </motion.div>

            {showPaginationControls && (
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mt-12">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setPageInUrl(page - 1)}
                    disabled={page <= 1}
                    className="p-2.5 rounded-xl border border-[#e8e4df] bg-white text-[#6b6560] hover:bg-[#f3f1ee] hover:border-[#d8d2cd] hover:text-[#2a2623] disabled:opacity-40 disabled:hover:bg-white disabled:hover:border-[#e8e4df] disabled:hover:text-[#6b6560] transition-all"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>

                  <div className="flex items-center gap-1 px-2">
                    {(() => {
                      const tp = pagerTotalPages
                      const windowSize = Math.min(tp, 7)
                      return Array.from({ length: windowSize }).map((_, i) => {
                        let pageNum: number
                        if (tp <= 7) {
                          pageNum = i + 1
                        } else if (page <= 4) {
                          pageNum = i + 1
                        } else if (page >= tp - 3) {
                          pageNum = tp - 6 + i
                        } else {
                          pageNum = page - 3 + i
                        }
                        return (
                          <button
                            key={pageNum}
                            type="button"
                            onClick={() => setPageInUrl(pageNum)}
                            className={`w-9 h-9 rounded-lg text-sm font-semibold transition-all ${
                              pageNum === page
                                ? 'bg-[#ebe6e0] border border-[#d8d2cd] text-[#2a2623] shadow-sm'
                                : 'text-[#6b6560] hover:bg-[#f3f1ee] hover:text-[#2a2623]'
                            }`}
                          >
                            {pageNum}
                          </button>
                        )
                      })
                    })()}

                    {pagerTotalPages <= 1 && canGoNext && (
                      <span className="w-9 h-9 flex items-center justify-center text-sm text-[#b8aea5]">…</span>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => setPageInUrl(page + 1)}
                    disabled={!canGoNext}
                    className="p-2.5 rounded-xl border border-[#e8e4df] bg-white text-[#6b6560] hover:bg-[#f3f1ee] hover:border-[#d8d2cd] hover:text-[#2a2623] disabled:opacity-40 disabled:hover:bg-white disabled:hover:border-[#e8e4df] disabled:hover:text-[#6b6560] transition-all"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>

                <form
                  className="flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    const n = parseInt(pageJump, 10)
                    if (!Number.isFinite(n) || n < 1) return
                    setPageInUrl(pagerTotalPages > 0 ? Math.min(n, pagerTotalPages) : n)
                  }}
                >
                  <label htmlFor="shop-page-jump" className="text-sm text-[#7a726b] whitespace-nowrap">
                    Go to page
                  </label>
                  <input
                    id="shop-page-jump"
                    type="number"
                    min={1}
                    {...(pagerTotalPages > 0 ? { max: pagerTotalPages } : {})}
                    value={pageJump}
                    onChange={(e) => setPageJump(e.target.value)}
                    className="w-16 px-2 py-2 rounded-lg border border-[#e8e4df] bg-white text-[#2a2623] text-center text-sm focus:ring-2 focus:ring-[#d8c6bb]/40 focus:border-[#d8d2cd]"
                  />
                  <button type="submit" className="px-3 py-2 rounded-lg text-sm font-semibold bg-[#ebe6e0] text-[#2a2623] border border-[#d8d2cd] hover:bg-[#e4dcd4] transition-colors">
                    Go
                  </button>
                </form>

                <span className="text-sm text-[#7a726b]">
                  {pagination?.indeterminate && hasMoreFromApi
                    ? `Page ${page} · more results`
                    : pagination?.indeterminate
                      ? `Page ${page}`
                      : pagerTotalPages > 0
                        ? `Page ${page} of ${pagerTotalPages}`
                        : `Page ${page}`}
                </span>
              </div>
            )}
          </>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center py-20 max-w-md mx-auto"
          >
            <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-[#faf9f7] ring-1 ring-[#ebe8e4] flex items-center justify-center">
              <ShoppingBag className="w-8 h-8 text-[#3d3030]" aria-hidden />
            </div>
            <p className="font-display font-bold text-[#2a2623] text-lg mb-2">No products found</p>
            <p className="text-[#7a726b] mb-5 text-[15px]">Try adjusting your search or filters.</p>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={() => router.push(pathname)}
                className="inline-flex items-center gap-1.5 px-6 py-2.5 rounded-full bg-brand text-white text-sm font-semibold hover:bg-brand-hover shadow-sm ring-1 ring-brand/25 transition-all active:scale-[0.98]"
              >
                <X className="w-4 h-4" aria-hidden />
                Clear all filters
              </button>
            )}
          </motion.div>
        )}
      </div>
    </div>
  )
}

export default function ProductsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-[#d8c6bb] border-t-[#2a2623] animate-spin" />
      </div>
    }>
      <ProductsContent />
    </Suspense>
  )
}
