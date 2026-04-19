'use client'

import { useState, useRef, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { Shirt, Plus, X, Upload, Camera, Sparkles, Trash2, ChevronRight, Wand2, ShoppingBag, Pencil, ChevronDown } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'
import { useAuthStore } from '@/store/auth'
import type { WardrobeItemDto, WardrobeItemMetaForm } from '@/types/wardrobeItem'
import {
  appendWardrobeItemMultipartFields,
  emptyWardrobeMetaForm,
  patchBodyFromMetaForm,
  wardrobeMetaFormFromItem,
} from '@/types/wardrobeItem'

type WardrobeItem = WardrobeItemDto

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

const COMPLETE_LOOK_FETCH_CAP = 48

function suggestionProductId(s: CompleteLookSuggestion): number | null {
  const n = Number(s.id ?? s.product_id)
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : null
}

export default function WardrobePage() {
  const isAuth = useAuthStore((s) => s.isAuthenticated())
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const COMPLETE_STYLE_LIMIT_STEP = 8
  const COMPLETE_STYLE_LIMIT_MAX = 48
  const [selectedItem, setSelectedItem] = useState<WardrobeItem | null>(null)
  const [showCompleteStyle, setShowCompleteStyle] = useState(false)
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [pendingUploadFile, setPendingUploadFile] = useState<File | null>(null)
  const [uploadMeta, setUploadMeta] = useState<WardrobeItemMetaForm>(() => emptyWardrobeMetaForm())
  const [editingItem, setEditingItem] = useState<WardrobeItem | null>(null)
  const [editMeta, setEditMeta] = useState<WardrobeItemMetaForm>(() => emptyWardrobeMetaForm())
  /** Visible count only; suggestions are fetched once (cap below) and sliced client-side so “Show more” does not refetch. */
  const [completeLookVisible, setCompleteLookVisible] = useState(8)

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
    mutationFn: async ({ file, meta }: { file: File; meta: WardrobeItemMetaForm }) => {
      const formData = new FormData()
      formData.append('image', file)
      formData.append('source', 'uploaded')
      appendWardrobeItemMultipartFields(formData, meta)
      const res = await api.postForm(endpoints.wardrobe.items, formData)
      if ((res as { success?: boolean }).success === false) {
        throw new Error((res as { error?: { message?: string } }).error?.message ?? 'Upload failed')
      }
      return res
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wardrobe'] })
      setShowUploadModal(false)
      setPendingUploadFile(null)
      setUploadMeta(emptyWardrobeMetaForm())
    },
  })

  const editMutation = useMutation({
    mutationFn: async ({ id, meta }: { id: number; meta: WardrobeItemMetaForm }) => {
      const res = await api.patch(endpoints.wardrobe.item(id), patchBodyFromMetaForm(meta))
      if ((res as { success?: boolean }).success === false) {
        throw new Error((res as { error?: { message?: string } }).error?.message ?? 'Update failed')
      }
      return res
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wardrobe'] })
      queryClient.invalidateQueries({ queryKey: ['complete-style'] })
      setEditingItem(null)
    },
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
    queryKey: [
      'complete-style',
      selectedItem?.id,
      selectedItem?.audience_gender ?? '',
      selectedItem?.age_group ?? '',
    ],
    queryFn: async () => {
      if (!selectedItem) return null
      const body: Record<string, unknown> = {
        item_ids: [selectedItem.id],
        limit: COMPLETE_LOOK_FETCH_CAP,
      }
      if (selectedItem.audience_gender) body.audience_gender = selectedItem.audience_gender
      if (selectedItem.age_group) body.age_group = selectedItem.age_group
      const res = await api.post<{ suggestions?: CompleteLookSuggestion[] }>(endpoints.wardrobe.completeLook, body)
      const r = res as { success?: boolean; suggestions?: CompleteLookSuggestion[]; data?: CompleteLookSuggestion[]; error?: { message?: string } }
      if (r?.success === false) throw new Error(r?.error?.message ?? 'Failed to get suggestions')
      return (r?.suggestions ?? r?.data ?? []) as CompleteLookSuggestion[]
    },
    enabled: showCompleteStyle && !!selectedItem,
  })

  const completeStyleSuggestionsAll = useMemo(() => {
    const raw = completeStyleQuery.data
    if (!raw || !Array.isArray(raw)) return [] as CompleteLookSuggestion[]
    return (raw as CompleteLookSuggestion[]).filter((s) => suggestionProductId(s) != null)
  }, [completeStyleQuery.data])

  const completeStyleSuggestionsVisible = useMemo(
    () => completeStyleSuggestionsAll.slice(0, completeLookVisible),
    [completeStyleSuggestionsAll, completeLookVisible],
  )

  const openUploadModal = (file: File) => {
    setPendingUploadFile(file)
    setUploadMeta(emptyWardrobeMetaForm())
    setShowUploadModal(true)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) openUploadModal(file)
    e.target.value = ''
  }

  const openEditModal = (item: WardrobeItem) => {
    setEditingItem(item)
    setEditMeta(wardrobeMetaFormFromItem(item))
  }

  const metaFields = (
    meta: WardrobeItemMetaForm,
    setMeta: (m: WardrobeItemMetaForm | ((prev: WardrobeItemMetaForm) => WardrobeItemMetaForm)) => void
  ) => (
    <div className="space-y-3 text-left">
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-neutral-500 uppercase mb-1">Audience</label>
          <select
            className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900"
            value={meta.audience_gender}
            onChange={(e) =>
              setMeta((m) => ({ ...m, audience_gender: e.target.value as WardrobeItemMetaForm['audience_gender'] }))
            }
          >
            <option value="">Not specified</option>
            <option value="men">Men</option>
            <option value="women">Women</option>
            <option value="unisex">Unisex</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-neutral-500 uppercase mb-1">Age group</label>
          <select
            className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900"
            value={meta.age_group}
            onChange={(e) => setMeta((m) => ({ ...m, age_group: e.target.value as WardrobeItemMetaForm['age_group'] }))}
          >
            <option value="">Not specified</option>
            <option value="adult">Adult</option>
            <option value="kids">Kids</option>
          </select>
        </div>
      </div>
      <div>
        <label className="block text-xs font-semibold text-neutral-500 uppercase mb-1">Style tags (comma-separated)</label>
        <input
          type="text"
          className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm"
          placeholder='e.g. classic, minimalist'
          value={meta.style_tags_csv}
          onChange={(e) => setMeta((m) => ({ ...m, style_tags_csv: e.target.value }))}
        />
      </div>
      <div>
        <label className="block text-xs font-semibold text-neutral-500 uppercase mb-1">Occasion tags</label>
        <input
          type="text"
          className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm"
          placeholder="e.g. work, smart-casual"
          value={meta.occasion_tags_csv}
          onChange={(e) => setMeta((m) => ({ ...m, occasion_tags_csv: e.target.value }))}
        />
      </div>
      <div>
        <label className="block text-xs font-semibold text-neutral-500 uppercase mb-1">Season tags</label>
        <input
          type="text"
          className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm"
          placeholder="e.g. spring, fall"
          value={meta.season_tags_csv}
          onChange={(e) => setMeta((m) => ({ ...m, season_tags_csv: e.target.value }))}
        />
      </div>
      <p className="text-[11px] text-neutral-400">
        For uploads, tag lists are sent as JSON strings in multipart form data. All fields optional.
      </p>
    </div>
  )

  const formatPrice = (cents: number, currency = 'USD') =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 0 }).format(cents / 100)

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
    setCompleteLookVisible(8)
    setCompleteStyleLimit(COMPLETE_STYLE_LIMIT_STEP)
    setCompleteStyleAudienceGender(undefined)
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
                  <div className="absolute bottom-0 inset-x-0 p-2 flex flex-wrap items-center gap-1.5 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out">
                    <button
                      type="button"
                      onClick={() => openCompleteStyle(item)}
                      className="flex-1 min-w-[6rem] flex items-center justify-center gap-1 px-2 py-2 rounded-xl bg-white/90 backdrop-blur-sm text-violet-700 text-[11px] font-semibold hover:bg-white transition-colors"
                    >
                      <Wand2 className="w-3.5 h-3.5 shrink-0" />
                      Style
                    </button>
                    <button
                      type="button"
                      onClick={() => openEditModal(item)}
                      className="p-2 rounded-xl bg-white/90 backdrop-blur-sm text-neutral-500 hover:text-violet-600 hover:bg-white transition-colors"
                      title="Edit details"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
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
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {item.category && (
                      <span className="text-xs font-medium text-violet-600 bg-violet-50 px-2 py-0.5 rounded-full">{item.category}</span>
                    )}
                    {item.color && (
                      <span className="text-xs text-neutral-500">{item.color}</span>
                    )}
                    {item.audience_gender && (
                      <span className="text-[10px] font-medium text-neutral-600 bg-neutral-100 px-1.5 py-0.5 rounded">
                        {item.audience_gender}
                      </span>
                    )}
                    {item.age_group && (
                      <span className="text-[10px] font-medium text-neutral-600 bg-neutral-100 px-1.5 py-0.5 rounded">{item.age_group}</span>
                    )}
                  </div>
                  {(item.style_tags?.length || item.occasion_tags?.length) ? (
                    <p className="text-[10px] text-neutral-400 mt-1 line-clamp-2">
                      {[...(item.style_tags ?? []), ...(item.occasion_tags ?? [])].slice(0, 6).join(' · ')}
                    </p>
                  ) : null}
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

                <div className="flex flex-wrap items-center gap-2 mb-6">
                  {(['men', 'women', 'unisex'] as const).map((gender) => {
                    const active = completeStyleAudienceGender === gender
                    return (
                      <button
                        key={gender}
                        type="button"
                        onClick={() => setCompleteStyleAudienceGender(gender)}
                        className={`px-3 py-1.5 rounded-full text-sm font-semibold border transition-colors ${
                          active
                            ? 'bg-violet-600 text-white border-violet-600'
                            : 'bg-white text-neutral-600 border-neutral-200 hover:border-violet-200 hover:text-violet-700'
                        }`}
                      >
                        {gender === 'men' ? 'Men' : gender === 'women' ? 'Women' : 'Unisex'}
                      </button>
                    )
                  })}
                  <button
                    type="button"
                    onClick={() => setCompleteStyleAudienceGender(undefined)}
                    className={`px-3 py-1.5 rounded-full text-sm font-semibold border transition-colors ${
                      completeStyleAudienceGender === undefined
                        ? 'bg-violet-600 text-white border-violet-600'
                        : 'bg-white text-neutral-600 border-neutral-200 hover:border-violet-200 hover:text-violet-700'
                    }`}
                  >
                    Auto
                  </button>
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
                ) : completeStyleSuggestionsAll.length > 0 ? (
                  <>
                  <motion.div
                    initial="hidden"
                    animate="visible"
                    variants={{ visible: { transition: { staggerChildren: 0.06 } }, hidden: {} }}
                    className="grid grid-cols-2 gap-4"
                  >
                    {completeStyleSuggestionsVisible.map((s) => {
                ) : completeStyleQuery.data && completeStyleQuery.data.length > 0 ? (
                  <>
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
                  {completeStyleSuggestionsAll.length > completeLookVisible ? (
                      <div className="flex justify-center mt-6">
                        <button
                          type="button"
                          onClick={() =>
                            setCompleteLookVisible((n) =>
                              Math.min(n + 8, completeStyleSuggestionsAll.length, COMPLETE_LOOK_FETCH_CAP),
                            )
                          }
                          className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full border border-violet-200 bg-white text-sm font-semibold text-violet-700 hover:bg-violet-50"
                        >
                          <ChevronDown className="w-4 h-4" />
                          Show more
                        </button>
                      </div>
                    ) : null}
                    </motion.div>

                    {(() => {
                      const dataLen = Array.isArray(completeStyleQuery.data) ? completeStyleQuery.data.length : 0
                      const canLoadMore =
                        dataLen >= completeStyleLimit && completeStyleLimit < COMPLETE_STYLE_LIMIT_MAX
                      if (!canLoadMore) return null
                      return (
                        <div className="mt-5 flex justify-center">
                          <button
                            type="button"
                            onClick={() =>
                              setCompleteStyleLimit((prev) =>
                                Math.min(COMPLETE_STYLE_LIMIT_MAX, prev + COMPLETE_STYLE_LIMIT_STEP)
                              )
                            }
                            disabled={completeStyleQuery.isFetching}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-violet-200 bg-violet-50 text-violet-700 font-semibold text-sm hover:bg-violet-100 transition-colors disabled:opacity-60"
                          >
                            {completeStyleQuery.isFetching ? 'Loading…' : 'Load more'}
                          </button>
                        </div>
                      )
                    })()}
                  </>
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

      {/* Upload metadata + confirm */}
      <AnimatePresence>
        {showUploadModal && pendingUploadFile && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setShowUploadModal(false)
                setPendingUploadFile(null)
              }
            }}
          >
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 24, scale: 0.98 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="w-full max-w-md bg-white rounded-3xl shadow-2xl p-6 max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <h3 className="font-display font-bold text-neutral-900">Add wardrobe item</h3>
                  <p className="text-xs text-neutral-500 mt-1 break-all">{pendingUploadFile.name}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowUploadModal(false)
                    setPendingUploadFile(null)
                  }}
                  className="p-2 rounded-xl hover:bg-neutral-100 text-neutral-400"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              {metaFields(uploadMeta, setUploadMeta)}
              {addMutation.isError && (
                <p className="mt-3 text-sm text-rose-600">{(addMutation.error as Error)?.message ?? 'Upload failed'}</p>
              )}
              <div className="flex gap-2 mt-5">
                <button
                  type="button"
                  onClick={() => {
                    setShowUploadModal(false)
                    setPendingUploadFile(null)
                  }}
                  className="flex-1 py-2.5 rounded-xl border border-neutral-200 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={addMutation.isPending}
                  onClick={() => addMutation.mutate({ file: pendingUploadFile, meta: uploadMeta })}
                  className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-500 text-white text-sm font-semibold disabled:opacity-60"
                >
                  {addMutation.isPending ? 'Uploading…' : 'Upload'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Edit item metadata */}
      <AnimatePresence>
        {editingItem && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget) setEditingItem(null)
            }}
          >
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 24, scale: 0.98 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="w-full max-w-md bg-white rounded-3xl shadow-2xl p-6 max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <h3 className="font-display font-bold text-neutral-900">Edit item details</h3>
                  <p className="text-xs text-neutral-500 mt-1 truncate">{editingItem.name || `Item #${editingItem.id}`}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingItem(null)}
                  className="p-2 rounded-xl hover:bg-neutral-100 text-neutral-400"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              {metaFields(editMeta, setEditMeta)}
              {editMutation.isError && (
                <p className="mt-3 text-sm text-rose-600">{(editMutation.error as Error)?.message ?? 'Update failed'}</p>
              )}
              <div className="flex gap-2 mt-5">
                <button
                  type="button"
                  onClick={() => setEditingItem(null)}
                  className="flex-1 py-2.5 rounded-xl border border-neutral-200 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={editMutation.isPending}
                  onClick={() => editMutation.mutate({ id: editingItem.id, meta: editMeta })}
                  className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-500 text-white text-sm font-semibold disabled:opacity-60"
                >
                  {editMutation.isPending ? 'Saving…' : 'Save'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
