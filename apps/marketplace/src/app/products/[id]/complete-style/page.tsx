'use client'

import { useParams } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { ArrowLeft, Shirt } from 'lucide-react'
import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'
import { ProductCard } from '@/components/product/ProductCard'

interface CompleteStyleProduct {
  id: number
  title: string
  brand?: string
  price: number
  currency: string
  image?: string
  matchScore?: number
  matchReasons?: string[]
}

interface CategoryRec {
  category: string
  reason: string
  priority: number
  priorityLabel: string
  products: CompleteStyleProduct[]
}

interface CompleteStyleData {
  sourceProduct: { id: number; title: string; image_cdn?: string; image_url?: string; category?: string }
  detectedCategory: string
  style?: { occasion?: string; aesthetic?: string; season?: string; formality?: number }
  outfitSuggestion?: string
  recommendations: CategoryRec[]
  totalRecommendations: number
}

function formatPrice(cents: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
  }).format(cents / 100)
}

function toProduct(p: CompleteStyleProduct) {
  return {
    id: p.id,
    title: p.title,
    brand: p.brand,
    price_cents: p.price,
    currency: p.currency || 'USD',
    image_cdn: p.image,
    image_url: p.image,
  }
}

export default function CompleteStylePage() {
  const params = useParams()
  const id = params.id as string

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['complete-style', id],
    queryFn: async () => {
      const res = await api.get<{ success?: boolean; data?: CompleteStyleData }>(
        endpoints.products.completeStyle(id),
        { maxPerCategory: 6, maxTotal: 24 }
      )
      const d = (res as { data?: CompleteStyleData })?.data
      if (!d) throw new Error('No data')
      return d
    },
    enabled: !!id,
  })

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-10">
        <div className="h-8 w-48 bg-neutral-100 rounded animate-pulse mb-8" />
        <div className="grid lg:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="aspect-[3/4] rounded-2xl bg-neutral-100 animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center">
        <p className="text-neutral-800 mb-4">{(error as Error)?.message ?? 'Failed to load outfit suggestions'}</p>
        <Link href={`/products/${id}`} className="btn-primary">
          Back to product
        </Link>
      </div>
    )
  }

  const source = data.sourceProduct
  const imgUrl = source.image_cdn || source.image_url || 'https://placehold.co/600x800/f5ede4/1a1a1a?text=No+Image'

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <Link
        href={`/products/${id}`}
        className="inline-flex items-center gap-2 text-neutral-600 hover:text-neutral-800 mb-8 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to product
      </Link>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h1 className="font-display text-3xl font-bold text-neutral-800 mb-2">Complete this look</h1>
        <p className="text-neutral-500 mb-8">
          Styling suggestions for <strong>{source.title}</strong>
          {data.detectedCategory && (
            <span className="ml-2 text-sm">({data.detectedCategory})</span>
          )}
        </p>

        <div className="grid lg:grid-cols-4 gap-8">
          <div>
            <p className="text-sm font-medium text-neutral-500 mb-2">Your item</p>
            <div className="relative aspect-[3/4] rounded-2xl overflow-hidden bg-neutral-100">
              <Image
                src={imgUrl}
                alt={source.title}
                fill
                className="object-cover"
                sizes="(max-width: 1024px) 100vw, 25vw"
              />
            </div>
            <p className="mt-2 font-medium text-neutral-800">{source.title}</p>
          </div>

          <div className="lg:col-span-3 space-y-10">
            {data.outfitSuggestion && (
              <div className="p-4 rounded-xl bg-violet-50 border border-violet-200">
                <p className="text-neutral-700">{data.outfitSuggestion}</p>
              </div>
            )}

            {data.recommendations.map((rec, idx) => (
              <section key={idx}>
                <div className="flex items-center gap-2 mb-4">
                  <Shirt className="w-5 h-5 text-violet-600" />
                  <h2 className="font-display text-xl font-bold text-neutral-800">{rec.category}</h2>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-600">
                    {rec.priorityLabel}
                  </span>
                </div>
                <p className="text-sm text-neutral-500 mb-4">{rec.reason}</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                  {rec.products.map((p, i) => (
                    <ProductCard key={p.id} product={toProduct(p)} index={i} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </motion.div>
    </div>
  )
}
