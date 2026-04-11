'use client'

import { Suspense } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Heart, Shirt, ArrowLeft, ShoppingBag } from 'lucide-react'
import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'
import { useAuthStore } from '@/store/auth'
import type { Product } from '@/types/product'

function formatPrice(cents: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
  }).format(cents / 100)
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

/** Only allow in-app return to Discover (avoid open redirects). */
function safeDiscoverReturn(raw: string | null): string | null {
  if (!raw) return null
  try {
    const decoded = decodeURIComponent(raw)
    if (!/^\/search(\?|$)/.test(decoded)) return null
    if (decoded.includes('..')) return null
    return decoded
  } catch {
    return null
  }
}

function ProductDetailContent() {
  const params = useParams()
  const searchParams = useSearchParams()
  const discoverBack = safeDiscoverReturn(searchParams.get('from'))
  const backHref = discoverBack ?? '/products'
  const backLabel = discoverBack ? 'Back to Discover' : 'Back to shop'

  const id = params.id as string
  const numericId = id ? Number(id) : NaN
  const qc = useQueryClient()
  const isAuth = useAuthStore((s) => s.isAuthenticated())

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['product', id],
    queryFn: async () => {
      const res = await api.get<unknown>(endpoints.products.byId(id))
      return parseProductPayload(res)
    },
    enabled: !!id && Number.isFinite(numericId),
    retry: false,
  })

  const { data: variantsData } = useQuery({
    queryKey: ['variants', id],
    queryFn: async () => {
      const res = await api.post<Record<string, { minPriceCents: number; maxPriceCents: number; variants: unknown[] }>>(
        endpoints.products.variantsBatch,
        { productIds: [numericId] }
      )
      if (res.success === false) return undefined
      return (res as { data?: Record<string, { minPriceCents: number; maxPriceCents: number; variants: unknown[] }> }).data
    },
    enabled: Number.isFinite(numericId) && !!data,
  })

  const { data: favorited } = useQuery({
    queryKey: ['fav-check', id],
    queryFn: async () => {
      const res = (await api.get<unknown>(endpoints.favorites.check(numericId))) as {
        success?: boolean
        favorited?: boolean
      }
      return Boolean(res.favorited)
    },
    enabled: isAuth && Number.isFinite(numericId),
  })

  const toggleFavorite = useMutation({
    mutationFn: () => api.post(endpoints.favorites.toggle, { product_id: numericId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['fav-check', id] })
      void qc.invalidateQueries({ queryKey: ['favorites'] })
    },
  })

  const addToCart = useMutation({
    mutationFn: () => api.post(endpoints.cart.root, { product_id: numericId, quantity: 1 }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['cart'] }),
  })

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-10">
        <div className="grid lg:grid-cols-2 gap-12">
          <div className="aspect-[3/4] rounded-2xl bg-neutral-100 animate-pulse" />
          <div className="space-y-4">
            <div className="h-8 bg-neutral-100 rounded animate-pulse w-3/4" />
            <div className="h-4 bg-neutral-100 rounded animate-pulse w-1/2" />
            <div className="h-12 bg-neutral-100 rounded animate-pulse w-1/4" />
          </div>
        </div>
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-10 text-center">
        <p className="text-neutral-800 font-medium mb-2">Could not load this product</p>
        <p className="text-neutral-600 text-sm mb-6">{(error as Error)?.message ?? 'It may have been removed or the link is invalid.'}</p>
        <Link href={backHref} className="text-neutral-800 font-medium hover:underline">
          ← {backLabel}
        </Link>
      </div>
    )
  }

  const product = data as Product & { images?: Array<{ url: string; is_primary?: boolean }> }
  const imgUrl =
    product.image_cdn ||
    product.image_url ||
    (product.images?.length ? product.images.find((i) => i.is_primary)?.url ?? product.images[0]?.url : null) ||
    'https://placehold.co/600x800/f5ede4/1a1a1a?text=No+Image'
  const hasSale = product.sales_price_cents && product.sales_price_cents < product.price_cents

  const variantInfo = variantsData?.[String(product.id)]
  const showMinMax = variantInfo && variantInfo.minPriceCents !== variantInfo.maxPriceCents

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <Link
        href={backHref}
        className="inline-flex items-center gap-2 text-neutral-600 hover:text-neutral-800 mb-8 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        {backLabel}
      </Link>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="grid lg:grid-cols-2 gap-12"
      >
        <div className="relative aspect-[3/4] rounded-2xl overflow-hidden bg-neutral-100">
          <Image
            src={imgUrl}
            alt={product.title}
            fill
            className="object-cover"
            sizes="(max-width: 1024px) 100vw, 50vw"
            priority
          />
          {hasSale && (
            <span className="absolute top-4 left-4 px-3 py-1 rounded-full bg-violet-600 text-white text-sm font-medium">
              Sale
            </span>
          )}
        </div>

        <div>
          <p className="text-sm text-neutral-400 uppercase tracking-wider">{product.brand || product.category}</p>
          <h1 className="font-display text-3xl font-bold text-neutral-800 mt-2">{product.title}</h1>
          {product.color && (
            <p className="text-neutral-600 mt-2">Color: {product.color}</p>
          )}
          {product.size && (
            <p className="text-neutral-600">Size: {product.size}</p>
          )}

          <div className="mt-6 flex items-center gap-4">
            {showMinMax ? (
              <span className="text-2xl font-bold text-neutral-800">
                {formatPrice(variantInfo!.minPriceCents, product.currency)} – {formatPrice(variantInfo!.maxPriceCents, product.currency)}
              </span>
            ) : hasSale ? (
              <>
                <span className="text-2xl font-bold text-violet-600">
                  {formatPrice(product.sales_price_cents!, product.currency)}
                </span>
                <span className="text-lg text-neutral-400 line-through">
                  {formatPrice(product.price_cents, product.currency)}
                </span>
              </>
            ) : (
              <span className="text-2xl font-bold text-neutral-800">
                {formatPrice(product.price_cents, product.currency)}
              </span>
            )}
          </div>

          {product.description && (
            <p className="mt-6 text-neutral-600 leading-relaxed">{product.description}</p>
          )}

          <div className="mt-10 flex flex-col gap-3">
            {!isAuth && (
              <p className="text-sm text-neutral-600">
                <Link href="/login" className="text-neutral-800 font-medium hover:underline">
                  Sign in
                </Link>{' '}
                to save items or add them to your bag.
              </p>
            )}
            <div className="flex flex-wrap gap-4">
              <button
                type="button"
                className="btn-primary flex items-center gap-2"
                disabled={!isAuth || addToCart.isPending}
                onClick={() => addToCart.mutate()}
              >
                <ShoppingBag className="w-5 h-5" />
                {addToCart.isPending ? 'Adding…' : 'Add to bag'}
              </button>
              <button
                type="button"
                className="btn-secondary flex items-center gap-2"
                disabled={!isAuth || toggleFavorite.isPending}
                onClick={() => toggleFavorite.mutate()}
              >
                <Heart
                  className={`w-5 h-5 ${favorited ? 'fill-violet-600 text-violet-600' : ''}`}
                />
                {favorited ? 'Saved' : 'Save'}
              </button>
              {isAuth && (
                <Link href="/cart" className="btn-secondary text-sm flex items-center">
                  View cart
                </Link>
              )}
            </div>
            {addToCart.isError && (
              <p className="text-sm text-neutral-800">Could not add to cart. Try again.</p>
            )}
            {addToCart.isSuccess && <p className="text-sm text-green-700">Added to your bag.</p>}
          </div>

          <div className="mt-12 pt-8 border-t border-neutral-200">
            <Link
              href={`/products/${product.id}/complete-style`}
              className="inline-flex items-center gap-2 text-neutral-800 font-medium hover:underline"
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

export default function ProductDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-7xl mx-auto px-4 py-10">
          <div className="h-4 w-40 bg-neutral-100 rounded animate-pulse mb-8" />
          <div className="grid lg:grid-cols-2 gap-12">
            <div className="aspect-[3/4] rounded-2xl bg-neutral-100 animate-pulse" />
            <div className="space-y-4">
              <div className="h-8 bg-neutral-100 rounded animate-pulse w-3/4" />
              <div className="h-4 bg-neutral-100 rounded animate-pulse w-1/2" />
              <div className="h-12 bg-neutral-100 rounded animate-pulse w-1/4" />
            </div>
          </div>
        </div>
      }
    >
      <ProductDetailContent />
    </Suspense>
  )
}
