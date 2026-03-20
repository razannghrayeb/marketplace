'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense, useState, useCallback, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Search, Image, Sparkles, Layers } from 'lucide-react'
import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'
import { ProductCard } from '@/components/product/ProductCard'
import { SearchBar } from '@/components/search/SearchBar'
import { useCompareStore } from '@/store/compare'
import type { Product } from '@/types/product'

function SearchProductGrid({
  products,
  addToCompare,
  inCompare,
}: {
  products: Product[]
  addToCompare: (id: number) => void
  inCompare: (id: number) => boolean
}) {
  const ids = products.map((p) => p.id)
  const { data: variantsData } = useQuery({
    queryKey: ['variants', ids.join(',')],
    queryFn: async () => {
      const res = await api.post<{ data?: Record<string, { minPriceCents: number; maxPriceCents: number }> }>(
        endpoints.products.variantsBatch,
        { productIds: ids }
      )
      return res.data ?? {}
    },
    enabled: ids.length > 0,
  })

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={{
        visible: { transition: { staggerChildren: 0.05 } },
        hidden: {},
      }}
      className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6"
    >
      {products.map((product, i) => {
        const v = variantsData?.[String(product.id)]
        const variantPrice = v && v.minPriceCents !== v.maxPriceCents
          ? { minPriceCents: v.minPriceCents, maxPriceCents: v.maxPriceCents }
          : undefined
        return (
          <motion.div
            key={product.id}
            variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }}
          >
            <ProductCard
              product={product}
              index={i}
              onAddToCompare={addToCompare}
              inCompare={inCompare(product.id)}
              variantPrice={variantPrice}
            />
          </motion.div>
        )
      })}
    </motion.div>
  )
}

function toProducts(results: unknown[]): Product[] {
  return results
    .filter((r): r is Record<string, unknown> => Boolean(r && typeof r === 'object' && ('id' in r || 'product_id' in r)))
    .map((r) => {
      const raw = r as { id?: number; product_id?: number; name?: string; title?: string; price?: number; price_cents?: number; price_usd?: number; priceUsd?: number; imageUrl?: string; image_url?: string; image_cdn?: string; imageCdn?: string; brand?: string; category?: string }
      const id = raw.id ?? raw.product_id ?? 0
      const priceUsd = raw.price ?? raw.price_usd ?? raw.priceUsd
      return {
        id,
        title: raw.title ?? raw.name ?? '',
        price_cents: raw.price_cents ?? (typeof priceUsd === 'number' ? Math.round(priceUsd * 100) : 0),
        image_url: raw.image_url ?? raw.imageUrl ?? raw.image_cdn ?? raw.imageCdn ?? null,
        image_cdn: raw.image_cdn ?? raw.imageCdn ?? null,
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
  const [multiImages, setMultiImages] = useState<File[]>([])
  const [multiPrompt, setMultiPrompt] = useState('')
  const [searchTrigger, setSearchTrigger] = useState(0)
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string>('')
  const [multiImageUrls, setMultiImageUrls] = useState<string[]>([])
  const addToCompare = useCompareStore((s) => s.add)
  const inCompare = useCompareStore((s) => s.has)

  useEffect(() => {
    if (!imageFile) {
      setImagePreviewUrl('')
      return
    }
    const url = URL.createObjectURL(imageFile)
    setImagePreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [imageFile])

  useEffect(() => {
    const urls = multiImages.map((f) => URL.createObjectURL(f))
    setMultiImageUrls(urls)
    return () => urls.forEach((u) => URL.revokeObjectURL(u))
  }, [multiImages])

  const handleSubmit = useCallback(() => setSearchTrigger((t) => t + 1), [])

  const imageKey = imageFile ? `${imageFile.name}-${imageFile.size}-${imageFile.lastModified}` : ''
  const multiKey = multiImages.map((f) => f.name).join(',') + '-' + multiPrompt
  const { data, isLoading, isFetching, isError, error } = useQuery({
    queryKey: ['search', q, mode, imageKey, multiKey, searchTrigger],
    queryFn: async () => {
      if (mode === 'multi' && multiImages.length > 0 && multiPrompt.trim()) {
        const formData = new FormData()
        multiImages.forEach((f) => formData.append('images', f))
        formData.append('prompt', multiPrompt.trim())
        const res = await api.postForm(endpoints.search.multiImage, formData)
        const raw = res as { results?: unknown[]; error?: string }
        if (raw?.error) throw new Error(raw.error)
        const results = raw?.results ?? []
        return { results: Array.isArray(results) ? results : [], query: { mixMatch: true } }
      }
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
    enabled:
      !!q.trim() ||
      ((mode === 'image' || mode === 'shop') && !!imageFile && searchTrigger > 0) ||
      (mode === 'multi' && multiImages.length > 0 && !!multiPrompt.trim() && searchTrigger > 0),
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

          <div className="flex flex-wrap gap-2 mt-6">
            <a
              href="/search"
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                mode === 'text' ? 'bg-wine-700 text-white' : 'bg-cream-200 text-charcoal-600 hover:bg-cream-300'
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
            <a
              href="/search?mode=multi"
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                mode === 'multi' ? 'bg-wine-700 text-white' : 'bg-cream-200 text-charcoal-600 hover:bg-cream-300'
              }`}
            >
              <Layers className="w-4 h-4" />
              Mix & Match
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
              {imageFile && (
                <div className="mt-3 flex items-center gap-4">
                  <div className="relative w-20 h-20 rounded-lg overflow-hidden bg-cream-200 flex-shrink-0">
                    <img
                      src={imagePreviewUrl}
                      alt="Preview"
                      className="object-cover w-full h-full"
                    />
                  </div>
                  <p className="text-sm text-charcoal-600">{imageFile.name}</p>
                </div>
              )}
              {imageFile && (
                <button
                  type="button"
                  onClick={handleSubmit}
                  className="mt-4 flex items-center gap-2 px-5 py-2.5 rounded-full bg-wine-700 text-white font-medium hover:bg-wine-800 transition-colors"
                >
                  <Search className="w-4 h-4" />
                  Search
                </button>
              )}
            </div>
          )}

          {mode === 'multi' && (
            <div className="mt-6 p-6 rounded-2xl bg-cream-100 border border-cream-300 border-dashed">
              <label className="block text-sm font-medium text-charcoal-700 mb-2">
                Upload 1–5 images and describe what you want from each
              </label>
              <p className="text-xs text-charcoal-500 mb-3">
                e.g. &quot;Use the color from the first image and the style from the second&quot;
              </p>
              <div className="flex flex-wrap gap-2 mb-3">
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  id="multi-image-input"
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files || [])
                    setMultiImages((prev) => [...prev, ...files].slice(0, 5))
                    e.target.value = ''
                  }}
                />
                <label
                  htmlFor="multi-image-input"
                  className="cursor-pointer flex items-center gap-2 px-4 py-2 rounded-full bg-wine-100 text-wine-700 font-medium hover:bg-wine-200 transition-colors"
                >
                  <Image className="w-4 h-4" />
                  Choose images
                </label>
                {multiImages.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setMultiImages([])}
                    className="text-sm text-charcoal-500 hover:text-charcoal-700"
                  >
                    Clear all
                  </button>
                )}
              </div>
              {multiImages.length > 0 && (
                <div className="flex flex-wrap gap-3 mb-3">
                  {multiImages.map((file, i) => (
                    <div key={`${file.name}-${i}`} className="relative group">
                      <div className="w-20 h-24 rounded-lg overflow-hidden bg-cream-200 border border-cream-300">
                        <img
                          src={multiImageUrls[i] ?? ''}
                          alt={`Preview ${i + 1}`}
                          className="object-cover w-full h-full"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => setMultiImages((p) => p.filter((_, j) => j !== i))}
                        className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-charcoal-600 text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                        aria-label="Remove"
                      >
                        ×
                      </button>
                      <p className="text-xs text-charcoal-500 mt-1 truncate max-w-[80px]">{file.name}</p>
                    </div>
                  ))}
                </div>
              )}
              {multiImages.length > 0 && (
                <p className="text-sm text-charcoal-500 mb-3">
                  {multiImages.length} image{multiImages.length > 1 ? 's' : ''} selected
                </p>
              )}
              <textarea
                placeholder="Describe what you want from each image..."
                value={multiPrompt}
                onChange={(e) => setMultiPrompt(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-cream-300 bg-white text-charcoal-700 placeholder-charcoal-400 focus:ring-2 focus:ring-wine-200 focus:border-wine-300 resize-none mb-4"
                rows={3}
              />
              {multiImages.length > 0 && multiPrompt.trim() && (
                <button
                  type="button"
                  onClick={handleSubmit}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-wine-700 text-white font-medium hover:bg-wine-800 transition-colors"
                >
                  <Search className="w-4 h-4" />
                  Search
                </button>
              )}
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
            <SearchProductGrid
              products={products}
              addToCompare={addToCompare}
              inCompare={inCompare}
            />
          ) : isError ? (
            <div className="text-center py-20 text-wine-600 bg-wine-50 rounded-2xl border border-wine-200 max-w-lg mx-auto">
              <p className="font-medium mb-2">Backend unavailable (502 Bad Gateway)</p>
              <p className="text-sm text-charcoal-600 mb-3">{(error as Error)?.message ?? 'The Render backend is down or not responding.'}</p>
              <p className="text-xs text-charcoal-500 mb-4">Check your Render dashboard: ensure the service is running and env vars (DATABASE_URL, OS_NODE, REDIS_URL) are set.</p>
              <p className="text-xs text-charcoal-500">Or run the backend locally with Docker for Postgres, Redis, OpenSearch.</p>
            </div>
          ) : (
            <div className="text-center py-20 text-charcoal-500">
              {mode === 'multi' ? (
                multiImages.length === 0 || !multiPrompt.trim() ? (
                  <p>Upload 1–5 images and enter a prompt describing what you want from each.</p>
                ) : searchTrigger === 0 ? (
                  <p>Click the Search button above to find products.</p>
                ) : (
                  <>
                    <p className="mb-2">No matching products found.</p>
                    <p className="text-sm">Try a different prompt or different images.</p>
                  </>
                )
              ) : (mode === 'image' || mode === 'shop') && imageFile && searchTrigger === 0 ? (
                <p>Click the Search button above to find similar products.</p>
              ) : imageFile ? (
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
