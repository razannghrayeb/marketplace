'use client'

import Image from 'next/image'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { Heart, GitCompare } from 'lucide-react'
import type { Product } from '@/types/product'

interface ProductCardProps {
  product: Product
  index?: number
  onFavorite?: (productId: number) => void
  isFavorite?: boolean
  onAddToCompare?: (productId: number) => void
  inCompare?: boolean
}

function formatPrice(cents: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
  }).format(cents / 100)
}

export function ProductCard({ product, index = 0, onFavorite, isFavorite, onAddToCompare, inCompare }: ProductCardProps) {
  const imgUrl = product.image_cdn || product.image_url || '/placeholder-product.jpg'
  const hasSale = product.sales_price_cents && product.sales_price_cents < product.price_cents

  return (
    <motion.article
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.05 }}
      whileHover={{ y: -4 }}
      className="group"
    >
      <Link href={`/products/${product.id}`} className="block">
        <div className="relative aspect-[3/4] overflow-hidden rounded-2xl bg-cream-200 card-hover">
          <Image
            src={imgUrl}
            alt={product.title}
            fill
            className="object-cover transition-transform duration-500 group-hover:scale-105"
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            onError={(e) => {
              e.currentTarget.src = 'https://placehold.co/400x533/f5ede4/1a1a1a?text=No+Image'
            }}
          />
          {hasSale && (
            <span className="absolute top-3 left-3 px-2 py-0.5 rounded-full bg-wine-600 text-white text-xs font-medium">
              Sale
            </span>
          )}
          <div className="absolute top-3 right-3 flex gap-1">
            {onAddToCompare && (
              <button
                onClick={(e) => {
                  e.preventDefault()
                  onAddToCompare(product.id)
                }}
                className={`p-2 rounded-full bg-white/90 backdrop-blur hover:bg-white transition-colors ${inCompare ? 'ring-2 ring-wine-600' : ''}`}
                aria-label="Add to compare"
                title={inCompare ? 'In compare list' : 'Add to compare'}
              >
                <GitCompare className={`w-4 h-4 ${inCompare ? 'text-wine-600' : 'text-charcoal-500'}`} />
              </button>
            )}
            {onFavorite && (
              <button
                onClick={(e) => {
                  e.preventDefault()
                  onFavorite(product.id)
                }}
                className="p-2 rounded-full bg-white/90 backdrop-blur hover:bg-white transition-colors"
                aria-label="Add to favorites"
              >
                <Heart
                  className={`w-4 h-4 ${isFavorite ? 'fill-wine-600 text-wine-600' : 'text-charcoal-500'}`}
                />
              </button>
            )}
          </div>
        </div>
        <div className="mt-3">
          <p className="text-xs text-charcoal-400 uppercase tracking-wider">{product.brand || product.category}</p>
          <h3 className="font-medium text-charcoal-700 line-clamp-2 mt-0.5 group-hover:text-wine-700 transition-colors">
            {product.title}
          </h3>
          <div className="mt-1 flex items-center gap-2">
            {hasSale ? (
              <>
                <span className="text-wine-600 font-semibold">
                  {formatPrice(product.sales_price_cents!, product.currency)}
                </span>
                <span className="text-sm text-charcoal-400 line-through">
                  {formatPrice(product.price_cents, product.currency)}
                </span>
              </>
            ) : (
              <span className="font-semibold text-charcoal-700">
                {formatPrice(product.price_cents, product.currency)}
              </span>
            )}
          </div>
        </div>
      </Link>
    </motion.article>
  )
}
