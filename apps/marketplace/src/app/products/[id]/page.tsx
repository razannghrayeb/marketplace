'use client'

import { useParams } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Heart, Shirt, ArrowLeft } from 'lucide-react'
import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'
import type { Product } from '@/types/product'

function formatPrice(cents: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
  }).format(cents / 100)
}

export default function ProductDetailPage() {
  const params = useParams()
  const id = params.id as string

  const { data, isLoading } = useQuery({
    queryKey: ['product', id],
    queryFn: async () => {
      const res = await api.get<Product | { data: Product }>(endpoints.products.byId(id))
      if (res.data && typeof res.data === 'object' && 'id' in res.data) {
        return res.data as Product
      }
      return (res.data as { data?: Product })?.data ?? null
    },
    enabled: !!id,
  })

  if (isLoading || !data) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-10">
        <div className="grid lg:grid-cols-2 gap-12">
          <div className="aspect-[3/4] rounded-2xl bg-cream-200 animate-pulse" />
          <div className="space-y-4">
            <div className="h-8 bg-cream-200 rounded animate-pulse w-3/4" />
            <div className="h-4 bg-cream-200 rounded animate-pulse w-1/2" />
            <div className="h-12 bg-cream-200 rounded animate-pulse w-1/4" />
          </div>
        </div>
      </div>
    )
  }

  const product = data as Product
  const imgUrl = product.image_cdn || product.image_url || 'https://placehold.co/600x800/f5ede4/1a1a1a?text=No+Image'
  const hasSale = product.sales_price_cents && product.sales_price_cents < product.price_cents

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <Link
        href="/products"
        className="inline-flex items-center gap-2 text-charcoal-600 hover:text-wine-700 mb-8 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to products
      </Link>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="grid lg:grid-cols-2 gap-12"
      >
        <div className="relative aspect-[3/4] rounded-2xl overflow-hidden bg-cream-200">
          <Image
            src={imgUrl}
            alt={product.title}
            fill
            className="object-cover"
            sizes="(max-width: 1024px) 100vw, 50vw"
            priority
          />
          {hasSale && (
            <span className="absolute top-4 left-4 px-3 py-1 rounded-full bg-wine-600 text-white text-sm font-medium">
              Sale
            </span>
          )}
        </div>

        <div>
          <p className="text-sm text-charcoal-400 uppercase tracking-wider">{product.brand || product.category}</p>
          <h1 className="font-display text-3xl font-bold text-charcoal-800 mt-2">{product.title}</h1>
          {product.color && (
            <p className="text-charcoal-600 mt-2">Color: {product.color}</p>
          )}
          {product.size && (
            <p className="text-charcoal-600">Size: {product.size}</p>
          )}

          <div className="mt-6 flex items-center gap-4">
            {hasSale ? (
              <>
                <span className="text-2xl font-bold text-wine-600">
                  {formatPrice(product.sales_price_cents!, product.currency)}
                </span>
                <span className="text-lg text-charcoal-400 line-through">
                  {formatPrice(product.price_cents, product.currency)}
                </span>
              </>
            ) : (
              <span className="text-2xl font-bold text-charcoal-800">
                {formatPrice(product.price_cents, product.currency)}
              </span>
            )}
          </div>

          {product.description && (
            <p className="mt-6 text-charcoal-600 leading-relaxed">{product.description}</p>
          )}

          <div className="mt-10 flex flex-wrap gap-4">
            <button className="btn-secondary flex items-center gap-2">
              <Heart className="w-5 h-5" />
              Save
            </button>
          </div>

          <div className="mt-12 pt-8 border-t border-cream-300">
            <Link
              href={`/products/${product.id}/complete-style`}
              className="inline-flex items-center gap-2 text-wine-700 font-medium hover:underline"
            >
              <Shirt className="w-4 h-4" />
              Complete this look
            </Link>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
