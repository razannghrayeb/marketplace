'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Search, Image, Sparkles } from 'lucide-react'
import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'
import { ProductCard } from '@/components/product/ProductCard'
import { SearchBar } from '@/components/search/SearchBar'
import { useCompareStore } from '@/store/compare'
import type { Product } from '@/types/product'

function toProducts(results: unknown[]): Product[] {
  return results
    .filter((r): r is Record<string, unknown> => Boolean(r && typeof r === 'object' && ('id' in r || 'product_id' in r)))
    .map((r) => {
      const raw = r as { id?: number; product_id?: number; name?: string; title?: string; price?: number; price_cents?: number; imageUrl?: string; image_url?: string; image_cdn?: string; brand?: string; category?: string }
      const id = raw.id ?? raw.product_id ?? 0
      return {
        id,
        title: raw.title ?? raw.name ?? '',
        price_cents: raw.price_cents ?? (typeof raw.price === 'number' ? Math.round(raw.price * 100) : 0),
        image_url: raw.image_url ?? raw.imageUrl ?? raw.image_cdn ?? null,
        image_cdn: raw.image_cdn ?? null,
        brand: raw.brand ?? null,
        category: raw.category ?? null,
      } as Product
    })
}

function SearchContent() {
  const searchParams = useSearchParams()
  const q = searchParams.get('q') || ''
  const mode = searchParams.get('mode') || 'text'
  const [imageFile, setImageFile] = useState<File | null>(null)
  const addToCompare = useCompareStore((s) => s.add)
  const inCompare = useCompareStore((s) => s.has)

  const imageKey = imageFile ? `${imageFile.name}-${imageFile.size}-${imageFile.lastModified}` : ''
  const { data, isLoading, isFetching, isError, error } = useQuery({
    queryKey: ['search', q, mode, imageKey],
    queryFn: async () => {
      if (mode === 'shop' && imageFile) {
        const formData = new FormData()
        formData.append('image', imageFile)
        const res = await api.postForm(endpoints.images.search, formData)
        const raw = res as { success?: boolean; error?: { message?: string }; similarProducts?: { byDetection?: Array<{ detection?: { label?: string }; products?: unknown[] }> } }
        if (raw?.success === false) {
          throw new Error(raw?.error?.message ?? 'Shop the look failed')
        }
        const byDetection = raw?.similarProducts?.byDetection ?? []
        const results = byDetection.flatMap((d) => d.products ?? [])
        return { results, query: { shopTheLook: true }, byDetection }
      }
      if (mode === 'image' && imageFile) {
        const formData = new FormData()
        formData.append('image', imageFile)
        let res: unknown
        try {
          res = await api.postForm(endpoints.products.searchImage, formData)
        } catch {
          res = await api.postForm(endpoints.search.image, formData)
        }
        const raw = res as { success?: boolean; error?: { message?: string }; results?: unknown[]; data?: unknown[] }
        if (raw?.success === false) {
          throw new Error(raw?.error?.message ?? 'Image search failed')
        }
        const results = raw?.data ?? raw?.results ?? []
        return { results: Array.isArray(results) ? results : [], query: { original: 'Image search' } }
      }
      if (q.trim()) {
        let res = await api.get(endpoints.search.text, { q: q.trim(), limit: 24, page: 1 })
        if (res.success === false) {
          res = await api.get(endpoints.products.search, { q: q.trim(), limit: 24, page: 1 })
        }
        const resData = res as { success?: boolean; error?: { message?: string }; data?: { results?: Product[] }; results?: Product[] }
        if (resData?.success === false) {
          throw new Error(resData?.error?.message ?? 'Backend unavailable (502). Check Render dashboard.')
        }
        const results = resData?.data?.results || resData?.results || (Array.isArray(resData?.data) ? resData.data : [])
        return { results: Array.isArray(results) ? results : [], query: resData?.data }
      }
      return { results: [], query: null }
    },
    enabled: !!q.trim() || ((mode === 'image' || mode === 'shop') && !!imageFile),
  })

  const rawResults = data && (data as { results?: unknown[] }).results
  const products = toProducts(Array.isArray(rawResults) ? rawResults : [])

  const isLoadingState = isLoading || isFetching

  return (
    <>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-10"
        >
          <h1 className="font-display text-3xl font-bold text-charcoal-800 mb-6">Discover</h1>
          <SearchBar placeholder="Search by text: red dress, casual sneakers..." />

          <div className="flex gap-2 mt-6">
            <a
              href="/search"
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                mode !== 'image' && mode !== 'shop'
                  ? 'bg-wine-700 text-white'
                  : 'bg-cream-200 text-charcoal-600 hover:bg-cream-300'
              }`}
            >
              <Search className="w-4 h-4" />
              Text
            </a>
            <a
              href="/search?mode=image"
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                mode === 'image' ? 'bg-wine-700 text-white' : 'bg-cream-200 text-charcoal-600 hover:bg-cream-300'
              }`}
            >
              <Image className="w-4 h-4" />
              Image
            </a>
            <a
              href="/search?mode=shop"
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                mode === 'shop' ? 'bg-wine-700 text-white' : 'bg-cream-200 text-charcoal-600 hover:bg-cream-300'
              }`}
            >
              <Sparkles className="w-4 h-4" />
              Shop the look
            </a>
          </div>

          {(mode === 'image' || mode === 'shop') && (
            <div className="mt-6 p-6 rounded-2xl bg-cream-100 border border-cream-300 border-dashed">
              <label className="block text-sm font-medium text-charcoal-700 mb-2">
                {mode === 'shop'
                  ? 'Upload outfit photo — AI detects items and finds similar products'
                  : 'Upload image to find similar'}
              </label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setImageFile(e.target.files?.[0] || null)}
                className="block w-full text-sm text-charcoal-600 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:bg-wine-100 file:text-wine-700 file:font-medium hover:file:bg-wine-200"
              />
              {imageFile && <p className="mt-2 text-sm text-charcoal-500">Selected: {imageFile.name}</p>}
            </div>
          )}
        </motion.div>

        <div className="min-h-[200px]">
          {isLoadingState ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="aspect-[3/4] rounded-2xl bg-cream-200 animate-pulse" />
              ))}
            </div>
          ) : products.length > 0 ? (
            <motion.div
              initial="hidden"
              animate="visible"
              variants={{
                visible: { transition: { staggerChildren: 0.05 } },
                hidden: {},
              }}
              className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6"
            >
              {products.map((product, i) => (
                <motion.div
                  key={product.id}
                  variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }}
                >
                  <ProductCard
                    product={product}
                    index={i}
                    onAddToCompare={addToCompare}
                    inCompare={inCompare(product.id)}
                  />
                </motion.div>
              ))}
            </motion.div>
          ) : isError ? (
            <div className="text-center py-20 text-wine-600 bg-wine-50 rounded-2xl border border-wine-200 max-w-lg mx-auto">
              <p className="font-medium mb-2">Backend unavailable (502 Bad Gateway)</p>
              <p className="text-sm text-charcoal-600 mb-3">{(error as Error)?.message ?? 'The Render backend is down or not responding.'}</p>
              <p className="text-xs text-charcoal-500 mb-4">Check your Render dashboard: ensure the service is running and env vars (DATABASE_URL, OS_NODE, REDIS_URL) are set.</p>
              <p className="text-xs text-charcoal-500">Or run the backend locally with Docker for Postgres, Redis, OpenSearch.</p>
            </div>
          ) : (
            <div className="text-center py-20 text-charcoal-500">
              {imageFile ? (
                <>
                  <p className="mb-2">No similar products found.</p>
                  <p className="text-sm">
                    {mode === 'shop' ? 'Shop the look requires YOLO detection.' : 'Image search may be unavailable.'} Try text search instead.
                  </p>
                </>
              ) : q ? (
                <p>No results found. Try different keywords or upload another image.</p>
              ) : (
                <p>Enter a search query or switch to image search to get started.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="min-h-[60vh] flex items-center justify-center">Loading...</div>}>
      <SearchContent />
    </Suspense>
  )
}
