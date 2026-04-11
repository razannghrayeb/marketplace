'use client'

import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { GitCompare, X, AlertTriangle, ArrowRight, Sparkles, SlidersHorizontal } from 'lucide-react'
import Link from 'next/link'
import Image from 'next/image'
import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'
import { useCompareStore } from '@/store/compare'
import type { Product } from '@/types/product'
import type { CompareDecisionResponse, CompareGoal, CompareOccasion } from '@/types/compareDecision'
import { unwrapCompareDecisionResponse } from '@/lib/compare-decision/selectors'
import {
  buildCompareDecisionRequest,
  type CompareDecisionFormState,
} from '@/lib/compare-decision/buildRequest'
import { CompareDecisionResults } from '@/components/compare/CompareDecisionResults'

const GOAL_OPTIONS: { value: CompareGoal; label: string }[] = [
  { value: 'best_value', label: 'Best value' },
  { value: 'premium_quality', label: 'Premium quality' },
  { value: 'style_match', label: 'Style match' },
  { value: 'low_risk_return', label: 'Low risk / returns' },
  { value: 'occasion_fit', label: 'Occasion fit' },
]

const OCCASION_OPTIONS: { value: CompareOccasion; label: string }[] = [
  { value: 'casual', label: 'Casual' },
  { value: 'work', label: 'Work' },
  { value: 'formal', label: 'Formal' },
  { value: 'party', label: 'Party' },
  { value: 'travel', label: 'Travel' },
]

const defaultForm = (): CompareDecisionFormState => ({
  mode: 'standard',
  currentSelfRaw: '',
  aspirationalSelfRaw: '',
})

export default function ComparePage() {
  const { productIds, remove, clear } = useCompareStore()
  const [form, setForm] = useState<CompareDecisionFormState>(defaultForm)
  /** Subset of `productIds` to send to the compare API (2–5). */
  const [selectedIds, setSelectedIds] = useState<number[]>([])

  const productIdsKey = useMemo(() => [...productIds].sort((a, b) => a - b).join(','), [productIds])

  useEffect(() => {
    setSelectedIds((prev) => {
      const inTray = new Set(productIds)
      const kept = prev.filter((id) => inTray.has(id))
      for (const id of productIds) {
        if (!kept.includes(id)) kept.push(id)
      }
      return kept
    })
  }, [productIdsKey, productIds])

  const selectedForCompare = useMemo(
    () => selectedIds.filter((id) => productIds.includes(id)),
    [selectedIds, productIds],
  )

  useEffect(() => {
    setForm((f) => {
      if (f.firstAttractionProductId != null && !selectedForCompare.includes(f.firstAttractionProductId)) {
        return { ...f, firstAttractionProductId: undefined }
      }
      return f
    })
  }, [selectedForCompare])

  const { data: products, isLoading: loadingProducts } = useQuery({
    queryKey: ['compare-products', productIds],
    queryFn: async () => {
      const results: Product[] = []
      for (const id of productIds) {
        const res = await api.get(endpoints.products.byId(id))
        const p = (res.data ?? res) as unknown as Product | undefined
        if (p && typeof p === 'object' && 'id' in p) results.push(p)
      }
      return results
    },
    enabled: productIds.length > 0,
  })

  const compareMutation = useMutation({
    mutationFn: async (ids: number[]): Promise<CompareDecisionResponse> => {
      const body = buildCompareDecisionRequest(ids, form)
      const res = await api.post<unknown>(endpoints.compare.decision, body)
      if (res.success === false) {
        throw new Error(res.error?.message ?? 'Compare decision failed')
      }
      const raw = (res.data ?? res) as unknown
      const parsed = unwrapCompareDecisionResponse(raw)
      if (!parsed) {
        throw new Error('Unexpected response from compare decision API. Is the backend route mounted at POST /api/compare?')
      }
      return parsed
    },
  })

  const compareResult = compareMutation.data
  const canCompare = selectedForCompare.length >= 2 && selectedForCompare.length <= 5

  const selectedKey = selectedForCompare.join(',')
  useEffect(() => {
    compareMutation.reset()
  }, [selectedKey, productIdsKey])

  const runCompare = () => {
    if (canCompare) compareMutation.mutate(selectedForCompare)
  }

  const toggleCompareSelection = (id: number) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      return [...prev, id]
    })
  }

  const selectAllInTray = () => setSelectedIds([...productIds])
  const clearCompareSelection = () => setSelectedIds([])

  const formatPrice = (cents: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(cents / 100)

  const sliderPct = (v: number | undefined) => (v == null ? 50 : Math.round(v * 100))
  const setPreferenceSlider = (
    key: 'safeBoldPreference' | 'practicalExpressivePreference' | 'polishedEffortlessPreference',
    frac: number,
  ) => {
    setForm((f) => ({ ...f, [key]: frac }))
  }

  return (
    <>
      <div className="relative overflow-hidden bg-gradient-to-b from-violet-100/80 via-fuchsia-50/50 to-neutral-100 border-b border-neutral-200/60">
        <div className="pointer-events-none absolute -top-20 -right-10 h-72 w-72 rounded-full bg-violet-300/35 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute top-10 -left-16 h-56 w-56 rounded-full bg-fuchsia-300/25 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute bottom-0 left-1/3 h-32 w-96 rounded-full bg-rose-200/20 blur-3xl" aria-hidden />

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-8">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}>
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="p-3.5 rounded-2xl bg-gradient-to-br from-violet-600 to-fuchsia-500 text-white shadow-lg shadow-violet-500/30 ring-4 ring-white/50">
                  <GitCompare className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-violet-600/80 mb-1">Style decision lab</p>
                  <h1 className="font-display text-3xl sm:text-4xl font-bold text-neutral-900 tracking-tight">Compare</h1>
                  <p className="text-sm text-neutral-600 mt-2 max-w-lg leading-relaxed">
                    Pick 2–5 pieces, set your goal and vibe sliders, then get a structured read — not just a single
                    &quot;winner.&quot;
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {productIds.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="py-16 max-w-lg mx-auto text-center"
          >
            <div className="relative w-24 h-24 mx-auto mb-6">
              <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-violet-500 to-fuchsia-500 opacity-15 blur-xl" />
              <div className="relative w-24 h-24 rounded-3xl bg-gradient-to-br from-violet-100 to-fuchsia-100 flex items-center justify-center">
                <GitCompare className="w-10 h-10 text-violet-600" />
              </div>
            </div>
            <h2 className="font-display text-xl font-bold text-neutral-900 mb-2">No products to compare</h2>
            <p className="text-neutral-500 mb-8">Browse the shop and tap the compare button on any product card.</p>
            <Link
              href="/products"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-500 text-white font-semibold shadow-lg shadow-violet-500/20 hover:from-violet-500 hover:to-fuchsia-400 active:scale-[0.97] transition-all"
            >
              Browse products
              <ArrowRight className="w-4 h-4" />
            </Link>
          </motion.div>
        ) : (
          <>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
              <div>
                <p className="text-sm font-medium text-neutral-500">
                  {productIds.length} in compare tray ·{' '}
                  <span className="text-neutral-800">{selectedForCompare.length} selected for analysis</span>
                  {!canCompare && selectedForCompare.length > 0 && (
                    <span className="ml-1.5 text-amber-600">(pick at least 2)</span>
                  )}
                </p>
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <button
                    type="button"
                    onClick={selectAllInTray}
                    className="text-xs font-semibold text-violet-600 hover:text-violet-800"
                  >
                    Select all
                  </button>
                  <span className="text-neutral-300" aria-hidden>
                    |
                  </span>
                  <button
                    type="button"
                    onClick={clearCompareSelection}
                    className="text-xs font-semibold text-neutral-500 hover:text-neutral-800"
                  >
                    Clear selection
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2.5 shrink-0">
                <button type="button" onClick={clear} className="text-sm text-neutral-400 hover:text-rose-500 transition-colors">
                  Remove all from tray
                </button>
                {canCompare && (
                  <button
                    type="button"
                    onClick={runCompare}
                    disabled={compareMutation.isPending}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-500 text-white font-semibold shadow-md shadow-violet-500/20 hover:from-violet-500 hover:to-fuchsia-400 active:scale-[0.97] transition-all disabled:opacity-60"
                  >
                    {compareMutation.isPending ? (
                      <>
                        <div className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        Compare now
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>

            <div className="flex gap-4 overflow-x-auto pb-4 -mx-1 px-1 snap-x snap-mandatory scrollbar-thin mb-6">
              {loadingProducts
                ? [...Array(productIds.length)].map((_, i) => (
                    <div key={i} className="flex-shrink-0 w-44 space-y-2 snap-start">
                      <div className="aspect-[3/4] rounded-2xl skeleton-shimmer ring-1 ring-neutral-200/60" />
                      <div className="h-3 w-2/3 rounded-md skeleton-shimmer" />
                    </div>
                  ))
                : products?.map((p, i) => {
                    const isFirstPick = form.firstAttractionProductId === p.id
                    const isSelectedForRun = selectedForCompare.includes(p.id)
                    return (
                      <motion.div
                        key={p.id}
                        initial={{ opacity: 0, scale: 0.9, y: 16 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        transition={{ delay: i * 0.08, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                        className="relative flex-shrink-0 w-44 snap-start group"
                      >
                        <button
                          type="button"
                          onClick={() => toggleCompareSelection(p.id)}
                          className={`absolute top-2 left-2 z-10 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide shadow-md border transition-all ${
                            isSelectedForRun
                              ? 'bg-violet-600 text-white border-violet-500'
                              : 'bg-white/95 text-neutral-500 border-neutral-200 hover:border-violet-300'
                          }`}
                          aria-pressed={isSelectedForRun}
                        >
                          <span
                            className={`flex h-3.5 w-3.5 items-center justify-center rounded border ${
                              isSelectedForRun ? 'border-white bg-white/20' : 'border-neutral-300 bg-white'
                            }`}
                            aria-hidden
                          >
                            {isSelectedForRun ? '✓' : ''}
                          </span>
                          Compare
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(p.id)}
                          className="absolute -top-1.5 -right-1.5 z-10 p-1.5 rounded-full bg-white shadow-md border border-neutral-200 text-neutral-400 hover:text-rose-500 hover:border-rose-200 transition-all opacity-0 group-hover:opacity-100"
                          aria-label="Remove from compare tray"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={!isSelectedForRun}
                          onClick={() =>
                            setForm((f) => ({
                              ...f,
                              firstAttractionProductId: f.firstAttractionProductId === p.id ? undefined : p.id,
                            }))
                          }
                          className={`absolute top-10 right-2 z-10 px-2 py-1 rounded-full text-[10px] font-bold uppercase shadow border transition-all ${
                            !isSelectedForRun
                              ? 'bg-neutral-100/90 text-neutral-400 border-neutral-200 cursor-not-allowed'
                              : isFirstPick
                                ? 'bg-violet-600 text-white border-violet-500'
                                : 'bg-white/95 text-neutral-500 border-neutral-200 opacity-0 group-hover:opacity-100'
                          }`}
                        >
                          1st glance
                        </button>
                        <Link href={`/products/${p.id}`} className="block">
                          <div className="aspect-[3/4] rounded-2xl overflow-hidden bg-neutral-100 ring-1 ring-neutral-200/60">
                            <Image
                              src={p.image_cdn || p.image_url || 'https://placehold.co/176x220/f5f5f5/737373?text=No+Image'}
                              alt={p.title}
                              width={176}
                              height={220}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                            />
                          </div>
                          <div className="mt-2 px-0.5">
                            <p className="text-xs font-semibold text-violet-600 uppercase tracking-wider">{p.brand || p.category || ''}</p>
                            <p className="text-sm font-medium text-neutral-800 line-clamp-1 mt-0.5">{p.title}</p>
                            <p className="text-sm font-bold text-neutral-900 mt-0.5">{formatPrice(p.price_cents)}</p>
                          </div>
                        </Link>
                      </motion.div>
                    )
                  })}
            </div>

            <div className="relative rounded-3xl mb-8 p-[1px] bg-gradient-to-br from-violet-200 via-fuchsia-200/80 to-rose-200/60 shadow-xl shadow-violet-500/10">
              <div className="rounded-[1.4rem] bg-white p-5 sm:p-7">
              <div className="flex items-center gap-3 mb-2">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
                  <SlidersHorizontal className="w-5 h-5" />
                </span>
                <div>
                  <h2 className="font-display font-bold text-lg text-neutral-900">Tune the decision</h2>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    Optional — goal, occasion, alter ego, and three vibe axes shape the API read.
                  </p>
                </div>
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
                <div>
                  <label className="block text-xs font-semibold text-neutral-500 uppercase mb-1.5">Goal</label>
                  <select
                    className="w-full rounded-xl border border-neutral-200 bg-neutral-50/90 px-3 py-2.5 text-sm text-neutral-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-violet-400/40 focus:border-violet-300"
                    value={form.compareGoal ?? ''}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        compareGoal: (e.target.value || undefined) as CompareGoal | undefined,
                      }))
                    }
                  >
                    <option value="">Auto / none</option>
                    {GOAL_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-neutral-500 uppercase mb-1.5">Occasion</label>
                  <select
                    className="w-full rounded-xl border border-neutral-200 bg-neutral-50/90 px-3 py-2.5 text-sm text-neutral-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-violet-400/40 focus:border-violet-300"
                    value={form.occasion ?? ''}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        occasion: (e.target.value || undefined) as CompareOccasion | undefined,
                      }))
                    }
                  >
                    <option value="">Not specified</option>
                    {OCCASION_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2 flex items-end">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-neutral-300 text-violet-600"
                      checked={form.mode === 'alter_ego'}
                      onChange={(e) => setForm((f) => ({ ...f, mode: e.target.checked ? 'alter_ego' : 'standard' }))}
                    />
                    <span className="text-sm text-neutral-800">Alter ego mode</span>
                  </label>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-neutral-500 uppercase mb-1.5">Current self (tags)</label>
                  <input
                    type="text"
                    className="w-full rounded-xl border border-neutral-200 bg-neutral-50/90 px-3 py-2.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-violet-400/40 focus:border-violet-300"
                    placeholder="e.g. minimal, practical, office"
                    value={form.currentSelfRaw}
                    onChange={(e) => setForm((f) => ({ ...f, currentSelfRaw: e.target.value }))}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-neutral-500 uppercase mb-1.5">Aspirational self (tags)</label>
                  <input
                    type="text"
                    className="w-full rounded-xl border border-neutral-200 bg-neutral-50/90 px-3 py-2.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-violet-400/40 focus:border-violet-300"
                    placeholder="e.g. bold, artful, statement"
                    value={form.aspirationalSelfRaw}
                    onChange={(e) => setForm((f) => ({ ...f, aspirationalSelfRaw: e.target.value }))}
                  />
                </div>
              </div>
              <div className="grid sm:grid-cols-3 gap-5 mt-6 pt-6 border-t border-neutral-100">
                <div className="rounded-2xl bg-neutral-50/80 px-3 py-3 ring-1 ring-neutral-200/60">
                  <label className="block text-xs font-medium text-neutral-700 mb-2">
                    Safe <span className="text-neutral-400">↔</span> bold{' '}
                    <span className="float-right tabular-nums font-bold text-violet-700">{sliderPct(form.safeBoldPreference)}%</span>
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={sliderPct(form.safeBoldPreference)}
                    onChange={(e) => setPreferenceSlider('safeBoldPreference', Number(e.target.value) / 100)}
                    className="w-full h-2 rounded-full accent-violet-600"
                  />
                </div>
                <div className="rounded-2xl bg-neutral-50/80 px-3 py-3 ring-1 ring-neutral-200/60">
                  <label className="block text-xs font-medium text-neutral-700 mb-2">
                    Practical <span className="text-neutral-400">↔</span> expressive{' '}
                    <span className="float-right tabular-nums font-bold text-violet-700">
                      {sliderPct(form.practicalExpressivePreference)}%
                    </span>
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={sliderPct(form.practicalExpressivePreference)}
                    onChange={(e) => setPreferenceSlider('practicalExpressivePreference', Number(e.target.value) / 100)}
                    className="w-full h-2 rounded-full accent-violet-600"
                  />
                </div>
                <div className="rounded-2xl bg-neutral-50/80 px-3 py-3 ring-1 ring-neutral-200/60">
                  <label className="block text-xs font-medium text-neutral-700 mb-2">
                    Polished <span className="text-neutral-400">↔</span> effortless{' '}
                    <span className="float-right tabular-nums font-bold text-violet-700">
                      {sliderPct(form.polishedEffortlessPreference)}%
                    </span>
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={sliderPct(form.polishedEffortlessPreference)}
                    onChange={(e) => setPreferenceSlider('polishedEffortlessPreference', Number(e.target.value) / 100)}
                    className="w-full h-2 rounded-full accent-violet-600"
                  />
                </div>
              </div>
              </div>
            </div>

            {compareMutation.isError && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-start gap-3 p-4 rounded-2xl bg-rose-50 border border-rose-200/60 text-rose-800 mb-8"
              >
                <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <p className="text-sm">{(compareMutation.error as Error)?.message ?? 'Comparison failed'}</p>
              </motion.div>
            )}

            <AnimatePresence>
              {compareResult && (
                <CompareDecisionResults
                  result={compareResult}
                  products={products?.filter((p) => selectedForCompare.includes(p.id)) ?? []}
                />
              )}
            </AnimatePresence>
          </>
        )}
      </div>
    </>
  )
}