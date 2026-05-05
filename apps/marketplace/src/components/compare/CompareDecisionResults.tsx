'use client'

import { motion } from 'framer-motion'
import Image from 'next/image'
import Link from 'next/link'
import {
  BarChart3,
  CheckCircle,
  AlertTriangle,
  Sparkles,
  Split,
  Shirt,
  Users,
  Eye,
  GitCompare,
} from 'lucide-react'
import { ScoreRing, scoreToLevelColor } from '@/components/compare/ScoreRing'
import type { CompareDecisionResponse } from '@/types/compareDecision'
import { WINNER_CONTEXT_LABELS } from '@/types/compareDecision'
import type { Product } from '@/types/product'
import {
  getAttractionState,
  getConsequenceByProductId,
  getContextsWonByProduct,
  getIdentityAlignmentByProductId,
  getProductInsightById,
  getRegretFlashByProductId,
  normalizeScoreDisplay,
  productLetter,
} from '@/lib/compare-decision/selectors'

const CONFIDENCE_COPY: Record<CompareDecisionResponse['decisionConfidence']['level'], string> = {
  clear_choice: 'Clear choice',
  leaning_choice: 'Leaning',
  toss_up: 'Toss-up',
}

const MODE_COPY: Record<CompareDecisionResponse['comparisonMode'], string> = {
  direct_head_to_head: 'Head-to-head',
  scenario_compare: 'Scenario compare',
  outfit_compare: 'Outfit compare',
}

const PHOTO_LABEL_COPY: Record<
  CompareDecisionResponse['productInsights'][number]['photoRealityGap']['label'],
  string
> = {
  photo_stronger: 'Looks stronger on-screen',
  real_life_stronger: 'Stronger in real life',
  aligned: 'Photo matches reality',
}

const COMPLIMENT_COPY: Record<
  CompareDecisionResponse['productInsights'][number]['complimentPrediction']['type'],
  string
> = {
  direct_compliments: 'Direct compliments',
  subtle_admiration: 'Subtle admiration',
  polished_respect: 'Polished respect',
  stylish_attention: 'Stylish attention',
  low_reaction_high_utility: 'Quiet utility',
}

const GOAL_COPY: Record<string, string> = {
  best_value: 'Best value',
  premium_quality: 'Premium quality',
  style_match: 'Best style match',
  low_risk_return: 'Lowest return risk',
  occasion_fit: 'Best for the occasion',
}

function formatLabel(value: string): string {
  const normalized = value.trim()
  if (!normalized) return value
  return normalized
    .replace(/[_-]+/g, ' ')
    .split(/\s+/)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ')
}

function BulletList({ items, icon: Icon, tone }: { items: string[]; icon: typeof CheckCircle; tone: 'violet' | 'amber' | 'neutral' }) {
  if (!items.length) return null
  const iconCls =
    tone === 'violet' ? 'text-violet-500' : tone === 'amber' ? 'text-amber-500' : 'text-neutral-400'
  return (
    <ul className="space-y-2">
      {items.map((line, i) => (
        <li
          key={i}
          className="flex items-start gap-3 rounded-xl bg-neutral-50/90 px-3 py-2.5 text-sm text-neutral-700 ring-1 ring-neutral-200/50"
        >
          <Icon className={`w-4 h-4 flex-shrink-0 mt-0.5 ${iconCls}`} />
          <span className="leading-relaxed">{line}</span>
        </li>
      ))}
    </ul>
  )
}

function SectionHeader({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: typeof Sparkles
  title: string
  subtitle?: string
}) {
  return (
    <div className="mb-5">
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500/12 to-fuchsia-500/12 text-violet-600 ring-1 ring-inset ring-violet-200/50 shadow-sm">
          <Icon className="h-[22px] w-[22px]" strokeWidth={2} />
        </span>
        <div className="min-w-0 pt-0.5">
          <h3 className="font-display text-xl font-bold tracking-tight text-neutral-900">{title}</h3>
          {subtitle ? <p className="text-sm text-neutral-500 mt-1 leading-relaxed">{subtitle}</p> : null}
        </div>
      </div>
    </div>
  )
}

function MetricBar({ label, value }: { label: string; value: number }) {
  const v = Math.max(0, Math.min(100, value))
  return (
    <div>
      <div className="flex justify-between items-baseline gap-2 mb-1">
        <span className="text-[11px] font-medium text-neutral-500">{label}</span>
        <span className="text-[11px] font-bold tabular-nums text-neutral-800">{v}</span>
      </div>
      <div className="h-2 rounded-full bg-neutral-100 overflow-hidden ring-1 ring-inset ring-neutral-200/40">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-violet-500 via-fuchsia-500 to-rose-400"
          initial={{ width: 0 }}
          animate={{ width: `${v}%` }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.08 }}
        />
      </div>
    </div>
  )
}

function TensionAxisRow({
  axis,
  productIds,
}: {
  axis: CompareDecisionResponse['tensionAxes'][number]
  productIds: number[]
}) {
  const colors = [
    'bg-violet-500 shadow-violet-500/40',
    'bg-fuchsia-500 shadow-fuchsia-500/40',
    'bg-rose-500 shadow-rose-500/40',
    'bg-amber-500 shadow-amber-500/40',
    'bg-sky-500 shadow-sky-500/40',
  ]
  return (
    <div className="rounded-2xl border border-neutral-200/70 bg-gradient-to-b from-white to-neutral-50/80 p-5 shadow-md shadow-neutral-200/40 ring-1 ring-inset ring-white/60">
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-violet-600/90 mb-4">
        {axis.axis.replace(/_/g, ' ')}
      </p>
      <div className="flex justify-between text-xs font-medium text-neutral-600 mb-3 gap-4">
        <span className="text-left leading-snug text-violet-800/90">{axis.leftLabel}</span>
        <span className="text-right leading-snug text-fuchsia-800/90">{axis.rightLabel}</span>
      </div>
      <div className="relative h-11 rounded-full bg-gradient-to-r from-violet-100 via-neutral-100 to-fuchsia-100 border border-neutral-200/60 overflow-visible shadow-inner">
        <div className="absolute inset-y-2 left-3 right-3 rounded-full bg-white/60" aria-hidden />
        {axis.positions.map((p, i) => {
          const pct = Math.max(0, Math.min(100, p.value <= 1 ? p.value * 100 : p.value))
          const color = colors[i % colors.length]
          return (
            <div
              key={p.productId}
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-10 flex flex-col items-center group"
              style={{ left: `${pct}%` }}
              title={`${productLetter(productIds, p.productId)}: ${Math.round(pct)}`}
            >
              <span
                className={`w-4 h-4 rounded-full ${color} ring-[3px] ring-white shadow-lg transition-transform group-hover:scale-110`}
              />
              <span className="mt-1.5 text-[10px] font-bold tabular-nums text-neutral-700 bg-white/95 px-1.5 py-0.5 rounded-md border border-neutral-200/80 shadow-sm">
                {productLetter(productIds, p.productId)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function CompareDecisionResults({
  result,
  products,
}: {
  result: CompareDecisionResponse
  products: Product[] | undefined
}) {
  const ids = result.comparisonContext.productIds ?? []
  const attraction = getAttractionState(result)

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="space-y-8"
    >
      {/* Context + summary strip */}
      <div className="relative overflow-hidden rounded-3xl border border-neutral-200/50 bg-gradient-to-br from-white via-violet-50/30 to-fuchsia-50/20 p-6 sm:p-7 shadow-lg shadow-violet-500/5 ring-1 ring-inset ring-white/80">
        <div className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-fuchsia-300/20 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -left-16 bottom-0 h-40 w-40 rounded-full bg-violet-300/15 blur-3xl" aria-hidden />
        <div className="relative flex flex-col lg:flex-row lg:items-start lg:justify-between gap-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl bg-neutral-900 text-white text-xs font-bold uppercase tracking-wide shadow-md">
              <GitCompare className="w-4 h-4 opacity-90" />
              {MODE_COPY[result.comparisonMode]}
            </span>
            {result.requestedGoal && (
              <span className="inline-flex items-center rounded-xl border border-violet-200/80 bg-white/90 px-3 py-1.5 text-xs font-medium text-neutral-700 shadow-sm">
                Goal ·{' '}
                <span className="ml-1 font-semibold text-violet-800">{GOAL_COPY[result.requestedGoal] ?? formatLabel(result.requestedGoal)}</span>
              </span>
            )}
            {result.requestedOccasion && (
              <span className="inline-flex items-center rounded-xl border border-fuchsia-200/80 bg-white/90 px-3 py-1.5 text-xs font-medium text-neutral-700 shadow-sm">
                Occasion ·{' '}
                <span className="ml-1 font-semibold text-fuchsia-800">{formatLabel(result.requestedOccasion)}</span>
              </span>
            )}
          </div>
          <p className="text-sm text-neutral-600 leading-relaxed max-w-2xl lg:text-right lg:max-w-md">
            {result.comparisonContext.modeReason}
          </p>
        </div>
      </div>

      {/* Data quality */}
      {result.comparisonContext.dataQuality && (
        <div className="rounded-3xl border border-amber-200/60 bg-gradient-to-br from-amber-50 to-orange-50/40 px-5 py-4 shadow-md shadow-amber-500/5">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
            <span className="font-display font-bold text-amber-950">
              Data quality · {normalizeScoreDisplay(result.comparisonContext.dataQuality.overallScore)}
            </span>
          </div>
          {result.comparisonContext.dataQuality.notes?.length > 0 && (
            <BulletList items={result.comparisonContext.dataQuality.notes} icon={AlertTriangle} tone="amber" />
          )}
        </div>
      )}

      {/* Decision confidence */}
      <div className="relative overflow-hidden rounded-3xl border border-neutral-200/50 bg-white shadow-xl shadow-violet-500/10 ring-1 ring-inset ring-violet-100/50">
        <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-violet-500 via-fuchsia-500 to-rose-400" />
        <div className="p-6 sm:p-8 lg:p-10">
          <div className="flex flex-col md:flex-row md:items-center gap-8 md:gap-10">
            <div className="flex-1 min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full bg-violet-100 px-3 py-1 text-xs font-bold uppercase tracking-wider text-violet-800 mb-4">
                <BarChart3 className="w-3.5 h-3.5" />
                Decision read
              </div>
              <h2 className="font-display text-3xl sm:text-4xl font-bold text-neutral-900 tracking-tight">
                {CONFIDENCE_COPY[result.decisionConfidence.level]}
              </h2>
              <p className="text-neutral-500 mt-2 text-sm sm:text-base max-w-prose">
                How strongly the model separates these options for your goal and signals.
              </p>
            </div>
            <div className="flex justify-center md:justify-end shrink-0">
              <ScoreRing
                score={normalizeScoreDisplay(result.decisionConfidence.score)}
                color={scoreToLevelColor(normalizeScoreDisplay(result.decisionConfidence.score))}
                size={112}
                label="Confidence"
              />
            </div>
          </div>
          {result.decisionConfidence.explanation?.length > 0 && (
            <div className="mt-8 pt-8 border-t border-neutral-100">
              <p className="text-xs font-bold uppercase tracking-wider text-neutral-400 mb-4">Why</p>
              <BulletList items={result.decisionConfidence.explanation} icon={Sparkles} tone="violet" />
            </div>
          )}
        </div>
      </div>

      {/* Winners by context */}
      <div className="rounded-3xl border border-neutral-200/60 bg-white p-6 sm:p-8 shadow-lg shadow-neutral-200/30">
        <SectionHeader icon={GitCompare} title="Winners by context" subtitle="Who leads for each lens — tap through to the product cards below." />
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {(Object.keys(WINNER_CONTEXT_LABELS) as Array<keyof typeof WINNER_CONTEXT_LABELS>).map((key) => {
            const pid = result.winnersByContext[key]
            if (typeof pid !== 'number') return null
            const label = WINNER_CONTEXT_LABELS[key]
            const letter = productLetter(ids, pid)
            const title = products?.find((p) => p.id === pid)?.title
            const img = products?.find((p) => p.id === pid)
            return (
              <div
                key={key}
                className="group flex gap-3 rounded-2xl border border-neutral-200/70 bg-gradient-to-br from-white to-neutral-50/80 p-4 shadow-sm transition-all hover:border-violet-200 hover:shadow-md hover:shadow-violet-500/10"
              >
                <div className="relative h-16 w-12 shrink-0 overflow-hidden rounded-xl bg-neutral-100 ring-1 ring-neutral-200/60">
                  {img && (
                    <Image
                      src={img.image_cdn || img.image_url || 'https://placehold.co/48x64'}
                      alt={img.title}
                      fill
                      className="object-cover transition-transform group-hover:scale-105"
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-violet-600">{label}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-fuchsia-500 text-xs font-bold text-white shadow-sm">
                      {letter}
                    </span>
                    {title ? (
                      <p className="text-sm font-semibold text-neutral-900 line-clamp-2 leading-snug">{title}</p>
                    ) : null}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Attraction */}
      {attraction &&
        (attraction.explanation.length > 0 ||
          attraction.scores.length > 0 ||
          attraction.firstAttractionProductId != null) && (
        <div className="rounded-3xl border border-neutral-200/60 bg-white p-6 sm:p-8 shadow-lg shadow-neutral-200/20">
          <SectionHeader icon={Eye} title="Attraction" subtitle="First visual pull and relative draw between options." />
          {attraction.firstAttractionProductId != null && (
            <p className="text-sm text-neutral-700 mb-3">
              First pull:{' '}
              <span className="font-mono font-bold text-violet-700">
                {productLetter(ids, attraction.firstAttractionProductId)}
              </span>
            </p>
          )}
          {attraction.scores.length > 0 && (
            <div className="flex flex-wrap gap-3 mb-3">
              {attraction.scores.map((s) => (
                <span key={s.productId} className="text-sm text-neutral-700">
                  <span className="font-mono font-bold text-violet-700">{productLetter(ids, s.productId)}</span>
                  <span className="text-neutral-500"> — </span>
                  {Math.round(s.score <= 1 ? s.score * 100 : s.score)}
                </span>
              ))}
            </div>
          )}
          {attraction.explanation.length > 0 && (
            <BulletList items={attraction.explanation} icon={CheckCircle} tone="violet" />
          )}
        </div>
      )}

      {/* Visual differences */}
      {result.stepInsights.visualDifferences?.length > 0 && (
        <div className="rounded-3xl border border-neutral-200/60 bg-white p-6 sm:p-8 shadow-lg shadow-neutral-200/20">
          <SectionHeader icon={Sparkles} title="Visual differences" subtitle="What changes most when you look at these side by side." />
          <BulletList items={result.stepInsights.visualDifferences} icon={CheckCircle} tone="neutral" />
        </div>
      )}

      {/* Tension axes */}
      {result.tensionAxes?.length > 0 && (
        <div className="space-y-5">
          <SectionHeader icon={Split} title="Tension axes" subtitle="Where each option sits between two style poles." />
          <div className="grid md:grid-cols-2 gap-4">
            {result.tensionAxes.map((axis) => (
              <TensionAxisRow key={axis.axis} axis={axis} productIds={ids} />
            ))}
          </div>
        </div>
      )}

      {/* Why not both */}
      {result.whyNotBoth?.enabled && (
        <div className="rounded-3xl border border-fuchsia-200/70 bg-gradient-to-br from-fuchsia-50/90 via-white to-violet-50/50 p-6 sm:p-8 shadow-lg shadow-fuchsia-500/10">
          <SectionHeader icon={Split} title="Why not both?" subtitle="Sometimes the best move is a split role — not a single winner." />
          {result.whyNotBoth.explanation?.length > 0 && (
            <BulletList items={result.whyNotBoth.explanation} icon={Sparkles} tone="violet" />
          )}
          {result.whyNotBoth.productRoles?.length > 0 && (
            <ul className="mt-4 space-y-2">
              {result.whyNotBoth.productRoles.map((pr) => (
                <li key={pr.productId} className="text-sm text-neutral-800">
                  <span className="font-mono font-bold text-violet-700">{productLetter(ids, pr.productId)}</span>
                  <span className="text-neutral-500"> — </span>
                  {pr.role}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Outfit impact */}
      {result.outfitImpact?.enabled && (
        <div className="rounded-3xl border border-neutral-200/60 bg-white p-6 sm:p-8 shadow-lg shadow-neutral-200/20">
          <SectionHeader icon={Shirt} title="Outfit impact" subtitle="Versatility and how well each piece fills wardrobe gaps." />
          {result.outfitImpact.explanation?.length > 0 && (
            <BulletList items={result.outfitImpact.explanation} icon={CheckCircle} tone="violet" />
          )}
          <div className="grid sm:grid-cols-2 gap-4 mt-4">
            <div>
              <p className="text-xs font-semibold uppercase text-neutral-500 mb-2">Versatility</p>
              <ul className="text-sm space-y-1">
                {result.outfitImpact.versatilityScores?.map((v) => (
                  <li key={v.productId}>
                    {productLetter(ids, v.productId)}: {normalizeScoreDisplay(v.score)}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-neutral-500 mb-2">Wardrobe gap fill</p>
              <ul className="text-sm space-y-1">
                {result.outfitImpact.wardrobeGapFillScores?.map((v) => (
                  <li key={v.productId}>
                    {productLetter(ids, v.productId)}: {normalizeScoreDisplay(v.score)}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Social mirror */}
      {result.socialMirror?.enabled && result.socialMirror.explanation?.length > 0 && (
        <div className="rounded-3xl border border-neutral-200/60 bg-white p-6 sm:p-8 shadow-lg shadow-neutral-200/20">
          <SectionHeader icon={Users} title="Social mirror" subtitle="How others might read each choice." />
          <ul className="space-y-2">
            {result.socialMirror.explanation.map((row) => (
              <li key={row.productId} className="text-sm text-neutral-700">
                <span className="font-mono font-bold text-violet-700">{productLetter(ids, row.productId)}</span>:{' '}
                {row.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* People like you */}
      {result.peopleLikeYou?.enabled && (
        <div className="rounded-3xl border border-neutral-200/60 bg-white p-6 sm:p-8 shadow-lg shadow-neutral-200/20">
          <SectionHeader icon={Sparkles} title="People like you" subtitle="Patterns from similar shoppers." />
          {(result.peopleLikeYou.explanation?.length ?? 0) > 0 && (
            <BulletList items={result.peopleLikeYou.explanation ?? []} icon={CheckCircle} tone="neutral" />
          )}
          {(result.peopleLikeYou.notes?.length ?? 0) > 0 && (
            <div className="mt-3 text-xs text-neutral-500 space-y-1">
              {(result.peopleLikeYou.notes ?? []).map((n, i) => (
                <p key={i}>{n}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Per-product insights */}
      <div>
        <SectionHeader
          icon={BarChart3}
          title="Per-product breakdown"
          subtitle="Scores, friction, and story for each item — winners in a context show a ribbon."
        />
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {ids.map((productId, idx) => {
          const insight = getProductInsightById(result, productId)
          const product = products?.find((p) => p.id === productId)
          const consequence = getConsequenceByProductId(result, productId)
          const regret = getRegretFlashByProductId(result, productId)
          const identity = getIdentityAlignmentByProductId(result, productId)
          const contexts = getContextsWonByProduct(result, productId)
          const letter = productLetter(ids, productId)
          const overall = insight ? normalizeScoreDisplay(insight.scores?.overall) : 0
          const ringColor = scoreToLevelColor(overall)

          return (
            <motion.div
              key={productId}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 + idx * 0.08, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              className={`relative rounded-3xl border bg-white overflow-hidden transition-all duration-300 hover:-translate-y-0.5 ${
                contexts.includes('overall')
                  ? 'border-violet-300 shadow-xl shadow-violet-500/15 ring-2 ring-violet-200/60'
                  : 'border-neutral-200/70 shadow-md shadow-neutral-200/40 hover:shadow-lg hover:border-violet-200/80'
              }`}
            >
              {contexts.length > 0 && (
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-violet-500 via-fuchsia-500 to-rose-400" />
              )}
              {contexts.includes('overall') && (
                <div className="absolute top-3 right-3 z-10 rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-500 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white shadow-md">
                  Top overall
                </div>
              )}
              <div className="p-5 sm:p-6">
                <div className="flex items-start gap-4">
                  {product && (
                    <Link href={`/products/${product.id}`} className="block flex-shrink-0 group/img">
                      <div className="relative w-[4.5rem] h-28 sm:w-24 sm:h-32 rounded-2xl overflow-hidden bg-neutral-100 ring-2 ring-white shadow-md ring-offset-2 ring-offset-neutral-50 group-hover/img:ring-violet-200 transition-all">
                        <Image
                          src={product.image_cdn || product.image_url || 'https://placehold.co/96x128'}
                          alt={product.title}
                          fill
                          className="object-cover transition-transform duration-500 group-hover/img:scale-105"
                        />
                      </div>
                    </Link>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-500 text-sm font-bold text-white shadow-sm">
                        {letter}
                      </span>
                      {contexts.slice(0, 3).map((c) => (
                        <span
                          key={c}
                          className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 ring-1 ring-amber-200/60"
                        >
                          {WINNER_CONTEXT_LABELS[c]}
                        </span>
                      ))}
                    </div>
                    <p className="font-display font-bold text-neutral-900 text-sm sm:text-base line-clamp-2 leading-snug">
                      {product?.title ?? `Product ${productId}`}
                    </p>
                    <p className="text-xs font-medium text-violet-600/90 mt-1">{product?.brand ?? ''}</p>
                  </div>
                  {insight && <ScoreRing score={overall} color={ringColor} size={88} label="Overall" />}
                </div>

                {insight && (
                  <>
                    <div className="mt-5 grid grid-cols-2 gap-3">
                      <MetricBar label="Value" value={normalizeScoreDisplay(insight.scores.value)} />
                      <MetricBar label="Quality" value={normalizeScoreDisplay(insight.scores.quality)} />
                      <MetricBar label="Style" value={normalizeScoreDisplay(insight.scores.style)} />
                      <MetricBar label="Risk" value={normalizeScoreDisplay(insight.scores.risk)} />
                      <MetricBar label="Practical" value={normalizeScoreDisplay(insight.scores.practical)} />
                      <MetricBar label="Expressive" value={normalizeScoreDisplay(insight.scores.expressive)} />
                    </div>

                    <div className="mt-5 space-y-3 text-sm border-t border-neutral-100 pt-5">
                      <p className="text-xs font-semibold text-neutral-500 uppercase">Friction</p>
                      <p className="text-neutral-800">
                        Index {insight.frictionIndex}{' '}
                        {insight.frictionExplanation?.length > 0 && (
                          <span className="text-neutral-600">— {insight.frictionExplanation[0]}</span>
                        )}
                      </p>

                      <p className="text-xs font-semibold text-neutral-500 uppercase">Compliment vibe</p>
                      <p className="text-neutral-800">
                        {COMPLIMENT_COPY[insight.complimentPrediction.type]} ({normalizeScoreDisplay(insight.complimentPrediction.score)})
                      </p>
                      {insight.complimentPrediction.explanation?.length > 0 && (
                        <BulletList items={insight.complimentPrediction.explanation.slice(0, 3)} icon={Sparkles} tone="violet" />
                      )}

                      <p className="text-xs font-semibold text-neutral-500 uppercase">Wear frequency</p>
                      <p className="text-neutral-800">
                        ~{insight.wearFrequency.estimatedMonthlyWear}/mo (conf.{' '}
                        {normalizeScoreDisplay(insight.wearFrequency.confidence)})
                      </p>

                      <p className="text-xs font-semibold text-neutral-500 uppercase">Photo vs reality</p>
                      <p className="text-neutral-800">{PHOTO_LABEL_COPY[insight.photoRealityGap.label]}</p>
                      {insight.photoRealityGap.explanation?.length > 0 && (
                        <BulletList items={insight.photoRealityGap.explanation.slice(0, 2)} icon={CheckCircle} tone="neutral" />
                      )}

                      {insight.decisionRationale?.whyThisWon?.length > 0 && (
                        <>
                          <p className="text-xs font-semibold text-violet-600 uppercase">Why this wins</p>
                          <BulletList items={insight.decisionRationale.whyThisWon.slice(0, 3)} icon={CheckCircle} tone="violet" />
                        </>
                      )}
                      {insight.decisionRationale?.tradeoffsToKnow?.length > 0 && (
                        <>
                          <p className="text-xs font-semibold text-amber-700 uppercase">Tradeoffs to know</p>
                          <BulletList items={insight.decisionRationale.tradeoffsToKnow.slice(0, 2)} icon={AlertTriangle} tone="amber" />
                        </>
                      )}

                      {insight.hiddenFlaw && (
                        <>
                          <p className="text-xs font-semibold text-amber-700 uppercase">Hidden flaw</p>
                          <p className="text-neutral-800">{insight.hiddenFlaw}</p>
                        </>
                      )}
                      {insight.microStory && (
                        <>
                          <p className="text-xs font-semibold text-violet-600 uppercase">Micro-story</p>
                          <p className="text-neutral-700 italic">{insight.microStory}</p>
                        </>
                      )}
                    </div>
                  </>
                )}

                {consequence != null && (consequence.ifYouChooseThis?.length ?? 0) > 0 && (
                  <div className="mt-4">
                    <p className="text-xs font-semibold text-neutral-500 uppercase mb-2">If you choose this</p>
                    <BulletList items={consequence.ifYouChooseThis ?? []} icon={CheckCircle} tone="violet" />
                  </div>
                )}

                {regret && (
                  <div className="mt-4 rounded-xl bg-neutral-50 border border-neutral-200/80 p-3 text-sm">
                    <p className="text-xs font-semibold text-rose-700 uppercase mb-1">Regret flash</p>
                    <p className="text-neutral-800 font-medium">{regret.shortTermFeeling}</p>
                    <p className="text-neutral-600 mt-1">{regret.longTermReality}</p>
                  </div>
                )}

                {identity && (
                  <div className="mt-4 text-sm">
                    <p className="text-xs font-semibold text-neutral-500 uppercase mb-2">Identity alignment</p>
                    <p className="text-neutral-700">
                      Current self {normalizeScoreDisplay(identity.currentSelfScore)} · Aspirational{' '}
                      {normalizeScoreDisplay(identity.aspirationalSelfScore)}
                    </p>
                    {identity.explanation?.length > 0 && (
                      <div className="mt-2">
                        <BulletList items={identity.explanation} icon={CheckCircle} tone="neutral" />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          )
        })}
        </div>
      </div>
    </motion.div>
  )
}
