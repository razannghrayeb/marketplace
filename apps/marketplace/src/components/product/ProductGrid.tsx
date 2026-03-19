'use client'

import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'
import { ProductCard } from './ProductCard'
import type { Product } from '@/types/product'

interface ProductGridProps {
  limit?: number
  category?: string
}

export function ProductGrid({ limit = 12, category }: ProductGridProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['products', limit, category],
    queryFn: async () => {
      const res = await api.get<Product[]>(endpoints.products.list, {
        limit,
        page: 1,
        ...(category && { category }),
      })
      return res
    },
  })

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
        {Array.from({ length: limit }).map((_, i) => (
          <div key={i} className="aspect-[3/4] rounded-2xl bg-cream-200 animate-pulse" />
        ))}
      </div>
    )
  }

  if (error || !data?.success) {
    return (
      <div className="text-center py-16 text-charcoal-500">
        <p>Unable to load products. The API may be starting up.</p>
        <p className="text-sm mt-2">Set NEXT_PUBLIC_API_URL to your backend API URL.</p>
      </div>
    )
  }

  const products = Array.isArray(data?.data) ? data.data : []

  if (products.length === 0) {
    return (
      <div className="text-center py-16 text-charcoal-500">
        No products found. Add products to your catalog to see them here.
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
      {products.map((product, i) => (
        <ProductCard key={product.id} product={product} index={i} />
      ))}
    </div>
  )
}
