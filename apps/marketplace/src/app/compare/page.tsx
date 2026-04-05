'use client'

import { useQuery, useMutation } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { GitCompare, X, CheckCircle, Trophy, Sparkles, BarChart3 } from 'lucide-react'
import Link from 'next/link'
import Image from 'next/image'
import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'
import { useCompareStore } from '@/store/compare'
import type { Product } from '@/types/product'
import { useState } from 'react'
import {
  buildCompareDecisionRequest,
  getAttractionState,
  getConsequenceByProductId,
  getIdentityAlignmentByProductId,
  getModeLabel,
  getProductInsightById,
  getRegretByProductId,
  type CompareDecisionResponse,
  type CompareGoal,
  type CompareOccasion,
  type CompareBusinessMode,
} from '@/features/compare'

function ScoreRing({ score, color, size = 72 }: { score: number; color: string; size?: number }) {
  const radius = (size - 8) / 2
  const circ = 2 * Math.PI * radius
  const pct = Math.max(0, Math.min(100, score))
  const offset = circ - (pct / 100) * circ

  const strokeColor =
    color === 'green' ? '#22c55e' : color === 'yellow' ? '#eab308' : '#ef4444'
  const bgColor =
    color === 'green' ? '#dcfce7' : color === 'yellow' ? '#fef9c3' : '#fee2e2'

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={bgColor} strokeWidth={6} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={strokeColor}
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={circ}
          initial={{ strokeDashoffset: circ }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1], delay: 0.3 }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <motion.span
          className="text-lg font-bold text-neutral-800"
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.6, duration: 0.4 }}
        >
          {score}
        </motion.span>
      </div>
    </div>
  )
}

export default function ComparePage() {
  const { productIds, remove, clear } = useCompareStore()
  const [compareGoal, setCompareGoal] = useState<CompareGoal>('best_value')
  const [occasion, setOccasion] = useState<CompareOccasion | ''>('')
  const [mode, setMode] = useState<CompareBusinessMode>('standard')
  const [currentSelf, setCurrentSelf] = useState('')
  const [aspirationalSelf, setAspirationalSelf] = useState('')
  const [firstAttractionProductId, setFirstAttractionProductId] = useState<number | undefined>(undefined)
  const [safeBoldPreference, setSafeBoldPreference] = useState(0.5)
  const [practicalExpressivePreference, setPracticalExpressivePreference] = useState(0.5)
  const [polishedEffortlessPreference, setPolishedEffortlessPreference] = useState(0.5)

  const { data: products, isLoading: loadingProducts } = useQuery({
    queryKey: ['compare-products', productIds],
    queryFn: async () => {
      const results: Product[] = []
      for (const id of productIds) {
        const res = await api.get(endpoints.products.byId(id)) as Record<string, unknown>
        const p = (res?.data ?? res) as Product | undefined
        if (p && typeof p === 'object' && 'id' in p) results.push(p)
      }
      return results
    },
    enabled: productIds.length > 0,
  })

  const compareMutation = useMutation({
    mutationFn: async () => {
      const payload = buildCompareDecisionRequest({
        productIds,
        compareGoal,
        occasion,
        mode,
        currentSelf,
        aspirationalSelf,
        firstAttractionProductId,
        safeBoldPreference,
        practicalExpressivePreference,
        polishedEffortlessPreference,
      })
      const res = await api.post<CompareDecisionResponse>(endpoints.compare.root, payload) as Record<string, unknown>
      if (res?.success === false) throw new Error((res?.error as { message?: string })?.message)
      return (res?.data ?? res) as CompareDecisionResponse
    },
  })

  const compareResult = compareMutation.data
  const canCompare = productIds.length >= 2 && productIds.length <= 5
  const productLetterMap = new Map<number, string>()
  productIds.forEach((id, idx) => productLetterMap.set(id, String.fromCharCode(65 + idx)))

  const attractionState = getAttractionState(compareResult)
  const modeLabel = getModeLabel(compareResult?.comparisonMode)

  const getProductLetter = (productId: number | null | undefined) => {
    if (!productId) return null
    return productLetterMap.get(productId) ?? String(productId)
  }

  const runCompare = () => {
    if (canCompare) compareMutation.mutate()
  }

  const formatPrice = (cents: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(cents / 100)

  return (
    <>
      {/* ── Header ── */}
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
                  AI-powered quality comparison — select 2–5 products
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
            {/* Product strip */}
            <div className="flex items-center justify-between mb-5">
              <p className="text-sm font-medium text-neutral-500">
                {productIds.length} product{productIds.length !== 1 ? 's' : ''} selected
                {!canCompare && <span className="ml-1.5 text-amber-600">(need at least 2)</span>}
              </p>
              <div className="flex items-center gap-2.5">
                <select
                  value={compareGoal}
                  onChange={(e) => setCompareGoal(e.target.value as typeof compareGoal)}
                  className="rounded-full border border-neutral-200 bg-white px-3 py-2 text-xs font-medium text-neutral-700"
                >
                  <option value="best_value">Best value</option>
                  <option value="premium_quality">Premium quality</option>
                  <option value="style_match">Style match</option>
                  <option value="low_risk_return">Low risk return</option>
                  <option value="occasion_fit">Occasion fit</option>
                </select>
                <select
                  value={occasion}
                  onChange={(e) => setOccasion(e.target.value as typeof occasion)}
                  className="rounded-full border border-neutral-200 bg-white px-3 py-2 text-xs font-medium text-neutral-700"
                >
                  <option value="">Any occasion</option>
                  <option value="casual">Casual</option>
                  <option value="work">Work</option>
                  <option value="formal">Formal</option>
                  <option value="party">Party</option>
                  <option value="travel">Travel</option>
                </select>
                <button
                  onClick={() => setMode((prev) => (prev === 'standard' ? 'alter_ego' : 'standard'))}
                  className={`rounded-full border px-3 py-2 text-xs font-medium transition-colors ${
                    mode === 'alter_ego'
                      ? 'border-fuchsia-300 bg-fuchsia-50 text-fuchsia-700'
                      : 'border-neutral-200 bg-white text-neutral-700'
                  }`}
                >
                  {mode === 'alter_ego' ? 'Alter ego on' : 'Alter ego off'}
                </button>
                <button onClick={clear} className="text-sm text-neutral-400 hover:text-rose-500 transition-colors">
                  Clear all
                </button>
                {canCompare && (
                  <button
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

            {/* Product cards in a horizontal scrollable strip */}
            <div className="flex gap-4 overflow-x-auto pb-4 -mx-1 px-1 snap-x snap-mandatory scrollbar-thin mb-8">
              {loadingProducts
                ? [...Array(productIds.length)].map((_, i) => (
                    <div key={i} className="flex-shrink-0 w-44 space-y-2 snap-start">
                      <div className="aspect-[3/4] rounded-2xl skeleton-shimmer ring-1 ring-neutral-200/60" />
                      <div className="h-3 w-2/3 rounded-md skeleton-shimmer" />
                    </div>
                  ))
                : products?.map((p, i) => (
                    <motion.div
                      key={p.id}
                      initial={{ opacity: 0, scale: 0.9, y: 16 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      transition={{ delay: i * 0.08, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                      className="relative flex-shrink-0 w-44 snap-start group"
                    >
                      <button
                        onClick={() => remove(p.id)}
                        className="absolute -top-1.5 -right-1.5 z-10 p-1.5 rounded-full bg-white shadow-md border border-neutral-200 text-neutral-400 hover:text-rose-500 hover:border-rose-200 transition-all opacity-0 group-hover:opacity-100"
                        aria-label="Remove from compare"
                      >
                        <X className="w-3.5 h-3.5" />
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
                          <button
                            onClick={(e) => {
                              e.preventDefault()
                              setFirstAttractionProductId(p.id)
                            }}
                            className={`mt-1 text-[11px] font-medium ${firstAttractionProductId === p.id ? 'text-fuchsia-600' : 'text-neutral-400 hover:text-neutral-600'}`}
                          >
                            {firstAttractionProductId === p.id ? 'First attraction' : 'Set first attraction'}
                          </button>
                        </div>
                      </Link>
                    </motion.div>
                  ))}
            </div>

            <div className="mb-8 rounded-2xl border border-neutral-200/70 bg-white p-4 sm:p-5">
              <p className="text-sm font-semibold text-neutral-900 mb-3">Identity and preference signals</p>
              <div className="grid lg:grid-cols-2 gap-4 mb-4">
                <textarea
                  value={currentSelf}
                  onChange={(e) => setCurrentSelf(e.target.value)}
                  placeholder="Current self tags (comma separated): minimalist, practical, office"
                  className="w-full min-h-[88px] rounded-xl border border-neutral-200 px-3 py-2 text-sm text-neutral-700"
                />
                <textarea
                  value={aspirationalSelf}
                  onChange={(e) => setAspirationalSelf(e.target.value)}
                  placeholder="Aspirational self tags (comma separated): bold, creative, statement"
                  className="w-full min-h-[88px] rounded-xl border border-neutral-200 px-3 py-2 text-sm text-neutral-700"
                />
              </div>
              <div className="grid md:grid-cols-3 gap-4">
                <label className="text-xs text-neutral-500">
                  Safe ↔ Bold ({safeBoldPreference.toFixed(2)})
                  <input type="range" min={0} max={1} step={0.01} value={safeBoldPreference} onChange={(e) => setSafeBoldPreference(Number(e.target.value))} className="w-full mt-1" />
                </label>
                <label className="text-xs text-neutral-500">
                  Practical ↔ Expressive ({practicalExpressivePreference.toFixed(2)})
                  <input type="range" min={0} max={1} step={0.01} value={practicalExpressivePreference} onChange={(e) => setPracticalExpressivePreference(Number(e.target.value))} className="w-full mt-1" />
                </label>
                <label className="text-xs text-neutral-500">
                  Polished ↔ Effortless ({polishedEffortlessPreference.toFixed(2)})
                  <input type="range" min={0} max={1} step={0.01} value={polishedEffortlessPreference} onChange={(e) => setPolishedEffortlessPreference(Number(e.target.value))} className="w-full mt-1" />
                </label>
              </div>
            </div>

            {/* Error */}
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

            {/* Results */}
            <AnimatePresence>
              {compareResult && (
                <motion.div
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                  className="space-y-8"
                >
                  {/* Decision summary */}
                  <div className="relative overflow-hidden rounded-3xl border border-neutral-200/60 bg-white shadow-lg">
                    <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-violet-500 via-fuchsia-500 to-rose-400" />
                    <div className="p-6 sm:p-8">
                      <div className="flex items-start gap-4 mb-5">
                        <div className="p-2.5 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-md shadow-amber-500/20 flex-shrink-0">
                          <Trophy className="w-5 h-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h2 className="font-display text-xl sm:text-2xl font-bold text-neutral-900">
                            {modeLabel}
                          </h2>
                          <p className="text-neutral-500 mt-1">{compareResult.comparisonContext.modeReason}</p>
                        </div>
                      </div>

                      {compareResult.stepInsights.visualDifferences?.length > 0 && (
                        <div className="flex flex-wrap gap-2.5 mb-5">
                          {compareResult.stepInsights.visualDifferences.slice(0, 4).map((b, i) => (
                            <motion.span
                              key={i}
                              initial={{ opacity: 0, x: -10 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: 0.3 + i * 0.1 }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-neutral-100 text-sm text-neutral-700"
                            >
                              <CheckCircle className="w-3.5 h-3.5 text-violet-500 flex-shrink-0" />
                              {b}
                            </motion.span>
                          ))}
                        </div>
                      )}

                      {compareResult.comparisonMode === 'outfit_compare' && (
                        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                          <p className="text-sm font-medium text-amber-800">Smart compare mode active</p>
                          <p className="text-xs text-amber-700 mt-1">{compareResult.comparisonContext.modeReason}</p>
                        </div>
                      )}

                      <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-violet-50 to-fuchsia-50 border border-violet-100">
                        <Sparkles className="w-4 h-4 text-violet-600 flex-shrink-0" />
                        <p className="text-sm font-medium text-violet-800">Data quality score: {compareResult.comparisonContext.dataQuality.overallScore}</p>
                      </div>
                    </div>
                  </div>

                  {attractionState.enabled && (
                    <div className="rounded-3xl border border-neutral-200/60 bg-white p-6 sm:p-8 shadow-sm">
                      <h3 className="font-display text-lg font-bold text-neutral-900 mb-4">Attraction snapshot</h3>
                      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
                        {attractionState.attractionScores.map((row) => (
                          <p key={row.productId} className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-sm text-neutral-700">
                            Product {getProductLetter(row.productId)} attraction score: <span className="font-semibold">{row.score}</span>
                          </p>
                        ))}
                      </div>
                      {attractionState.explanation.map((line, idx) => (
                        <p key={idx} className="text-sm text-neutral-600 mb-1">• {line}</p>
                      ))}
                    </div>
                  )}

                  <div className="rounded-3xl border border-neutral-200/60 bg-white p-6 sm:p-8 shadow-sm">
                    <h3 className="font-display text-lg font-bold text-neutral-900 mb-4">Decision confidence</h3>
                    <p className="text-sm text-neutral-700 mb-2">
                      Level: <span className="font-semibold uppercase">{compareResult.decisionConfidence.level.replace('_', ' ')}</span>
                    </p>
                    <p className="text-sm text-neutral-700 mb-3">Score: {compareResult.decisionConfidence.score}</p>
                    {compareResult.decisionConfidence.explanation.map((line, idx) => (
                      <p key={idx} className="text-sm text-neutral-600">• {line}</p>
                    ))}
                  </div>

                  <div className="rounded-3xl border border-neutral-200/60 bg-white p-6 sm:p-8 shadow-sm">
                    <h3 className="font-display text-lg font-bold text-neutral-900 mb-4">Winners by context</h3>
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
                      {Object.entries(compareResult.winnersByContext).map(([key, value]) => (
                        <p key={key} className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2">
                          {key}: {value ? `Product ${getProductLetter(value)}` : 'N/A'}
                        </p>
                      ))}
                    </div>
                  </div>

                  {compareResult.whyNotBoth?.enabled && (
                    <div className="rounded-3xl border border-neutral-200/60 bg-white p-6 sm:p-8 shadow-sm">
                      <h3 className="font-display text-lg font-bold text-neutral-900 mb-4">Why not both?</h3>
                      {compareResult.whyNotBoth.explanation.map((line, idx) => (
                        <p key={idx} className="text-sm text-neutral-600">• {line}</p>
                      ))}
                      <div className="grid md:grid-cols-2 gap-3 mt-3 text-sm">
                        {compareResult.whyNotBoth.productRoles.map((r) => (
                          <p key={r.productId} className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2">Product {getProductLetter(r.productId)} role: {r.role}</p>
                        ))}
                      </div>
                    </div>
                  )}

                  {compareResult.outfitImpact?.enabled && (
                    <div className="rounded-3xl border border-neutral-200/60 bg-white p-6 sm:p-8 shadow-sm">
                      <h3 className="font-display text-lg font-bold text-neutral-900 mb-4">Outfit impact</h3>
                      {compareResult.outfitImpact.explanation.map((line, idx) => (
                        <p key={idx} className="text-sm text-neutral-600">• {line}</p>
                      ))}
                    </div>
                  )}

                  {compareResult.socialMirror?.enabled && (
                    <div className="rounded-3xl border border-neutral-200/60 bg-white p-6 sm:p-8 shadow-sm">
                      <h3 className="font-display text-lg font-bold text-neutral-900 mb-4">Social mirror</h3>
                      <div className="space-y-2 text-sm text-neutral-600">
                        {compareResult.socialMirror.explanation.map((item) => (
                          <p key={item.productId}>Product {getProductLetter(item.productId)}: {item.message}</p>
                        ))}
                      </div>
                    </div>
                  )}

                  {compareResult.peopleLikeYou?.enabled && (
                    <div className="rounded-3xl border border-neutral-200/60 bg-white p-6 sm:p-8 shadow-sm space-y-4">
                      <h3 className="font-display text-lg font-bold text-neutral-900">People like you</h3>
                      {compareResult.peopleLikeYou.explanation.map((line, idx) => (
                        <p key={idx} className="text-sm text-neutral-600">• {line}</p>
                      ))}
                      {compareResult.peopleLikeYou.notes?.map((line, idx) => (
                        <p key={`n-${idx}`} className="text-sm text-neutral-500">{line}</p>
                      ))}
                    </div>
                  )}

                  {compareResult.tensionAxes.length > 0 && (
                    <div className="rounded-3xl border border-neutral-200/60 bg-white p-6 sm:p-8 shadow-sm">
                      <h3 className="font-display text-lg font-bold text-neutral-900 mb-4">Tension axes</h3>
                      <div className="space-y-4">
                        {compareResult.tensionAxes.map((axis) => (
                          <div key={axis.axis} className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                            <p className="text-xs uppercase tracking-wider text-neutral-500 mb-2">{axis.axis.replace('_', ' ')}</p>
                            <div className="grid sm:grid-cols-2 gap-2 text-sm">
                              {axis.positions.map((p) => (
                                <p key={p.productId}>Product {getProductLetter(p.productId)}: {p.value}</p>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Product score cards */}
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
                    {productIds.map((productId, idx) => {
                      const product = products?.find((p) => p.id === productId)
                      const letter = getProductLetter(productId) ?? '?'
                      const insight = getProductInsightById(compareResult, productId)
                      const consequence = getConsequenceByProductId(compareResult, productId)
                      const regret = getRegretByProductId(compareResult, productId)
                      const identity = getIdentityAlignmentByProductId(compareResult, productId)
                      const overallWinnerId = compareResult.winnersByContext.overall
                      const isWinner = overallWinnerId === productId
                      const scoreColor: 'green' | 'yellow' | 'red' =
                        (insight?.scores.overall ?? 0) >= 70
                          ? 'green'
                          : (insight?.scores.overall ?? 0) >= 45
                            ? 'yellow'
                            : 'red'

                      return (
                        <motion.div
                          key={productId}
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.2 + idx * 0.12, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                          className={`relative rounded-2xl border bg-white shadow-sm overflow-hidden transition-shadow hover:shadow-lg ${
                            isWinner ? 'border-violet-300 ring-2 ring-violet-200/50' : 'border-neutral-200/80'
                          }`}
                        >
                          {isWinner && (
                            <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-violet-500 to-fuchsia-500" />
                          )}

                          <div className="p-5">
                            <div className="flex items-start gap-4">
                              {product && (
                                <Link href={`/products/${product.id}`} className="block flex-shrink-0">
                                  <div className="relative w-16 h-20 rounded-xl overflow-hidden bg-neutral-100 ring-1 ring-neutral-200/60">
                                    <Image
                                      src={product.image_cdn || product.image_url || 'https://placehold.co/64x80'}
                                      alt={product.title}
                                      fill
                                      className="object-cover"
                                    />
                                  </div>
                                </Link>
                              )}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1.5">
                                  <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-gradient-to-br from-violet-100 to-fuchsia-100 text-sm font-bold text-violet-700">
                                    {letter}
                                  </span>
                                  {isWinner && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[11px] font-bold uppercase tracking-wider">
                                      <Trophy className="w-3 h-3" />
                                      Winner
                                    </span>
                                  )}
                                </div>
                                <p className="font-semibold text-neutral-900 text-sm line-clamp-1">{product?.title}</p>
                                <p className="text-xs text-neutral-500 mt-0.5">{product?.brand ?? ''}</p>
                              </div>
                              <ScoreRing score={Math.round(insight?.scores.overall ?? 0)} color={scoreColor} />
                            </div>

                            {consequence?.ifYouChooseThis?.length ? (
                              <div className="mt-4 space-y-1.5">
                                {consequence.ifYouChooseThis.slice(0, 2).map((h, i) => (
                                  <div key={i} className="flex items-start gap-2 text-sm">
                                    <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                                    <span className="text-neutral-700">{h}</span>
                                  </div>
                                ))}
                              </div>
                            ) : null}

                            {regret ? (
                              <div className="mt-3 space-y-1.5">
                                <p className="text-sm text-neutral-600"><span className="font-medium">Regret flash:</span> {regret.shortTermFeeling} {'->'} {regret.longTermReality}</p>
                              </div>
                            ) : null}

                            {identity ? (
                              <div className="mt-3 rounded-xl bg-neutral-50 border border-neutral-200 px-3 py-2 text-xs text-neutral-600">
                                Current self: {identity.currentSelfScore} | Aspirational self: {identity.aspirationalSelfScore}
                              </div>
                            ) : null}

                            {insight ? (
                              <div className="mt-3 space-y-1 text-xs text-neutral-500">
                                <p>Friction: {insight.frictionIndex}</p>
                                <p>Wear est: {insight.wearFrequency.estimatedMonthlyWear}/month</p>
                                <p>Photo reality: {insight.photoRealityGap.label}</p>
                                <p>{insight.hiddenFlaw}</p>
                                <p className="text-neutral-700">{insight.microStory}</p>
                              </div>
                            ) : null}
                          </div>
                        </motion.div>
                      )
                    })}
                  </div>

                  {/* Confidence footer */}
                  {compareResult.decisionConfidence && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.8 }}
                      className="flex items-center justify-center gap-2 text-sm text-neutral-400"
                    >
                      <BarChart3 className="w-4 h-4" />
                      <span>Confidence: {compareResult.decisionConfidence.level.replace('_', ' ')}</span>
                      <span className="text-neutral-300"> — {compareResult.decisionConfidence.score}</span>
                    </motion.div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </div>
    </>
  )
}
