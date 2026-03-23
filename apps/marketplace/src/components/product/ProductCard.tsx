'use client'

import Image from 'next/image'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { Heart, GitCompare, Check } from 'lucide-react'
import type { Product } from '@/types/product'

interface ProductCardProps {
  product: Product
  index?: number
  onFavorite?: (productId: number) => void
  isFavorite?: boolean
  onAddToCompare?: (productId: number) => void
  inCompare?: boolean
  variantPrice?: { minPriceCents: number; maxPriceCents: number }
}

function toCents(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v === 'string') { const n = parseInt(v, 10); if (Number.isFinite(n)) return n }
  return 0
}

function formatPrice(cents: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
  }).format(cents / 100)
}

export function ProductCard({ product, index = 0, onFavorite, isFavorite, onAddToCompare, inCompare, variantPrice }: ProductCardProps) {
  const imgUrl = product.image_cdn || product.image_url || '/placeholder-product.jpg'
  const priceCents = toCents(product.price_cents)
  const saleCents = toCents(product.sales_price_cents)
  const hasSale = saleCents > 0 && saleCents < priceCents
  const showMinMax = variantPrice && variantPrice.minPriceCents !== variantPrice.maxPriceCents

  return (
    <motion.article
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-24px' }}
      transition={{ duration: 0.4, delay: index * 0.04, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -6 }}
      className="group"
    >
      <Link href={`/products/${product.id}`} className="block">
        <div className="relative aspect-[3/4] overflow-hidden rounded-2xl bg-gradient-to-br from-neutral-100 to-neutral-150 ring-1 ring-neutral-200/90 shadow-sm transition-all duration-300 group-hover:ring-violet-300/60 group-hover:shadow-xl group-hover:shadow-violet-500/10">
          <Image
            src={imgUrl}
            alt={product.title}
            fill
            className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04]"
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            onError={(e) => {
              e.currentTarget.src = 'https://placehold.co/400x533/f5f5f5/737373?text=No+Image'
            }}
          />
          {hasSale && (
            <span className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-gradient-to-r from-rose-600 to-fuchsia-600 text-white text-[11px] font-bold uppercase tracking-wide shadow-md shadow-rose-500/25">
              Sale
            </span>
          )}

          {/* Favorite button — top right */}
          {onFavorite && (
            <button
              onClick={(e) => {
                e.preventDefault()
                onFavorite(product.id)
              }}
              className="absolute top-3 right-3 p-2 rounded-full bg-white/95 backdrop-blur-md border border-neutral-200/90 shadow-sm hover:bg-white hover:scale-105 hover:border-rose-200 transition-all duration-200"
              aria-label="Add to favorites"
            >
              <Heart
                className={`w-4 h-4 ${isFavorite ? 'fill-rose-500 text-rose-500' : 'text-neutral-500'}`}
              />
            </button>
          )}

          {/* Compare button — always visible when added, slides up on hover otherwise */}
          {onAddToCompare && (
            <div className={`absolute bottom-0 inset-x-0 transition-transform duration-300 ease-out ${
              inCompare ? 'translate-y-0' : 'translate-y-full group-hover:translate-y-0'
            }`}>
              <button
                onClick={(e) => {
                  e.preventDefault()
                  onAddToCompare(product.id)
                }}
                className={`w-full flex items-center justify-center gap-2 py-2.5 text-xs font-bold uppercase tracking-wide backdrop-blur-md transition-colors
                  ${inCompare
                    ? 'bg-violet-600/95 text-white'
                    : 'bg-white/90 text-violet-800 hover:bg-violet-100/95'
                  }`}
              >
                {inCompare ? (
                  <motion.span
                    key="added"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="flex items-center gap-1.5"
                  >
                    <span className="flex items-center justify-center w-4 h-4 rounded-full bg-white/25">
                      <Check className="w-3 h-3" strokeWidth={3} />
                    </span>
                    Added to compare
                  </motion.span>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <GitCompare className="w-3.5 h-3.5" />
                    Compare
                  </span>
                )}
              </button>
            </div>
          )}
        </div>
        <div className="mt-3.5 px-0.5">
          <p className="text-[0.65rem] font-semibold text-violet-600/90 uppercase tracking-[0.15em]">
            {product.brand || product.category}
          </p>
          <h3 className="font-medium text-neutral-900 line-clamp-2 mt-1 text-sm leading-snug group-hover:text-violet-900 transition-colors duration-200">
            {product.title}
          </h3>
          <div className="mt-1.5 flex items-center gap-2">
            {showMinMax ? (
              <span className="font-semibold text-sm text-neutral-900">
                {formatPrice(variantPrice!.minPriceCents, product.currency)} – {formatPrice(variantPrice!.maxPriceCents, product.currency)}
              </span>
            ) : hasSale ? (
              <>
                <span className="text-violet-900 font-semibold text-sm">
                  {formatPrice(saleCents, product.currency)}
                </span>
                <span className="text-xs text-neutral-400 line-through">
                  {formatPrice(priceCents, product.currency)}
                </span>
              </>
            ) : priceCents > 0 ? (
              <span className="font-semibold text-sm text-neutral-900">
                {formatPrice(priceCents, product.currency)}
              </span>
            ) : (
              <span className="text-sm text-neutral-400 italic">Price unavailable</span>
            )}
          </div>
        </div>
      </Link>
    </motion.article>
  )
}
