'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, ShoppingBag } from 'lucide-react'
import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'
import { getStablePagination } from '@/lib/shopPagination'
import { ProductCard } from '@/components/product/ProductCard'
import { SaleHero } from '@/components/sales/SaleHero'
import type { Product } from '@/types/product'
import { extractVendorFieldsFromRecords } from '@/lib/vendorLogo'
import { readAndClearListingScrollY } from '@/lib/navigation/listingScrollRestore'

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
    ...extractVendorFieldsFromRecords(raw, {}),
  }
}

function SalesContent() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1)
  const limit = 24

  const salesReturnPath = useMemo(() => {
    const qs = searchParams.toString()
    return qs ? `${pathname}?${qs}` : pathname
  }, [pathname, searchParams])

  useEffect(() => {
    const y = readAndClearListingScrollY(salesReturnPath)
    if (y == null) return
    const id = requestAnimationFrame(() => {
      window.scrollTo({ top: y, behavior: 'instant' })
    })
    return () => cancelAnimationFrame(id)
  }, [salesReturnPath])

  const setPageParams = (patch: Record<string, string | null | undefined>) => {
    const p = new URLSearchParams(searchParams.toString())
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === null || v === '') p.delete(k)
      else p.set(k, v)
    }
    const qs = p.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  const queryKey = ['products', 'sales', page, limit] as const

  const { data, isPending, isFetching } = useQuery({
    queryKey,
    queryFn: async () => {
      const params: Record<string, string | number> = { page, limit }
      return api.get<unknown[]>(endpoints.products.sales, params)
    },
    placeholderData: keepPreviousData,
    staleTime: 90_000,
    gcTime: 600_000,
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
  const hasMoreFromApi = data?.pagination?.has_more === true
  const canGoNext = hasMoreFromApi || (knownTotalPages > 1 && page < knownTotalPages)

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
    <div className="min-h-screen bg-[#f9f8f6]">
      <SaleHero />

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="font-display text-xl font-bold tracking-tight text-[#2a2623] sm:text-2xl">Featured deals</h2>
            {pagination && pagination.totalItems > 0 ? (
              <p className="mt-1 text-sm text-[#7a726b]">{pagination.totalItems.toLocaleString()} items on sale</p>
            ) : pagination?.indeterminate ? (
              <p className="mt-1 text-sm text-[#7a726b]">Sale items — use the pager for more</p>
            ) : (
              <p className="mt-1 text-sm text-[#7a726b]">Limited-time markdowns</p>
            )}
          </div>
          <Link href="/products" className="text-sm font-semibold text-brand hover:text-brand-hover shrink-0">
            Browse full shop →
          </Link>
        </div>

        {isPending ? (
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
              className={`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5 sm:gap-6 ${isFetching ? 'opacity-[0.92] transition-opacity duration-200' : ''}`}
            >
              {products.map((product, i) => {
                const pct = discountLabel(product)
                return (
                  <motion.div
                    key={product.id}
                    variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }}
                  >
                    <ProductCard
                      product={product}
                      index={i}
                      fromReturnPath={salesReturnPath}
                      saleDiscountPercent={pct != null && pct > 0 ? pct : null}
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
                    onClick={() => setPageParams({ page: String(Math.max(1, page - 1)) })}
                    disabled={page <= 1}
                    className="p-2.5 rounded-xl border border-neutral-200 bg-white text-neutral-600 hover:bg-[#f7f0eb] hover:border-[#d8c6bb] hover:text-[#2a2623] disabled:opacity-40 transition-all"
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
                            onClick={() => setPageParams({ page: String(pageNum) })}
                            className={`w-9 h-9 rounded-lg text-sm font-semibold transition-all ${
                              pageNum === page
                                ? 'bg-brand text-white shadow-md shadow-brand/20'
                                : 'text-neutral-600 hover:bg-[#f7f0eb] hover:text-[#2a2623]'
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
                    onClick={() => setPageParams({ page: String(page + 1) })}
                    disabled={!canGoNext}
                    className="p-2.5 rounded-xl border border-neutral-200 bg-white text-neutral-600 hover:bg-[#f7f0eb] hover:border-[#d8c6bb] hover:text-[#2a2623] disabled:opacity-40 transition-all"
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
                    setPageParams({ page: String(knownTotalPages > 0 ? Math.min(n, knownTotalPages) : n) })
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
                    className="w-16 px-2 py-2 rounded-lg border border-neutral-200 bg-white text-neutral-800 text-center text-sm focus:ring-2 focus:ring-[#d8c6bb] focus:border-[#c9ae9f]"
                  />
                  <button
                    type="submit"
                    className="px-3 py-2 rounded-lg text-sm font-semibold bg-[#f4ece6] text-[#2a2623] hover:bg-[#eadfd7] transition-colors"
                  >
                    Go
                  </button>
                </form>

                <span className="text-sm text-neutral-500">
                  {pagination?.indeterminate && hasMoreFromApi
                    ? `Page ${page} · more results`
                    : pagination?.indeterminate
                      ? `Page ${page}`
                      : knownTotalPages > 0
                        ? `Page ${page} of ${knownTotalPages}`
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
            <div className="relative w-20 h-20 mx-auto mb-6">
              <div className="absolute inset-0 rounded-2xl bg-brand opacity-20 blur-xl" />
              <div className="relative w-20 h-20 rounded-2xl bg-gradient-to-br from-[#f4ece6] to-[#ede0d7] flex items-center justify-center">
                <ShoppingBag className="w-9 h-9 text-[#2a2623]" />
              </div>
            </div>
            <p className="font-bold text-neutral-900 text-lg mb-2">No sale items right now</p>
            <p className="text-neutral-500 mb-5">Check back soon or browse the full catalog.</p>
            <Link
              href="/products"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-brand text-white font-semibold shadow-lg shadow-brand/20 hover:bg-brand-hover transition-all"
            >
              Go to shop
            </Link>
          </motion.div>
        )}
      </div>

      <section className="border-t border-[#ebe8e4]/80 bg-[#f2ebe4]/40 py-12">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <h3 className="font-display text-lg font-bold text-[#2a2623]">More ways to shop</h3>
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            {[
              {
                href: '/products',
                title: 'Shop by price',
                desc: 'Browse the full catalog and sort by what fits your budget.',
              },
              {
                href: '/search',
                title: 'Editor picks',
                desc: 'Discover styles tailored to your taste with smart search.',
              },
              {
                href: '/products',
                title: 'Under $50',
                desc: 'Great finds at gentler price points — updated regularly.',
              },
            ].map((card) => (
              <Link
                key={card.title}
                href={card.href}
                className="group flex flex-col rounded-2xl border border-[#ebe8e4] bg-white p-5 shadow-[0_12px_36px_-28px_rgba(42,38,35,0.22)] transition-all hover:border-[#d8c6bb] hover:shadow-[0_16px_40px_-28px_rgba(42,38,35,0.28)]"
              >
                <span className="font-semibold text-[#2a2623] group-hover:text-brand">{card.title}</span>
                <span className="mt-2 text-sm leading-relaxed text-[#7a726b]">{card.desc}</span>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand">
                  Explore <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

export default function SalesPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[60vh] flex items-center justify-center">
          <div className="w-8 h-8 rounded-full border-2 border-[#eadfd7] border-t-[#2a2623] animate-spin" />
        </div>
      }
    >
      <SalesContent />
    </Suspense>
  )
}
