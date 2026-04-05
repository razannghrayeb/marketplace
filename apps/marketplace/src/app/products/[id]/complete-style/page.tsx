'use client'

import { useParams } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { ArrowLeft, Shirt, Sparkles, ChevronRight } from 'lucide-react'
import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'
import { useAuthStore } from '@/store/auth'
import type { Product } from '@/types/product'

interface CompleteLookSuggestion {
  id?: number
  product_id?: number
  title: string
  brand?: string
  category?: string
  price_cents?: number
  image_url?: string
  image_cdn?: string
  score?: number
  reason?: string
}

interface CategoryRec {
  category: string
  reason: string
  priority: number
  priorityLabel: string
  products: Array<{
    id?: number
    product_id?: number
    title: string
    brand?: string
    price?: number
    price_cents?: number
    currency?: string
    image?: string
    matchScore?: number
    matchReasons?: string[]
  }>
}

interface CompleteStyleData {
  sourceProduct: {
    id: number
    title: string
    image_cdn?: string
    image_url?: string
    category?: string
    price_cents?: number
    currency?: string
  }
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

function suggestionProductId(s: CompleteLookSuggestion): number | null {
  const n = Number(s.id ?? s.product_id)
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : null
}

function priceCentsFromSuggestion(s: CompleteLookSuggestion): number {
  const c = s.price_cents
  if (typeof c === 'number' && Number.isFinite(c)) return Math.round(c)
  return 0
}

function parseProductPayload(res: { success?: boolean; data?: unknown; error?: { message?: string } }): Product {
  if (res.success === false) {
    throw new Error(res.error?.message ?? 'Failed to load product')
  }
  let raw: unknown = res.data
  if (raw && typeof raw === 'object' && 'data' in raw && !('id' in (raw as object))) {
    raw = (raw as { data: unknown }).data
  }
  if (!raw || typeof raw !== 'object' || !('id' in raw)) {
    throw new Error('Product not found')
  }
  const p = raw as Record<string, unknown>
  const pid = typeof p.id === 'number' ? p.id : Number(p.id)
  if (!Number.isFinite(pid)) {
    throw new Error('Invalid product')
  }
  return {
    ...p,
    id: pid,
    title: String(p.title ?? p.name ?? ''),
    price_cents: Number(p.price_cents) || 0,
    sales_price_cents: p.sales_price_cents != null ? Number(p.sales_price_cents) : null,
    currency: (p.currency as string) || 'USD',
    image_url: (p.image_url as string) ?? null,
    image_cdn: (p.image_cdn as string) ?? null,
    brand: (p.brand as string) ?? null,
    category: (p.category as string) ?? null,
    description: (p.description as string) ?? null,
    color: (p.color as string) ?? null,
    size: (p.size as string) ?? null,
  } as Product
}

export default function CompleteStylePage() {
  const params = useParams()
  const id = params.id as string
  const productId = parseInt(id, 10)
  const isAuth = useAuthStore((s) => s.isAuthenticated())

  const { data: anchorProduct } = useQuery({
    queryKey: ['product', id],
    queryFn: async () => {
      const res = await api.get<unknown>(endpoints.products.byId(id))
      return parseProductPayload(res as { success?: boolean; data?: unknown; error?: { message?: string } })
    },
    enabled: !!id && Number.isFinite(productId) && productId >= 1 && isAuth,
    retry: false,
  })

  const wardrobeQuery = useQuery({
    queryKey: ['complete-style', 'wardrobe-product', id],
    queryFn: async () => {
      const res = await api.get<CompleteStyleData>(endpoints.products.completeStyle(id), {
        maxPerCategory: 6,
        maxTotal: 24,
      })
      if (res.success === false) {
        throw new Error(res.error?.message ?? 'Could not load outfit suggestions')
      }
      const d = res.data
      if (!d) throw new Error('No outfit data returned')
      return d
    },
    enabled: !!id && Number.isFinite(productId) && productId >= 1 && isAuth,
  })

  const fallbackQuery = useQuery({
    queryKey: ['complete-style', 'catalog', id],
    queryFn: async () => {
      const res = await api.get<CompleteStyleData>(endpoints.products.completeStyle(id), {
        maxPerCategory: 6,
        maxTotal: 24,
      })
      if (res.success === false) {
        throw new Error(res.error?.message ?? 'Could not load outfit suggestions')
      }
      const d = res.data
      if (!d) throw new Error('No outfit data returned')
      return d
    },
    enabled: !!id && Number.isFinite(productId) && productId >= 1 && !isAuth,
  })

  const data = isAuth ? wardrobeQuery.data : fallbackQuery.data
  const isLoading = isAuth ? wardrobeQuery.isLoading : fallbackQuery.isLoading
  const isError = isAuth ? wardrobeQuery.isError : fallbackQuery.isError
  const error = isAuth ? wardrobeQuery.error : fallbackQuery.error

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

  function resolveNumericId(p: { id?: number; product_id?: number }): number | null {
    const n = Number(p.id ?? p.product_id)
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : null
  }

  function toProductCard(p: CategoryRec['products'][0]) {
    const pid = resolveNumericId(p) ?? 0
    const cents = typeof p.price === 'number' && Number.isFinite(p.price) ? p.price : p.price_cents
    const price_cents = typeof cents === 'number' && Number.isFinite(cents) ? Math.round(cents) : 0
    return {
      id: pid,
      title: p.title,
      brand: p.brand,
      price_cents,
      currency: p.currency || 'USD',
      image_cdn: p.image,
      image_url: p.image,
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <Link
        href={`/products/${id}`}
        className="inline-flex items-center gap-2 text-neutral-600 hover:text-neutral-800 mb-8 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to product
      </Link>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="font-display text-3xl font-bold text-neutral-800 mb-2">Complete this look</h1>
        <p className="text-neutral-500 mb-2">
          Styling suggestions for <strong>{source.title}</strong>
          {data.detectedCategory && <span className="ml-2 text-sm">({data.detectedCategory})</span>}
        </p>
        <p className="text-sm text-neutral-400 mb-8">Sign in for wardrobe-aligned recommendations on every product.</p>

        <div className="grid lg:grid-cols-4 gap-8">
          <div>
            <p className="text-sm font-medium text-neutral-500 mb-2">Your item</p>
            <div className="relative aspect-[3/4] rounded-2xl overflow-hidden bg-neutral-100">
              <Image src={imgUrl} alt={source.title} fill className="object-cover" sizes="(max-width: 1024px) 100vw, 25vw" />
            </div>
            <p className="mt-2 font-medium text-neutral-800">{source.title}</p>
            {typeof source.price_cents === 'number' && source.price_cents > 0 && (
              <p className="mt-1 text-sm font-semibold text-violet-700">
                {formatPrice(source.price_cents, source.currency || 'USD')}
              </p>
            )}
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
                  <span className="text-xs px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-600">{rec.priorityLabel}</span>
                </div>
                <p className="text-sm text-neutral-500 mb-4">{rec.reason}</p>
                <motion.div
                  initial="hidden"
                  animate="visible"
                  variants={{ visible: { transition: { staggerChildren: 0.06 } }, hidden: {} }}
                  className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4"
                >
                  {rec.products
                    .filter((p) => resolveNumericId(p) != null)
                    .map((p, i) => {
                      const card = toProductCard(p)
                      const href = `/products/${card.id}`
                      const shot = card.image_cdn || card.image_url || ''
                      return (
                        <motion.div
                          key={card.id}
                          variants={{ hidden: { opacity: 0, y: 12 }, visible: { opacity: 1, y: 0 } }}
                        >
                          <Link
                            href={href}
                            className="group block rounded-2xl border border-neutral-200/60 bg-white overflow-hidden hover:shadow-lg hover:shadow-violet-500/10 hover:-translate-y-0.5 transition-all duration-300"
                          >
                            <div className="relative aspect-[3/4] bg-neutral-100 overflow-hidden">
                              {shot && (
                                <Image src={shot} alt={card.title} fill className="object-cover group-hover:scale-105 transition-transform duration-500" sizes="200px" />
                              )}
                            </div>
                            <div className="p-3">
                              {card.brand && <p className="text-[10px] font-semibold text-violet-600 uppercase tracking-wider truncate">{card.brand}</p>}
                              <p className="text-sm font-semibold text-neutral-900 line-clamp-2 mt-0.5">{card.title}</p>
                              {card.price_cents > 0 && (
                                <p className="text-sm font-bold text-violet-700 tabular-nums mt-1.5">{formatPrice(card.price_cents, card.currency)}</p>
                              )}
                            </div>
                          </Link>
                        </motion.div>
                      )
                    })}
                </motion.div>
              </section>
            ))}
          </div>
        </div>
      </motion.div>
    </div>
  )
}
