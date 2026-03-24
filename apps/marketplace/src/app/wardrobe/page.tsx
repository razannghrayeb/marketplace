'use client'

import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { Shirt, Plus, X, Upload, Camera, Sparkles, Eye, Trash2, ChevronRight, Wand2, ShoppingBag } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'
import { useAuthStore } from '@/store/auth'
import type { Product } from '@/types/product'

interface WardrobeItem {
  id: number
  name?: string
  category?: string
  color?: string
  image_url?: string
  image_cdn?: string
}

interface CompleteLookSuggestion {
  id?: number
  product_id: number
  title: string
  brand?: string
  category?: string
  price_cents?: number
  image_url?: string
  image_cdn?: string
  score?: number
  reason?: string
}

export default function WardrobePage() {
  const isAuth = useAuthStore((s) => s.isAuthenticated())
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const [selectedItem, setSelectedItem] = useState<WardrobeItem | null>(null)
  const [showCompleteStyle, setShowCompleteStyle] = useState(false)

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['wardrobe'],
    queryFn: async () => {
      const res = await api.get<{ items?: unknown[]; success?: boolean; error?: { message?: string } }>(endpoints.wardrobe.items)
      const r = res as { items?: unknown[]; success?: boolean; error?: { message?: string } }
      if (r?.success === false && r?.error?.message) throw new Error(r.error.message)
      return r
    },
    enabled: isAuth,
  })

  const addMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData()
      formData.append('image', file)
      formData.append('source', 'uploaded')
      const res = await api.postForm(endpoints.wardrobe.items, formData)
      if ((res as { success?: boolean }).success === false) {
        throw new Error((res as { error?: { message?: string } }).error?.message ?? 'Upload failed')
      }
      return res
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['wardrobe'] }),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await api.delete(endpoints.wardrobe.item(id))
      if ((res as { success?: boolean }).success === false) {
        throw new Error((res as { error?: { message?: string } }).error?.message ?? 'Delete failed')
      }
      return res
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wardrobe'] })
      setSelectedItem(null)
    },
  })

  const completeStyleQuery = useQuery({
    queryKey: ['complete-style', selectedItem?.id],
    queryFn: async () => {
      if (!selectedItem) return null
      const res = await api.post<{ suggestions?: CompleteLookSuggestion[] }>(endpoints.wardrobe.completeLook, {
        item_ids: [selectedItem.id],
        limit: 8,
      })
      const r = res as { success?: boolean; suggestions?: CompleteLookSuggestion[]; data?: CompleteLookSuggestion[]; error?: { message?: string } }
      if (r?.success === false) throw new Error(r?.error?.message ?? 'Failed to get suggestions')
      return (r?.suggestions ?? r?.data ?? []) as CompleteLookSuggestion[]
    },
    enabled: showCompleteStyle && !!selectedItem,
  })

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) addMutation.mutate(file)
    e.target.value = ''
  }

  const formatPrice = (cents: number, currency = 'USD') =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 0 }).format(cents / 100)

  const suggestionProductId = (s: CompleteLookSuggestion) => {
    const n = Number(s.id ?? s.product_id)
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : null
  }

  if (!isAuth) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-md text-center">
          <div className="relative w-20 h-20 mx-auto mb-6">
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 opacity-15 blur-xl" />
            <div className="relative w-20 h-20 rounded-2xl bg-gradient-to-br from-violet-100 to-fuchsia-100 flex items-center justify-center">
              <Shirt className="w-9 h-9 text-violet-600" />
            </div>
          </div>
          <h2 className="font-display text-2xl font-bold text-neutral-900 mb-2">Sign in for your wardrobe</h2>
          <p className="text-neutral-500 mb-8">Upload your clothes, get style suggestions, and complete looks with AI.</p>
          <a
            href="/login"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-500 text-white font-semibold shadow-lg shadow-violet-500/20 hover:from-violet-500 hover:to-fuchsia-400 active:scale-[0.97] transition-all"
          >
            Sign in
          </a>
        </motion.div>
      </div>
    )
  }

  const items = ((data as { items?: unknown[] })?.items ?? []) as WardrobeItem[]

  if (isError && error) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <div className="max-w-md text-center">
          <div className="w-16 h-16 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center mx-auto mb-5">
            <Shirt className="w-8 h-8" />
          </div>
          <p className="text-neutral-900 font-bold text-lg mb-2">Unable to load wardrobe</p>
          <p className="text-sm text-neutral-500">{(error as Error).message}</p>
        </div>
      </div>
    )
  }

  const openCompleteStyle = (item: WardrobeItem) => {
    setSelectedItem(item)
    setShowCompleteStyle(true)
  }

  return (
    <>
      {/* Hidden file inputs */}
      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={handleFileChange} className="hidden" />

      {/* ── Header ── */}
      <div className="relative overflow-hidden bg-gradient-to-b from-violet-50 via-fuchsia-50/40 to-neutral-100 border-b border-neutral-200/60">
        <div className="pointer-events-none absolute -top-16 -right-16 h-64 w-64 rounded-full bg-violet-200/40 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute top-8 -left-12 h-48 w-48 rounded-full bg-fuchsia-200/30 blur-3xl" aria-hidden />

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-6">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-md shadow-violet-500/20">
                  <Shirt className="w-5 h-5" />
                </div>
                <div>
                  <h1 className="font-display text-2xl sm:text-3xl font-bold text-neutral-900">My Wardrobe</h1>
                  <p className="text-sm text-neutral-500 mt-0.5">
                    {items.length > 0 ? `${items.length} item${items.length !== 1 ? 's' : ''}` : 'Upload clothes to get started'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => cameraInputRef.current?.click()}
                  disabled={addMutation.isPending}
                  className="p-2.5 rounded-xl border border-neutral-200/80 bg-white/80 text-neutral-500 hover:text-violet-600 hover:border-violet-200 hover:bg-violet-50/50 backdrop-blur-sm transition-all"
                  title="Take a photo"
                >
                  <Camera className="w-5 h-5" />
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={addMutation.isPending}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-500 text-white font-semibold shadow-md shadow-violet-500/20 hover:from-violet-500 hover:to-fuchsia-400 active:scale-[0.97] transition-all disabled:opacity-60"
                >
                  {addMutation.isPending ? (
                    <>
                      <div className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4" />
                      Add item
                    </>
                  )}
                </button>
              </div>
            </div>

            {addMutation.isError && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-3 text-sm text-rose-600 bg-rose-50 border border-rose-200/60 px-4 py-2 rounded-xl"
              >
                {(addMutation.error as Error)?.message ?? 'Upload failed'}
              </motion.p>
            )}
          </motion.div>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5 sm:gap-6">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="space-y-2">
                <div className="aspect-square rounded-2xl skeleton-shimmer ring-1 ring-neutral-200/60" />
                <div className="h-3 w-2/3 rounded-md skeleton-shimmer" />
                <div className="h-3 w-1/3 rounded-md skeleton-shimmer" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="py-16 max-w-lg mx-auto text-center"
          >
            <div className="relative w-24 h-24 mx-auto mb-6">
              <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-violet-500 to-fuchsia-500 opacity-15 blur-xl" />
              <div className="relative w-24 h-24 rounded-3xl bg-gradient-to-br from-violet-100 to-fuchsia-100 flex items-center justify-center">
                <Shirt className="w-10 h-10 text-violet-600" />
              </div>
            </div>
            <h2 className="font-display text-xl font-bold text-neutral-900 mb-2">Your wardrobe is empty</h2>
            <p className="text-neutral-500 mb-8">Upload photos of your clothes to get AI-powered style suggestions and outfit completions.</p>
            <div className="flex flex-wrap justify-center gap-3">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={addMutation.isPending}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-500 text-white font-semibold shadow-lg shadow-violet-500/20 hover:from-violet-500 hover:to-fuchsia-400 active:scale-[0.97] transition-all"
              >
                <Upload className="w-4 h-4" />
                Choose photo
              </button>
              <button
                onClick={() => cameraInputRef.current?.click()}
                disabled={addMutation.isPending}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-violet-100 text-violet-700 font-semibold hover:bg-violet-200 active:scale-[0.97] transition-all"
              >
                <Camera className="w-4 h-4" />
                Take a photo
              </button>
            </div>
          </motion.div>
        ) : (
          <motion.div
            initial="hidden"
            animate="visible"
            variants={{ visible: { transition: { staggerChildren: 0.04 } }, hidden: {} }}
            className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5 sm:gap-6"
          >
            {items.map((item) => (
              <motion.div
                key={item.id}
                variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }}
                className="group relative rounded-2xl overflow-hidden bg-white border border-neutral-200/60 shadow-sm hover:shadow-xl hover:shadow-violet-500/10 hover:-translate-y-0.5 transition-all duration-300"
              >
                <div className="aspect-square relative bg-neutral-100 overflow-hidden">
                  {(item.image_url || item.image_cdn) ? (
                    <img
                      src={item.image_cdn || item.image_url}
                      alt={item.name || 'Item'}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Shirt className="w-12 h-12 text-neutral-300" />
                    </div>
                  )}

                  {/* Hover overlay actions */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  <div className="absolute bottom-0 inset-x-0 p-3 flex items-center gap-2 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out">
                    <button
                      onClick={() => openCompleteStyle(item)}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-white/90 backdrop-blur-sm text-violet-700 text-xs font-semibold hover:bg-white transition-colors"
                    >
                      <Wand2 className="w-3.5 h-3.5" />
                      Complete style
                    </button>
                    <button
                      onClick={() => deleteMutation.mutate(item.id)}
                      className="p-2 rounded-xl bg-white/90 backdrop-blur-sm text-neutral-500 hover:text-rose-500 hover:bg-white transition-colors"
                      title="Remove item"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="p-3">
                  <p className="font-semibold text-neutral-800 text-sm truncate">{item.name || 'Unnamed item'}</p>
                  <div className="flex items-center gap-2 mt-1">
                    {item.category && (
                      <span className="text-xs font-medium text-violet-600 bg-violet-50 px-2 py-0.5 rounded-full">{item.category}</span>
                    )}
                    {item.color && (
                      <span className="text-xs text-neutral-500">{item.color}</span>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>

      {/* ── Complete the Style modal ── */}
      <AnimatePresence>
        {showCompleteStyle && selectedItem && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4"
            onClick={(e) => { if (e.target === e.currentTarget) setShowCompleteStyle(false) }}
          >
            <motion.div
              initial={{ opacity: 0, y: 40, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 40, scale: 0.97 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              className="w-full max-w-2xl max-h-[85vh] overflow-y-auto bg-white rounded-3xl shadow-2xl"
            >
              {/* Modal header */}
              <div className="sticky top-0 z-10 bg-white/90 backdrop-blur-md border-b border-neutral-100 px-6 py-4 flex items-center justify-between rounded-t-3xl">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white">
                    <Wand2 className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-display font-bold text-neutral-900">Complete your style</h3>
                    <p className="text-xs text-neutral-500">AI-picked pieces that pair with your item</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowCompleteStyle(false)}
                  className="p-2 rounded-xl hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6">
                {/* Selected item */}
                <div className="flex items-center gap-4 p-3 rounded-2xl bg-neutral-50 border border-neutral-200/60 mb-6">
                  <div className="w-16 h-16 rounded-xl overflow-hidden bg-neutral-100 flex-shrink-0 ring-1 ring-neutral-200/60">
                    {(selectedItem.image_url || selectedItem.image_cdn) ? (
                      <img
                        src={selectedItem.image_cdn || selectedItem.image_url}
                        alt={selectedItem.name || 'Item'}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center"><Shirt className="w-6 h-6 text-neutral-300" /></div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-neutral-800 text-sm truncate">{selectedItem.name || 'Your item'}</p>
                    {selectedItem.category && <p className="text-xs text-violet-600 mt-0.5">{selectedItem.category}</p>}
                  </div>
                  <span className="text-xs font-medium text-neutral-400 uppercase tracking-wider">Styling for</span>
                </div>

                {/* Suggestions */}
                {completeStyleQuery.isLoading ? (
                  <div className="grid grid-cols-2 gap-4">
                    {[1, 2, 3, 4].map((i) => (
                      <div key={i} className="space-y-2">
                        <div className="aspect-[3/4] rounded-2xl skeleton-shimmer ring-1 ring-neutral-200/60" />
                        <div className="h-3 w-2/3 rounded-md skeleton-shimmer" />
                      </div>
                    ))}
                  </div>
                ) : completeStyleQuery.isError ? (
                  <div className="text-center py-12">
                    <p className="text-neutral-800 font-medium mb-1">Could not load suggestions</p>
                    <p className="text-sm text-neutral-500">{(completeStyleQuery.error as Error)?.message}</p>
                  </div>
                ) : completeStyleQuery.data && completeStyleQuery.data.length > 0 ? (
                  <motion.div
                    initial="hidden"
                    animate="visible"
                    variants={{ visible: { transition: { staggerChildren: 0.06 } }, hidden: {} }}
                    className="grid grid-cols-2 gap-4"
                  >
                    {(completeStyleQuery.data as CompleteLookSuggestion[])
                      .filter((s) => suggestionProductId(s) != null)
                      .map((s) => {
                        const pid = suggestionProductId(s)!
                        const cents = s.price_cents
                        const priceLabel =
                          typeof cents === 'number' && Number.isFinite(cents) && cents > 0
                            ? formatPrice(Math.round(cents))
                            : '—'
                        return (
                      <motion.div
                        key={pid}
                        variants={{ hidden: { opacity: 0, y: 12 }, visible: { opacity: 1, y: 0 } }}
                      >
                        <Link
                          href={`/products/${pid}`}
                          className="block group rounded-2xl border border-neutral-200/60 bg-white overflow-hidden hover:shadow-lg hover:shadow-violet-500/10 hover:-translate-y-0.5 transition-all duration-300"
                        >
                          <div className="aspect-[3/4] relative bg-neutral-100 overflow-hidden">
                            <Image
                              src={s.image_cdn || s.image_url || 'https://placehold.co/200x267/f5f5f5/737373?text=No+Image'}
                              alt={s.title}
                              fill
                              className="object-cover group-hover:scale-105 transition-transform duration-500"
                              sizes="200px"
                            />
                            {s.reason && (
                              <div className="absolute top-2 left-2 right-2">
                                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-white/90 backdrop-blur-sm text-[10px] font-semibold text-violet-700 shadow-sm line-clamp-2">
                                  <Sparkles className="w-3 h-3 shrink-0" />
                                  {s.reason}
                                </span>
                              </div>
                            )}
                          </div>
                          <div className="p-3">
                            <p className="text-[10px] font-semibold text-violet-600 uppercase tracking-wider">{s.brand || s.category || ''}</p>
                            <p className="text-sm font-semibold text-neutral-900 line-clamp-2 mt-0.5">{s.title}</p>
                            <div className="flex items-center justify-between mt-1.5 gap-2">
                              <p className="text-sm font-bold text-violet-700 tabular-nums">{priceLabel}</p>
                              <span className="text-xs text-violet-600 font-semibold flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                View <ChevronRight className="w-3 h-3" />
                              </span>
                            </div>
                          </div>
                        </Link>
                      </motion.div>
                        )
                      })}
                  </motion.div>
                ) : (
                  <div className="text-center py-12">
                    <div className="w-14 h-14 rounded-2xl bg-neutral-100 flex items-center justify-center mx-auto mb-4">
                      <ShoppingBag className="w-7 h-7 text-neutral-300" />
                    </div>
                    <p className="text-neutral-800 font-medium mb-1">No suggestions yet</p>
                    <p className="text-sm text-neutral-500">Add more items to your wardrobe for style matches.</p>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
