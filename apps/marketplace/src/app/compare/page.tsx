'use client'

import { useQuery, useMutation } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { GitCompare, X, CheckCircle } from 'lucide-react'
import Link from 'next/link'
import Image from 'next/image'
import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'
import { useCompareStore } from '@/store/compare'
import { ProductCard } from '@/components/product/ProductCard'
import type { Product } from '@/types/product'

interface ProductSummary {
  product_id: number
  level_label: string
  level_color: 'green' | 'yellow' | 'red'
  score: number
  highlights: string[]
  concerns: string[]
  tooltips: Record<string, string>
}

interface VerdictOutput {
  title: string
  subtitle: string
  bullet_points: string[]
  tradeoff: string | null
  confidence_label: string
  confidence_description: string
  recommendation: string
}

interface CompareResult {
  verdict: VerdictOutput
  product_summaries: ProductSummary[]
  comparison_details: {
    winner_id: number | null
    is_tie: boolean
    score_difference: number
  }
  product_map?: Record<number, string>
}

export default function ComparePage() {
  const { productIds, remove, clear } = useCompareStore()

  const { data: products, isLoading: loadingProducts } = useQuery({
    queryKey: ['compare-products', productIds],
    queryFn: async () => {
      const results: Product[] = []
      for (const id of productIds) {
        const res = await api.get<Product | { data: Product }>(endpoints.products.byId(id))
        const p = (res as { data?: Product })?.data ?? (res as Product)
        if (p && 'id' in p) results.push(p as Product)
      }
      return results
    },
    enabled: productIds.length > 0,
  })

  const compareMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post<CompareResult>(endpoints.compare, { product_ids: productIds })
      if ((res as { success?: boolean }).success === false) throw new Error((res as { error?: { message?: string } }).error?.message)
      return res as CompareResult
    },
  })

  const compareResult = compareMutation.data

  const runCompare = () => {
    if (productIds.length >= 2 && productIds.length <= 5) {
      compareMutation.mutate()
    }
  }

  const canCompare = productIds.length >= 2 && productIds.length <= 5

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h1 className="font-display text-3xl font-bold text-charcoal-800 mb-2">Compare Products</h1>
        <p className="text-charcoal-500 mb-8">
          Select 2–5 products to compare quality, price, and features side by side.
        </p>

        {productIds.length === 0 ? (
          <div className="p-12 rounded-2xl bg-cream-100 border-2 border-dashed border-cream-300 text-center">
            <GitCompare className="w-16 h-16 text-charcoal-300 mx-auto mb-4" />
            <p className="text-charcoal-600 mb-6">Add products from the shop to compare them here.</p>
            <Link href="/products" className="btn-primary">
              Browse products
            </Link>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-6">
              <p className="text-sm text-charcoal-600">
                {productIds.length} product{productIds.length !== 1 ? 's' : ''} selected
                {!canCompare && productIds.length > 0 && (
                  <span className="ml-2 text-wine-600">
                    (need 2–5 products)
                  </span>
                )}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={clear}
                  className="text-sm text-charcoal-500 hover:text-charcoal-700"
                >
                  Clear all
                </button>
                {canCompare && (
                  <button
                    onClick={runCompare}
                    disabled={compareMutation.isPending}
                    className="btn-primary flex items-center gap-2"
                  >
                    {compareMutation.isPending ? 'Comparing...' : 'Compare'}
                    <GitCompare className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-10">
              {loadingProducts ? (
                [...Array(productIds.length)].map((_, i) => (
                  <div key={i} className="aspect-[3/4] rounded-2xl bg-cream-200 animate-pulse" />
                ))
              ) : (
                products?.map((p) => (
                  <div key={p.id} className="relative group">
                    <button
                      onClick={() => remove(p.id)}
                      className="absolute top-2 right-2 z-10 p-1.5 rounded-full bg-white/90 hover:bg-wine-100 text-charcoal-500 hover:text-wine-600 transition-colors"
                      aria-label="Remove from compare"
                    >
                      <X className="w-4 h-4" />
                    </button>
                    <ProductCard product={p} inCompare />
                  </div>
                ))
              )}
            </div>

            {compareMutation.isError && (
              <div className="p-4 rounded-xl bg-wine-50 border border-wine-200 text-wine-700 mb-6">
                {(compareMutation.error as Error)?.message}
              </div>
            )}

            {compareResult && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-8"
              >
                <div className="p-6 rounded-2xl bg-cream-100 border border-cream-300">
                  <h2 className="font-display text-xl font-bold text-charcoal-800 mb-2">
                    {compareResult.verdict.title}
                  </h2>
                  <p className="text-charcoal-600 mb-4">{compareResult.verdict.subtitle}</p>
                  {compareResult.verdict.bullet_points?.length > 0 && (
                    <ul className="list-disc list-inside text-charcoal-600 mb-4">
                      {compareResult.verdict.bullet_points.map((b, i) => (
                        <li key={i}>{b}</li>
                      ))}
                    </ul>
                  )}
                  <p className="font-medium text-charcoal-800">{compareResult.verdict.recommendation}</p>
                </div>

                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {compareResult.product_summaries.map((summary) => {
                    const product = products?.find((p) => p.id === summary.product_id)
                    const letter = compareResult.product_map?.[summary.product_id] ?? '?'
                    const colorClass =
                      summary.level_color === 'green'
                        ? 'bg-green-50 border-green-200 text-green-800'
                        : summary.level_color === 'yellow'
                        ? 'bg-yellow-50 border-yellow-200 text-yellow-800'
                        : 'bg-red-50 border-red-200 text-red-800'
                    return (
                      <div
                        key={summary.product_id}
                        className={`p-6 rounded-2xl border ${colorClass}`}
                      >
                        <div className="flex items-start gap-4">
                          {product && (
                            <div className="relative w-20 h-24 flex-shrink-0 rounded-lg overflow-hidden bg-white">
                              <Image
                                src={product.image_cdn || product.image_url || 'https://placehold.co/80x96'}
                                alt={product.title}
                                fill
                                className="object-cover"
                              />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <span className="inline-block px-2 py-0.5 rounded bg-white/80 text-sm font-bold mb-2">
                              {letter}
                            </span>
                            <p className="font-medium truncate">{product?.title}</p>
                            <p className="text-sm mt-1">Score: {summary.score}</p>
                            {summary.highlights?.length > 0 && (
                              <ul className="mt-2 text-sm space-y-1">
                                {summary.highlights.slice(0, 2).map((h, i) => (
                                  <li key={i} className="flex items-start gap-1">
                                    <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                                    {h}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </motion.div>
            )}
          </>
        )}
      </motion.div>
    </div>
  )
}
