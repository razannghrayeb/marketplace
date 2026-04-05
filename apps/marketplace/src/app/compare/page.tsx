'use client'

import { useQuery, useMutation } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { GitCompare, X, CheckCircle, AlertTriangle, Trophy, ArrowRight, Sparkles, BarChart3 } from 'lucide-react'
import Link from 'next/link'
import Image from 'next/image'
import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'
import { useCompareStore } from '@/store/compare'
import { ProductCard } from '@/components/product/ProductCard'
import type { Product } from '@/types/product'
import { useState } from 'react'

interface ProductSummary {
  product_id: number
  level_label: string
  level_color: 'green' | 'yellow' | 'red'
  score: number
  highlights: string[]
  concerns: string[]
  tooltips: Record<string, string>
}

interface VerdictOutput {
  title: string
  subtitle: string
  bullet_points: string[]
  tradeoff: string | null
  confidence_label: string
  confidence_description: string
  recommendation: string
}

interface CompareResult {
  verdict: VerdictOutput
  product_summaries: ProductSummary[]
  comparison_details: {
    winner_id: number | null
    is_tie: boolean
    score_difference: number
  }
  comparison_context?: {
    mode: 'direct_head_to_head' | 'scenario_compare' | 'outfit_compare'
    comparable: boolean
    reason: string
    category_groups: Record<number, string>
    requested_goal: 'best_value' | 'premium_quality' | 'style_match' | 'low_risk_return' | 'occasion_fit'
    requested_occasion: 'casual' | 'work' | 'formal' | 'party' | 'travel' | null
  }
  shopping_insights?: {
    best_quality_product_id: number | null
    best_value_product_id: number | null
    best_budget_product_id: number | null
    weakest_link_product_id: number | null
    notes: string[]
    suggested_next_action: string
  }
  winners_by_goal?: {
    overall: number | null
    value: number | null
    quality: number | null
    style: number | null
    risk: number | null
    occasion: number | null
  }
  evidence?: string[]
  alternatives?: {
    better_cheaper_product_id: number | null
    better_quality_product_id: number | null
    similar_style_safer_product_id: number | null
  }
  risk_summary?: {
    overall_risk_level: 'low' | 'medium' | 'high'
    product_risks: Record<number, {
      risk_score: number
      risk_level: 'low' | 'medium' | 'high'
      reasons: string[]
    }>
  }
  timing_insight?: {
    recommendation: 'buy_now' | 'wait' | 'monitor'
    reason: string
  }
  outfit_impact?: {
    mode: 'outfit_compare'
    outfit_winner_product_id: number | null
    versatility_scores: Record<number, number>
    gap_fill_scores: Record<number, number>
  }
  product_map?: Record<number, string>
}

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
  const [compareGoal, setCompareGoal] = useState<'best_value' | 'premium_quality' | 'style_match' | 'low_risk_return' | 'occasion_fit'>('best_value')
  const [occasion, setOccasion] = useState<'casual' | 'work' | 'formal' | 'party' | 'travel' | ''>('')

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
      const body: Record<string, unknown> = {
        product_ids: productIds,
        compare_goal: compareGoal,
      }
      if (occasion) body.occasion = occasion
      const res = await api.post<CompareResult>(endpoints.compare.root, body) as Record<string, unknown>
      if (res?.success === false) throw new Error((res?.error as { message?: string })?.message)
      return (res?.data ?? res) as CompareResult
    },
  })

  const compareResult = compareMutation.data
  const canCompare = productIds.length >= 2 && productIds.length <= 5

  const getProductLetter = (productId: number | null | undefined) => {
    if (!productId) return null
    return compareResult?.product_map?.[productId] ?? String(productId)
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
                        </div>
                      </Link>
                    </motion.div>
                  ))}
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
                  {/* Verdict card */}
                  <div className="relative overflow-hidden rounded-3xl border border-neutral-200/60 bg-white shadow-lg">
                    <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-violet-500 via-fuchsia-500 to-rose-400" />
                    <div className="p-6 sm:p-8">
                      <div className="flex items-start gap-4 mb-5">
                        <div className="p-2.5 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-md shadow-amber-500/20 flex-shrink-0">
                          <Trophy className="w-5 h-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h2 className="font-display text-xl sm:text-2xl font-bold text-neutral-900">
                            {compareResult.verdict.title}
                          </h2>
                          <p className="text-neutral-500 mt-1">{compareResult.verdict.subtitle}</p>
                        </div>
                      </div>

                      {compareResult.verdict.bullet_points?.length > 0 && (
                        <div className="flex flex-wrap gap-2.5 mb-5">
                          {compareResult.verdict.bullet_points.map((b, i) => (
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

                      {compareResult.verdict.tradeoff && (
                        <p className="text-sm text-neutral-500 italic mb-4">{compareResult.verdict.tradeoff}</p>
                      )}

                      {compareResult.comparison_context && !compareResult.comparison_context.comparable && (
                        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                          <p className="text-sm font-medium text-amber-800">Smart compare mode active</p>
                          <p className="text-xs text-amber-700 mt-1">{compareResult.comparison_context.reason}</p>
                        </div>
                      )}

                      <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-violet-50 to-fuchsia-50 border border-violet-100">
                        <Sparkles className="w-4 h-4 text-violet-600 flex-shrink-0" />
                        <p className="text-sm font-medium text-violet-800">{compareResult.verdict.recommendation}</p>
                      </div>
                    </div>
                  </div>

                  {/* Shopping insights */}
                  {compareResult.shopping_insights && (
                    <div className="rounded-3xl border border-neutral-200/60 bg-white p-6 sm:p-8 shadow-sm">
                      <h3 className="font-display text-lg font-bold text-neutral-900 mb-4">Shopping insights</h3>
                      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                        <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2.5">
                          <p className="text-[11px] uppercase tracking-wider text-neutral-500">Best quality</p>
                          <p className="text-sm font-semibold text-neutral-900 mt-0.5">
                            {getProductLetter(compareResult.shopping_insights.best_quality_product_id) ? `Product ${getProductLetter(compareResult.shopping_insights.best_quality_product_id)}` : 'N/A'}
                          </p>
                        </div>
                        <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2.5">
                          <p className="text-[11px] uppercase tracking-wider text-neutral-500">Best value</p>
                          <p className="text-sm font-semibold text-neutral-900 mt-0.5">
                            {getProductLetter(compareResult.shopping_insights.best_value_product_id) ? `Product ${getProductLetter(compareResult.shopping_insights.best_value_product_id)}` : 'N/A'}
                          </p>
                        </div>
                        <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2.5">
                          <p className="text-[11px] uppercase tracking-wider text-neutral-500">Best budget</p>
                          <p className="text-sm font-semibold text-neutral-900 mt-0.5">
                            {getProductLetter(compareResult.shopping_insights.best_budget_product_id) ? `Product ${getProductLetter(compareResult.shopping_insights.best_budget_product_id)}` : 'N/A'}
                          </p>
                        </div>
                        <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2.5">
                          <p className="text-[11px] uppercase tracking-wider text-neutral-500">Needs review</p>
                          <p className="text-sm font-semibold text-neutral-900 mt-0.5">
                            {getProductLetter(compareResult.shopping_insights.weakest_link_product_id) ? `Product ${getProductLetter(compareResult.shopping_insights.weakest_link_product_id)}` : 'N/A'}
                          </p>
                        </div>
                      </div>

                      {compareResult.shopping_insights.notes?.length > 0 && (
                        <div className="space-y-2 mb-3">
                          {compareResult.shopping_insights.notes.map((note, i) => (
                            <p key={i} className="text-sm text-neutral-600">• {note}</p>
                          ))}
                        </div>
                      )}

                      <p className="text-sm font-medium text-violet-700">{compareResult.shopping_insights.suggested_next_action}</p>
                    </div>
                  )}

                  {compareResult.winners_by_goal && (
                    <div className="rounded-3xl border border-neutral-200/60 bg-white p-6 sm:p-8 shadow-sm">
                      <h3 className="font-display text-lg font-bold text-neutral-900 mb-4">Winners by customer goal</h3>
                      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
                        <p className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2">Overall: {getProductLetter(compareResult.winners_by_goal.overall) ? `Product ${getProductLetter(compareResult.winners_by_goal.overall)}` : 'N/A'}</p>
                        <p className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2">Value: {getProductLetter(compareResult.winners_by_goal.value) ? `Product ${getProductLetter(compareResult.winners_by_goal.value)}` : 'N/A'}</p>
                        <p className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2">Quality: {getProductLetter(compareResult.winners_by_goal.quality) ? `Product ${getProductLetter(compareResult.winners_by_goal.quality)}` : 'N/A'}</p>
                        <p className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2">Style: {getProductLetter(compareResult.winners_by_goal.style) ? `Product ${getProductLetter(compareResult.winners_by_goal.style)}` : 'N/A'}</p>
                        <p className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2">Risk: {getProductLetter(compareResult.winners_by_goal.risk) ? `Product ${getProductLetter(compareResult.winners_by_goal.risk)}` : 'N/A'}</p>
                        <p className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2">Occasion: {getProductLetter(compareResult.winners_by_goal.occasion) ? `Product ${getProductLetter(compareResult.winners_by_goal.occasion)}` : 'N/A'}</p>
                      </div>
                    </div>
                  )}

                  {(compareResult.risk_summary || compareResult.timing_insight || compareResult.alternatives) && (
                    <div className="rounded-3xl border border-neutral-200/60 bg-white p-6 sm:p-8 shadow-sm space-y-4">
                      <h3 className="font-display text-lg font-bold text-neutral-900">Purchase risk and timing</h3>
                      {compareResult.risk_summary && (
                        <p className="text-sm text-neutral-700">Overall risk level: <span className="font-semibold uppercase">{compareResult.risk_summary.overall_risk_level}</span></p>
                      )}
                      {compareResult.timing_insight && (
                        <p className="text-sm text-neutral-700">Timing: <span className="font-semibold">{compareResult.timing_insight.recommendation.replace('_', ' ')}</span> — {compareResult.timing_insight.reason}</p>
                      )}
                      {compareResult.alternatives && (
                        <div className="grid sm:grid-cols-3 gap-3 text-sm">
                          <p className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2">Better cheaper: {getProductLetter(compareResult.alternatives.better_cheaper_product_id) ? `Product ${getProductLetter(compareResult.alternatives.better_cheaper_product_id)}` : 'N/A'}</p>
                          <p className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2">Better quality: {getProductLetter(compareResult.alternatives.better_quality_product_id) ? `Product ${getProductLetter(compareResult.alternatives.better_quality_product_id)}` : 'N/A'}</p>
                          <p className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2">Style safer: {getProductLetter(compareResult.alternatives.similar_style_safer_product_id) ? `Product ${getProductLetter(compareResult.alternatives.similar_style_safer_product_id)}` : 'N/A'}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {compareResult.outfit_impact && (
                    <div className="rounded-3xl border border-neutral-200/60 bg-white p-6 sm:p-8 shadow-sm">
                      <h3 className="font-display text-lg font-bold text-neutral-900 mb-4">Outfit impact (cross-category)</h3>
                      <p className="text-sm text-neutral-700 mb-3">Outfit winner: {getProductLetter(compareResult.outfit_impact.outfit_winner_product_id) ? `Product ${getProductLetter(compareResult.outfit_impact.outfit_winner_product_id)}` : 'N/A'}</p>
                      <div className="space-y-2">
                        {Object.entries(compareResult.outfit_impact.versatility_scores).map(([id, score]) => (
                          <p key={id} className="text-sm text-neutral-600">Product {getProductLetter(Number(id)) ?? id}: versatility {score}, gap-fill {compareResult.outfit_impact?.gap_fill_scores?.[Number(id)] ?? 0}</p>
                        ))}
                      </div>
                    </div>
                  )}

                  {compareResult.evidence && compareResult.evidence.length > 0 && (
                    <div className="rounded-3xl border border-neutral-200/60 bg-white p-6 sm:p-8 shadow-sm">
                      <h3 className="font-display text-lg font-bold text-neutral-900 mb-4">Why this recommendation</h3>
                      <div className="space-y-2">
                        {compareResult.evidence.map((e, i) => (
                          <p key={i} className="text-sm text-neutral-600">• {e}</p>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Product score cards */}
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
                    {compareResult.product_summaries.map((summary, idx) => {
                      const product = products?.find((p) => p.id === summary.product_id)
                      const letter = compareResult.product_map?.[summary.product_id] ?? '?'
                      const isWinner = compareResult.comparison_details.winner_id === summary.product_id

                      return (
                        <motion.div
                          key={summary.product_id}
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
                              <ScoreRing score={summary.score} color={summary.level_color} />
                            </div>

                            {/* Highlights */}
                            {summary.highlights?.length > 0 && (
                              <div className="mt-4 space-y-1.5">
                                {summary.highlights.map((h, i) => (
                                  <div key={i} className="flex items-start gap-2 text-sm">
                                    <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                                    <span className="text-neutral-700">{h}</span>
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* Concerns */}
                            {summary.concerns?.length > 0 && (
                              <div className="mt-3 space-y-1.5">
                                {summary.concerns.map((c, i) => (
                                  <div key={i} className="flex items-start gap-2 text-sm">
                                    <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                                    <span className="text-neutral-600">{c}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </motion.div>
                      )
                    })}
                  </div>

                  {/* Confidence footer */}
                  {compareResult.verdict.confidence_label && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.8 }}
                      className="flex items-center justify-center gap-2 text-sm text-neutral-400"
                    >
                      <BarChart3 className="w-4 h-4" />
                      <span>Confidence: {compareResult.verdict.confidence_label}</span>
                      {compareResult.verdict.confidence_description && (
                        <span className="text-neutral-300"> — {compareResult.verdict.confidence_description}</span>
                      )}
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
