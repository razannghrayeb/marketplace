'use client'

import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { Suspense, useState, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Search, SlidersHorizontal, ArrowUpDown, X, ChevronLeft, ChevronRight, ShoppingBag } from 'lucide-react'
import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'
import { getStablePagination } from '@/lib/shopPagination'
import { ProductCard } from '@/components/product/ProductCard'
import { useCompareStore } from '@/store/compare'
import type { Product } from '@/types/product'

function chipClass(active: boolean) {
  return `px-3.5 py-1.5 rounded-full text-[13px] font-semibold transition-all duration-200 ${
    active
      ? 'bg-gradient-to-r from-violet-600 to-fuchsia-500 text-white shadow-md shadow-violet-500/20'
      : 'bg-white text-neutral-600 border border-neutral-200/80 hover:border-violet-200 hover:text-violet-700 hover:bg-violet-50/50'
  }`
}

function ProductsContent() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const q = searchParams.get('q') ?? ''
  const gender = searchParams.get('gender') ?? ''
  const sort = searchParams.get('sort') ?? ''
  const category = searchParams.get('category') ?? ''

  const [page, setPage] = useState(1)
  const [pageJump, setPageJump] = useState('')
  const [searchDraft, setSearchDraft] = useState(q)
  const limit = 24
  const addToCompare = useCompareStore((s) => s.add)
  const inCompare = useCompareStore((s) => s.has)

  useEffect(() => { setSearchDraft(q) }, [q])
  useEffect(() => { setPage(1); setPageJump('') }, [q, gender, sort, category])

  const navigateShop = (patch: Record<string, string | null | undefined>) => {
    const p = new URLSearchParams(searchParams.toString())
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === null || v === '') p.delete(k)
      else p.set(k, v)
    }
    const qs = p.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  const hasActiveFilters = !!q.trim() || !!gender || !!sort || !!category

  const queryKey = ['products', page, category, q, gender, sort, limit] as const

  const { data, isLoading, isFetching } = useQuery({
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
  })

  const rawProducts: Product[] = Array.isArray(data?.data) ? data.data : []

  const products = useMemo(() => {
    if (!sort || rawProducts.length === 0) return rawProducts
    const getEffectivePrice = (p: Product) =>
      (p.sales_price_cents != null && p.sales_price_cents > 0 ? p.sales_price_cents : p.price_cents) || 0
    const sorted = [...rawProducts]
    if (sort === 'price_asc') sorted.sort((a, b) => getEffectivePrice(a) - getEffectivePrice(b))
    else if (sort === 'price_desc') sorted.sort((a, b) => getEffectivePrice(b) - getEffectivePrice(a))
    return sorted
  }, [rawProducts, sort])

  const pagination = useMemo(() => {
    const stable = getStablePagination(data, limit)
    if (stable) return stable
    if (rawProducts.length > 0) {
      return { totalItems: rawProducts.length, totalPages: 0 }
    }
    return null
  }, [data, limit, rawProducts.length])

  const knownTotalPages = pagination?.totalPages ?? 0
  const hasFullPage = rawProducts.length >= limit
  const canGoNext = knownTotalPages > 1 ? page < knownTotalPages : hasFullPage

  useEffect(() => {
    if (knownTotalPages > 0 && page > knownTotalPages) setPage(knownTotalPages)
  }, [knownTotalPages, page])

  useEffect(() => { setPageJump(String(page)) }, [page])

  const showPaginationControls = rawProducts.length > 0 && (page > 1 || canGoNext)

  const onSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    navigateShop({ q: searchDraft.trim() || null })
  }

  const activeFilterCount = [gender, sort].filter(Boolean).length

  return (
    <>
      {/* ── Header with gradient background ── */}
      <div className="relative overflow-hidden bg-gradient-to-b from-violet-50 via-fuchsia-50/40 to-neutral-100 border-b border-neutral-200/60">
        <div className="pointer-events-none absolute -top-16 -right-16 h-64 w-64 rounded-full bg-violet-200/40 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute top-8 -left-12 h-48 w-48 rounded-full bg-fuchsia-200/30 blur-3xl" aria-hidden />

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-6">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
            <div className="flex items-center gap-3 mb-5">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-md shadow-violet-500/20">
                <ShoppingBag className="w-5 h-5" />
              </div>
              <div>
                <h1 className="font-display text-2xl sm:text-3xl font-bold text-neutral-900">
                  {category ? category.charAt(0).toUpperCase() + category.slice(1) : 'Shop'}
                </h1>
                <p className="text-sm text-neutral-500 mt-0.5">
                  {pagination ? `${pagination.totalItems.toLocaleString()} products` : 'Browse the full catalog'}
                </p>
              </div>
            </div>

            {/* Search */}
            <form
              onSubmit={onSearchSubmit}
              className="relative flex items-center w-full max-w-2xl rounded-2xl bg-white border border-neutral-200 shadow-sm h-12 focus-within:ring-2 focus-within:ring-violet-500/30 focus-within:border-violet-400 transition-all"
            >
              <Search className="absolute left-4 w-5 h-5 text-neutral-400" />
              <input
                type="search"
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                placeholder='Search "dress", "sneakers", brand name...'
                className="w-full h-full pl-12 pr-24 bg-transparent text-neutral-700 placeholder-neutral-400 focus:outline-none text-base rounded-2xl"
              />
              <button
                type="submit"
                className="absolute right-2 px-4 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-500 text-white text-sm font-semibold hover:from-violet-500 hover:to-fuchsia-400 shadow-sm shadow-violet-500/20 transition-all active:scale-[0.97]"
              >
                Search
              </button>
            </form>

            {/* ── Compact inline filters ── */}
            <div className="flex flex-wrap items-center gap-2.5 mt-5">
              <div className="flex items-center gap-1.5 text-neutral-500 mr-1">
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span className="text-xs font-medium uppercase tracking-wider">Filter</span>
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

              <div className="w-px h-5 bg-neutral-300/60 mx-1" />

              <div className="flex items-center gap-1.5 text-neutral-500 mr-1">
                <ArrowUpDown className="w-3.5 h-3.5" />
                <span className="text-xs font-medium uppercase tracking-wider">Sort</span>
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
                  className="ml-1 inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold text-rose-600 bg-rose-50 border border-rose-200/60 hover:bg-rose-100 transition-colors"
                >
                  <X className="w-3 h-3" />
                  Clear{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
                </button>
              )}
            </div>
          </motion.div>
        </div>
      </div>

      {/* ── Product grid ── */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {(isLoading || isFetching) ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5 sm:gap-6">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="space-y-3">
                <div className="aspect-[3/4] rounded-2xl skeleton-shimmer ring-1 ring-neutral-200/60" />
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
              className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5 sm:gap-6"
            >
              {products.map((product, i) => (
                <motion.div
                  key={product.id}
                  variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }}
                >
                  <ProductCard
                    product={product}
                    index={i}
                    onAddToCompare={addToCompare}
                    inCompare={inCompare(product.id)}
                  />
                </motion.div>
              ))}
            </motion.div>

            {showPaginationControls && (
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mt-12">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="p-2.5 rounded-xl border border-neutral-200 bg-white text-neutral-600 hover:bg-violet-50 hover:border-violet-200 hover:text-violet-700 disabled:opacity-40 disabled:hover:bg-white disabled:hover:border-neutral-200 disabled:hover:text-neutral-600 transition-all"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>

                  <div className="flex items-center gap-1 px-2">
                    {(() => {
                      const tp = knownTotalPages > 0 ? knownTotalPages : page + (canGoNext ? 1 : 0)
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
                            onClick={() => setPage(pageNum)}
                            className={`w-9 h-9 rounded-lg text-sm font-semibold transition-all ${
                              pageNum === page
                                ? 'bg-gradient-to-r from-violet-600 to-fuchsia-500 text-white shadow-md shadow-violet-500/20'
                                : 'text-neutral-600 hover:bg-violet-50 hover:text-violet-700'
                            }`}
                          >
                            {pageNum}
                          </button>
                        )
                      })
                    })()}

                    {knownTotalPages === 0 && canGoNext && (
                      <span className="w-9 h-9 flex items-center justify-center text-sm text-neutral-400">…</span>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => setPage((p) => p + 1)}
                    disabled={!canGoNext}
                    className="p-2.5 rounded-xl border border-neutral-200 bg-white text-neutral-600 hover:bg-violet-50 hover:border-violet-200 hover:text-violet-700 disabled:opacity-40 disabled:hover:bg-white disabled:hover:border-neutral-200 disabled:hover:text-neutral-600 transition-all"
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
                    setPage(knownTotalPages > 0 ? Math.min(n, knownTotalPages) : n)
                  }}
                >
                  <label htmlFor="shop-page-jump" className="text-sm text-neutral-500 whitespace-nowrap">
                    Go to page
                  </label>
                  <input
                    id="shop-page-jump"
                    type="number"
                    min={1}
                    {...(knownTotalPages > 0 ? { max: knownTotalPages } : {})}
                    value={pageJump}
                    onChange={(e) => setPageJump(e.target.value)}
                    className="w-16 px-2 py-2 rounded-lg border border-neutral-200 bg-white text-neutral-800 text-center text-sm focus:ring-2 focus:ring-violet-200 focus:border-violet-300"
                  />
                  <button type="submit" className="px-3 py-2 rounded-lg text-sm font-semibold bg-violet-100 text-violet-700 hover:bg-violet-200 transition-colors">
                    Go
                  </button>
                </form>

                <span className="text-sm text-neutral-500">
                  Page {page}{knownTotalPages > 0 ? ` of ${knownTotalPages}` : ''}
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
            <div className="relative w-20 h-20 mx-auto mb-6">
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 opacity-20 blur-xl" />
              <div className="relative w-20 h-20 rounded-2xl bg-gradient-to-br from-violet-100 to-fuchsia-100 flex items-center justify-center">
                <ShoppingBag className="w-9 h-9 text-violet-600" />
              </div>
            </div>
            <p className="font-bold text-neutral-900 text-lg mb-2">No products found</p>
            <p className="text-neutral-500 mb-5">Try adjusting your search or filters.</p>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={() => router.push(pathname)}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-500 text-white text-sm font-semibold hover:from-violet-500 hover:to-fuchsia-400 shadow-md shadow-violet-500/20 transition-all active:scale-[0.97]"
              >
                <X className="w-4 h-4" />
                Clear all filters
              </button>
            )}
          </motion.div>
        )}
      </div>
    </>
  )
}

export default function ProductsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-violet-300 border-t-violet-600 animate-spin" />
      </div>
    }>
      <ProductsContent />
    </Suspense>
  )
}
