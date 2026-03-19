'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'
import { ProductCard } from '@/components/product/ProductCard'
import { useCompareStore } from '@/store/compare'
import type { Product } from '@/types/product'

function ProductsContent() {
  const searchParams = useSearchParams()
  const category = searchParams.get('category') || ''
  const [page, setPage] = useState(1)
  const limit = 24
  const addToCompare = useCompareStore((s) => s.add)
  const inCompare = useCompareStore((s) => s.has)

  const { data, isLoading } = useQuery({
    queryKey: ['products', page, category],
    queryFn: () =>
      api.get<Product[]>(endpoints.products.list, {
        page,
        limit,
        ...(category && { category }),
      }),
  })

  const products: Product[] = Array.isArray(data?.data) ? data.data : []
  const totalPages = data?.meta?.pages ?? (products.length >= limit ? page + 1 : page)

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h1 className="font-display text-3xl font-bold text-charcoal-800 mb-2">
          {category ? `${category.charAt(0).toUpperCase() + category.slice(1)}` : 'All Products'}
        </h1>
        <p className="text-charcoal-500 mb-8">
          {data?.meta?.total ? `${data.meta.total} products` : 'Browse our collection'}
        </p>

        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="aspect-[3/4] rounded-2xl bg-cream-200 animate-pulse" />
            ))}
          </div>
        ) : products.length > 0 ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
              {products.map((product, i) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  index={i}
                  onAddToCompare={addToCompare}
                  inCompare={inCompare(product.id)}
                />
              ))}
            </div>
            {totalPages > 1 && (
              <div className="flex justify-center gap-2 mt-12">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="btn-secondary py-2 px-4 disabled:opacity-50"
                >
                  Previous
                </button>
                <span className="flex items-center px-4 text-charcoal-600">
                  Page {page} of {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="btn-secondary py-2 px-4 disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-20 text-charcoal-500">
            No products found. Try a different category.
          </div>
        )}
      </motion.div>
    </div>
  )
}

export default function ProductsPage() {
  return (
    <Suspense fallback={<div className="min-h-[60vh] flex items-center justify-center">Loading...</div>}>
      <ProductsContent />
    </Suspense>
  )
}
