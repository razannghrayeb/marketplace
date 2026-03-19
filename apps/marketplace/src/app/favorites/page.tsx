'use client'

import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Heart } from 'lucide-react'
import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'
import { ProductCard } from '@/components/product/ProductCard'
import { useAuthStore } from '@/store/auth'
import type { Product } from '@/types/product'

export default function FavoritesPage() {
  const isAuth = useAuthStore((s) => s.isAuthenticated())

  const { data, isLoading } = useQuery({
    queryKey: ['favorites'],
    queryFn: async () => {
      const res = await api.get(endpoints.favorites.list)
      return res as { success: boolean; items?: Array<{ product_id: number; title: string; brand: string | null; price_cents: number; sales_price_cents: number | null; currency: string; image_url: string | null; image_cdn: string | null }> }
    },
    enabled: isAuth,
  })

  if (!isAuth) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center">
        <Heart className="w-16 h-16 text-charcoal-300 mx-auto mb-4" />
        <h2 className="font-display text-2xl font-bold text-charcoal-800 mb-2">Sign in to view favorites</h2>
        <p className="text-charcoal-500 mb-6">Save your favorite items when you're signed in.</p>
        <a href="/login" className="btn-primary">
          Sign in
        </a>
      </div>
    )
  }

  const rawItems = data?.items ?? []
  const products: Product[] = rawItems.map(({ product_id, ...rest }) => ({ ...rest, id: product_id }))
  const isEmpty = products.length === 0

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <motion.h1
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="font-display text-3xl font-bold text-charcoal-800 mb-8"
      >
        Favorites
      </motion.h1>

      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="aspect-[3/4] rounded-2xl bg-cream-200 animate-pulse" />
          ))}
        </div>
      ) : isEmpty ? (
        <div className="text-center py-20 bg-cream-100 rounded-2xl border border-cream-300">
          <Heart className="w-16 h-16 text-charcoal-300 mx-auto mb-4" />
          <p className="text-charcoal-600 mb-6">No favorites yet</p>
          <p className="text-sm text-charcoal-500">Click the heart on any product to save it here.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
          {products.map((product, i) => (
            <ProductCard key={product.id} product={product} index={i} isFavorite />
          ))}
        </div>
      )}
    </div>
  )
}
