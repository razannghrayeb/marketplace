'use client'

import { useState, useMemo, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import Link from 'next/link'
import { Search } from 'lucide-react'
import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'
import { ProductCard } from '@/components/product/ProductCard'
import type { Product } from '@/types/product'

type FacetData = { categories?: Array<{ value: string; count: number }>; brands?: Array<{ value: string; count: number }> }

export default function DashboardProductsPage() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [category, setCategory] = useState('')
  const [brand, setBrand] = useState('')
  const limit = 24

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1) }, 300)
    return () => clearTimeout(t)
  }, [search])

  const { data: facetsRes } = useQuery({
    queryKey: ['dashboard-facets'],
    queryFn: () => api.get<FacetData>(endpoints.products.facets),
  })
  const facets = (facetsRes?.data ?? {}) as FacetData
  const categories = facets.categories ?? []
  const brands = facets.brands ?? []

  const params = useMemo(() => {
    const p: Record<string, string | number> = { page, limit }
    if (category) p.category = category
    if (brand) p.brand = brand
    return p
  }, [page, limit, category, brand])

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-products', debouncedSearch, category, brand, page],
    queryFn: async () => {
      if (debouncedSearch.trim()) {
        const res = await api.get<Product[]>(endpoints.products.search, { q: debouncedSearch.trim(), ...params })
        return res
      }
      return api.get<Product[]>(endpoints.products.list, params)
    },
  })

  const products: Product[] = Array.isArray(data?.data) ? data.data : []
  const hasFilters = !!search || !!category || !!brand
  const apiTotal = data?.meta?.total_results ?? data?.meta?.total ?? 0
  const catalogTotal = facets.categories?.reduce((acc, c) => acc + c.count, 0) ?? 0
  const total = apiTotal > 0 ? apiTotal : (!hasFilters ? catalogTotal : 0)
  const totalPages = total > 0 ? Math.ceil(total / limit) : (products.length >= limit ? page + 1 : page)

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h1 className="font-display text-3xl font-bold text-charcoal-800 mb-2">
          Products
        </h1>
        <p className="text-charcoal-500 mb-6">
          {total > 0 ? `${total} products in catalog` : 'Manage your product catalog'}
        </p>

        <div className="flex flex-col sm:flex-row gap-4 mb-8">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-charcoal-400" />
            <input
              type="text"
              placeholder="Search products..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-cream-300 bg-white focus:outline-none focus:ring-2 focus:ring-wine-500/30 focus:border-wine-500"
            />
          </div>
          <select
            value={category}
            onChange={(e) => { setCategory(e.target.value); setPage(1) }}
            className="px-4 py-2.5 rounded-xl border border-cream-300 bg-white focus:outline-none focus:ring-2 focus:ring-wine-500/30"
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.value} value={c.value}>{c.value} ({c.count})</option>
            ))}
          </select>
          <select
            value={brand}
            onChange={(e) => { setBrand(e.target.value); setPage(1) }}
            className="px-4 py-2.5 rounded-xl border border-cream-300 bg-white focus:outline-none focus:ring-2 focus:ring-wine-500/30"
          >
            <option value="">All brands</option>
            {brands.map((b) => (
              <option key={b.value} value={b.value}>{b.value} ({b.count})</option>
            ))}
          </select>
          {hasFilters && (
            <button
              onClick={() => { setSearch(''); setCategory(''); setBrand(''); setPage(1) }}
              className="btn-secondary py-2.5"
            >
              Clear filters
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="aspect-[3/4] rounded-2xl bg-cream-200 animate-pulse" />
            ))}
          </div>
        ) : products.length > 0 ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
              {products.map((product, i) => (
                <div key={product.id}>
                  <ProductCard product={product} index={i} />
                  <Link
                    href={`/products/${product.id}`}
                    className="mt-2 block text-center text-sm text-wine-700 hover:underline"
                  >
                    View details
                  </Link>
                </div>
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
          <div className="text-center py-20 bg-cream-100 rounded-2xl border border-cream-300">
            <p className="text-charcoal-600 mb-4">
              {hasFilters ? 'No products match your filters.' : 'No products in catalog yet.'}
            </p>
            <p className="text-sm text-charcoal-500">
              {hasFilters ? 'Try adjusting your search or filters.' : 'Products will appear here once the catalog is populated.'}
            </p>
            {hasFilters && (
              <button
                onClick={() => { setSearch(''); setCategory(''); setBrand(''); setPage(1) }}
                className="mt-4 btn-secondary"
              >
                Clear filters
              </button>
            )}
          </div>
        )}
      </motion.div>
    </div>
  )
}
