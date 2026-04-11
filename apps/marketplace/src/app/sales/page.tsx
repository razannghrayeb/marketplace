'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import Link from 'next/link'
import { Percent, ArrowUpDown, ChevronLeft, ChevronRight, ShoppingBag } from 'lucide-react'
import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'
import { getStablePagination } from '@/lib/shopPagination'
import { ProductCard } from '@/components/product/ProductCard'
import { useCompareStore } from '@/store/compare'
import { useAuthStore } from '@/store/auth'
import { addCatalogProductToWardrobe } from '@/lib/wardrobe/addCatalogProduct'
import type { Product } from '@/types/product'

function chipClass(active: boolean) {
  return `px-3.5 py-1.5 rounded-full text-[13px] font-semibold transition-all duration-200 ${
    active
      ? 'bg-gradient-to-r from-rose-600 to-fuchsia-500 text-white shadow-md shadow-rose-500/20'
      : 'bg-white text-neutral-600 border border-neutral-200/80 hover:border-rose-200 hover:text-rose-700 hover:bg-rose-50/50'
  }`
}

function normalizeProduct(raw: Record<string, unknown>): Product {
  const id = Number(raw.id)
  return {
    id: Number.isFinite(id) && id >= 1 ? id : 0,
    title: String(raw.title ?? raw.name ?? ''),
    price_cents: Number(raw.price_cents) || 0,
    sales_price_cents:
      raw.sales_price_cents != null && raw.sales_price_cents !== ''
        ? Number(raw.sales_price_cents)
        : null,
    brand: (raw.brand as string) ?? null,
    category: (raw.category as string) ?? null,
    currency: (raw.currency as string) || 'USD',
    image_url: (raw.image_url as string) ?? null,
    image_cdn: (raw.image_cdn as string) ?? null,
  }
}

function SalesContent() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const sort = searchParams.get('sort') ?? ''
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1)
  const limit = 24

  const setQuery = (patch: Record<string, string | null | undefined>) => {
    const p = new URLSearchParams(searchParams.toString())
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === null || v === '') p.delete(k)
      else p.set(k, v)
    }
    const qs = p.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  const addToCompare = useCompareStore((s) => s.add)
  const inCompare = useCompareStore((s) => s.has)

  const [wardrobeAddedIds, setWardrobeAddedIds] = useState<Set<number>>(() => new Set())
  const addToWardrobeMutation = useMutation({
    mutationFn: (product: Product) => addCatalogProductToWardrobe(product),
    onSuccess: (_, product) => {
      void queryClient.invalidateQueries({ queryKey: ['wardrobe'] })
      setWardrobeAddedIds((prev) => new Set(prev).add(product.id))
    },
  })

  const handleAddToWardrobe = (product: Product) => {
    if (!isAuthenticated()) {
      const qs = new URLSearchParams({ next: `${pathname}${searchParams.toString() ? `?${searchParams}` : ''}` })
      router.push(`/login?${qs.toString()}`)
      return
    }
    addToWardrobeMutation.mutate(product)
  }

  const queryKey = ['products', 'sales', page, sort, limit] as const

  const { data, isLoading, isFetching } = useQuery({
    queryKey,
    queryFn: async () => {
      const params: Record<string, string | number> = { page, limit }
      if (sort) params.sort = sort
      return api.get<unknown[]>(endpoints.products.sales, params)
    },
  })

  const rawList: unknown[] = Array.isArray(data?.data) ? data.data : []
  const products = useMemo(
    () =>
      rawList
        .filter((r): r is Record<string, unknown> => r != null && typeof r === 'object')
        .map(normalizeProduct)
        .filter((p) => p.id >= 1),
    [rawList],
  )

  const pagination = useMemo(() => getStablePagination(data, limit), [data, limit])
  const knownTotalPages = pagination?.totalPages ?? 0
  const hasFullPage = products.length >= limit
  const canGoNext = knownTotalPages > 1 ? page < knownTotalPages : hasFullPage

  const [pageJump, setPageJump] = useState(String(page))
  useEffect(() => {
    setPageJump(String(page))
  }, [page])

  useEffect(() => {
    if (knownTotalPages <= 0 || page <= knownTotalPages) return
    const p = new URLSearchParams(searchParams.toString())
    p.set('page', String(knownTotalPages))
    router.replace(p.toString() ? `${pathname}?${p}` : pathname)
  }, [knownTotalPages, page, pathname, router, searchParams])

  const showPaginationControls = products.length > 0 && (page > 1 || canGoNext)

  const discountLabel = (p: Product) => {
    const reg = p.price_cents
    const sale = p.sales_price_cents
    if (!sale || sale >= reg || reg <= 0) return null
    return Math.round(((reg - sale) / reg) * 100)
  }

  return (
    <>
      <div className="relative overflow-hidden bg-gradient-to-b from-rose-50 via-fuchsia-50/40 to-neutral-100 border-b border-neutral-200/60">
        <div className="pointer-events-none absolute -top-16 -right-16 h-64 w-64 rounded-full bg-rose-200/40 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute top-8 -left-12 h-48 w-48 rounded-full bg-fuchsia-200/30 blur-3xl" aria-hidden />

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-6">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-5">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-gradient-to-br from-rose-600 to-fuchsia-500 text-white shadow-md shadow-rose-500/20">
                  <Percent className="w-5 h-5" />
                </div>
                <div>
                  <h1 className="font-display text-2xl sm:text-3xl font-bold text-neutral-900">Sale</h1>
                  <p className="text-sm text-neutral-500 mt-0.5">
                    {pagination
                      ? `${pagination.totalItems.toLocaleString()} deals`
                      : 'Limited-time prices on select styles'}
                  </p>
                </div>
              </div>
              <Link
                href="/products"
                className="text-sm font-semibold text-violet-600 hover:text-violet-800 shrink-0"
              >
                Browse full shop →
              </Link>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <div className="flex items-center gap-1.5 text-neutral-500 mr-1">
                <ArrowUpDown className="w-3.5 h-3.5" />
                <span className="text-xs font-medium uppercase tracking-wider">Sort</span>
              </div>
              <button type="button" className={chipClass(!sort)} onClick={() => setQuery({ sort: null, page: null })}>
                Biggest discount
              </button>
              <button
                type="button"
                className={chipClass(sort === 'price_asc')}
                onClick={() => setQuery({ sort: 'price_asc', page: '1' })}
              >
                Sale price ↑
              </button>
              <button
                type="button"
                className={chipClass(sort === 'price_desc')}
                onClick={() => setQuery({ sort: 'price_desc', page: '1' })}
              >
                Sale price ↓
              </button>
            </div>
          </motion.div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {isLoading || isFetching ? (
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
              variants={{ visible: { transition: { staggerChildren: 0.05 } }, hidden: {} }}
              className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5 sm:gap-6"
            >
              {products.map((product, i) => {
                const pct = discountLabel(product)
                return (
                  <motion.div
                    key={product.id}
                    variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }}
                    className="relative"
                  >
                    {pct != null && pct > 0 ? (
                      <span className="absolute top-2 right-2 z-[5] rounded-full bg-rose-600 text-white text-[10px] font-bold px-2 py-0.5 shadow-md">
                        −{pct}%
                      </span>
                    ) : null}
                    <ProductCard
                      product={product}
                      index={i}
                      onAddToCompare={addToCompare}
                      inCompare={inCompare(product.id)}
                      onAddToWardrobe={handleAddToWardrobe}
                      wardrobeStatus={
                        addToWardrobeMutation.isPending && addToWardrobeMutation.variables?.id === product.id
                          ? 'loading'
                          : wardrobeAddedIds.has(product.id)
                            ? 'added'
                            : 'idle'
                      }
                    />
                  </motion.div>
                )
              })}
            </motion.div>

            {showPaginationControls && (
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mt-12">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setQuery({ page: String(Math.max(1, page - 1)) })}
                    disabled={page <= 1}
                    className="p-2.5 rounded-xl border border-neutral-200 bg-white text-neutral-600 hover:bg-rose-50 hover:border-rose-200 hover:text-rose-700 disabled:opacity-40 transition-all"
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
                            onClick={() => setQuery({ page: String(pageNum) })}
                            className={`w-9 h-9 rounded-lg text-sm font-semibold transition-all ${
                              pageNum === page
                                ? 'bg-gradient-to-r from-rose-600 to-fuchsia-500 text-white shadow-md shadow-rose-500/20'
                                : 'text-neutral-600 hover:bg-rose-50 hover:text-rose-700'
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
                    onClick={() => setQuery({ page: String(page + 1) })}
                    disabled={!canGoNext}
                    className="p-2.5 rounded-xl border border-neutral-200 bg-white text-neutral-600 hover:bg-rose-50 hover:border-rose-200 hover:text-rose-700 disabled:opacity-40 transition-all"
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
                    setQuery({ page: String(knownTotalPages > 0 ? Math.min(n, knownTotalPages) : n) })
                  }}
                >
                  <label htmlFor="sales-page-jump" className="text-sm text-neutral-500 whitespace-nowrap">
                    Go to page
                  </label>
                  <input
                    id="sales-page-jump"
                    type="number"
                    min={1}
                    {...(knownTotalPages > 0 ? { max: knownTotalPages } : {})}
                    value={pageJump}
                    onChange={(e) => setPageJump(e.target.value)}
                    className="w-16 px-2 py-2 rounded-lg border border-neutral-200 bg-white text-neutral-800 text-center text-sm focus:ring-2 focus:ring-rose-200 focus:border-rose-300"
                  />
                  <button
                    type="submit"
                    className="px-3 py-2 rounded-lg text-sm font-semibold bg-rose-100 text-rose-800 hover:bg-rose-200 transition-colors"
                  >
                    Go
                  </button>
                </form>

                <span className="text-sm text-neutral-500">
                  Page {page}
                  {knownTotalPages > 0 ? ` of ${knownTotalPages}` : ''}
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
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-rose-500 to-fuchsia-500 opacity-20 blur-xl" />
              <div className="relative w-20 h-20 rounded-2xl bg-gradient-to-br from-rose-100 to-fuchsia-100 flex items-center justify-center">
                <ShoppingBag className="w-9 h-9 text-rose-600" />
              </div>
            </div>
            <p className="font-bold text-neutral-900 text-lg mb-2">No sale items right now</p>
            <p className="text-neutral-500 mb-5">Check back soon or browse the full catalog.</p>
            <Link
              href="/products"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-500 text-white font-semibold shadow-lg shadow-violet-500/20 hover:from-violet-500 hover:to-fuchsia-400 transition-all"
            >
              Go to shop
            </Link>
          </motion.div>
        )}
      </div>
    </>
  )
}

export default function SalesPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[60vh] flex items-center justify-center">
          <div className="w-8 h-8 rounded-full border-2 border-rose-300 border-t-rose-600 animate-spin" />
        </div>
      }
    >
      <SalesContent />
    </Suspense>
  )
}
