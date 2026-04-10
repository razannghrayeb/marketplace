'use client'

import { useState } from 'react'
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
    mutationFn: async (): Promise<CompareDecisionResponse> => {
      const body = buildCompareDecisionRequest(productIds, form)
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
  const canCompare = productIds.length >= 2 && productIds.length <= 5

  const runCompare = () => {
    if (canCompare) compareMutation.mutate()
  }

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
      <div className="relative overflow-hidden bg-gradient-to-b from-violet-50 via-fuchsia-50/40 to-neutral-100 border-b border-neutral-200/60">
        <div className="pointer-events-none absolute -top-16 -right-16 h-64 w-64 rounded-full bg-violet-200/40 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute top-8 -left-12 h-48 w-48 rounded-full bg-fuchsia-200/30 blur-3xl" aria-hidden />

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-6">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-md shadow-violet-500/20">
                <GitCompare className="w-5 h-5" />
              </div>
              <div>
                <h1 className="font-display text-2xl sm:text-3xl font-bold text-neutral-900">Compare Products</h1>
                <p className="text-sm text-neutral-500 mt-0.5">
                  Decision journey — select 2–5 products, tune goal & signals, then analyze
                </p>
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
            <div className="flex items-center justify-between mb-5">
              <p className="text-sm font-medium text-neutral-500">
                {productIds.length} product{productIds.length !== 1 ? 's' : ''} selected
                {!canCompare && <span className="ml-1.5 text-amber-600">(need at least 2)</span>}
              </p>
              <div className="flex items-center gap-2.5">
                <button type="button" onClick={clear} className="text-sm text-neutral-400 hover:text-rose-500 transition-colors">
                  Clear all
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
                          onClick={() => remove(p.id)}
                          className="absolute -top-1.5 -right-1.5 z-10 p-1.5 rounded-full bg-white shadow-md border border-neutral-200 text-neutral-400 hover:text-rose-500 hover:border-rose-200 transition-all opacity-0 group-hover:opacity-100"
                          aria-label="Remove from compare"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setForm((f) => ({
                              ...f,
                              firstAttractionProductId: f.firstAttractionProductId === p.id ? undefined : p.id,
                            }))
                          }
                          className={`absolute top-10 -right-1.5 z-10 px-2 py-1 rounded-full text-[10px] font-bold uppercase shadow border transition-all ${
                            isFirstPick
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

            <div className="rounded-3xl border border-neutral-200/70 bg-white p-5 sm:p-6 shadow-sm mb-8">
              <div className="flex items-center gap-2 mb-4 text-neutral-800 font-semibold">
                <SlidersHorizontal className="w-4 h-4 text-violet-600" />
                Decision inputs
              </div>
              <p className="text-xs text-neutral-500 mb-4">
                Optional: set goal and occasion, mark which piece grabbed you first (&quot;1st glance&quot; on cards), or open Alter ego for a bolder read.
              </p>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-neutral-500 uppercase mb-1.5">Goal</label>
                  <select
                    className="w-full rounded-xl border border-neutral-200 bg-neutral-50/80 px-3 py-2 text-sm text-neutral-900"
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
                    className="w-full rounded-xl border border-neutral-200 bg-neutral-50/80 px-3 py-2 text-sm text-neutral-900"
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
                    className="w-full rounded-xl border border-neutral-200 bg-neutral-50/80 px-3 py-2 text-sm"
                    placeholder="e.g. minimal, practical, office"
                    value={form.currentSelfRaw}
                    onChange={(e) => setForm((f) => ({ ...f, currentSelfRaw: e.target.value }))}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-neutral-500 uppercase mb-1.5">Aspirational self (tags)</label>
                  <input
                    type="text"
                    className="w-full rounded-xl border border-neutral-200 bg-neutral-50/80 px-3 py-2 text-sm"
                    placeholder="e.g. bold, artful, statement"
                    value={form.aspirationalSelfRaw}
                    onChange={(e) => setForm((f) => ({ ...f, aspirationalSelfRaw: e.target.value }))}
                  />
                </div>
              </div>
              <div className="grid sm:grid-cols-3 gap-4 mt-5 pt-5 border-t border-neutral-100">
                <div>
                  <label className="block text-xs text-neutral-600 mb-1">Safe ↔ bold ({sliderPct(form.safeBoldPreference)}%)</label>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={sliderPct(form.safeBoldPreference)}
                    onChange={(e) => setPreferenceSlider('safeBoldPreference', Number(e.target.value) / 100)}
                    className="w-full accent-violet-600"
                  />
                </div>
                <div>
                  <label className="block text-xs text-neutral-600 mb-1">
                    Practical ↔ expressive ({sliderPct(form.practicalExpressivePreference)}%)
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={sliderPct(form.practicalExpressivePreference)}
                    onChange={(e) => setPreferenceSlider('practicalExpressivePreference', Number(e.target.value) / 100)}
                    className="w-full accent-violet-600"
                  />
                </div>
                <div>
                  <label className="block text-xs text-neutral-600 mb-1">
                    Polished ↔ effortless ({sliderPct(form.polishedEffortlessPreference)}%)
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={sliderPct(form.polishedEffortlessPreference)}
                    onChange={(e) => setPreferenceSlider('polishedEffortlessPreference', Number(e.target.value) / 100)}
                    className="w-full accent-violet-600"
                  />
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
              {compareResult && <CompareDecisionResults result={compareResult} products={products} />}
            </AnimatePresence>
          </>
        )}
      </div>
    </>
  )
}