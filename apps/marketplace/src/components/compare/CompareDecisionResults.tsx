'use client'

import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
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
  ChevronDown,
} from 'lucide-react'
import { ScoreRing, scoreToLevelColor } from '@/components/compare/ScoreRing'
import { CompareStudioTwoUp } from '@/components/compare/CompareStudioTwoUp'
import type { CompareDecisionResponse } from '@/types/compareDecision'
import { WINNER_CONTEXT_LABELS } from '@/types/compareDecision'
import type { Product } from '@/types/product'
import { normalizeCompareProductId } from '@/store/compare'
import {
  displayNameForCompareProduct,
  humanizeProductIdInCopy,
  humanizeProductIdInCopyLines,
} from '@/lib/compare-decision/humanizeProductCopy'
import { productDetailHrefFromCompare } from '@/lib/navigation/productDetailReturn'
import {
  getAttractionState,
  getContextsWonByProduct,
  getProductInsightById,
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

/** Short labels for verdict chips (avoid repeating full titles). */
const QUICK_WINNER_SHORT: Record<'overall' | 'value' | 'style', string> = {
  overall: 'Overall',
  value: 'Value',
  style: 'Style',
}

/** Short chips for horizontal compare rows */
const CONTEXT_CHIP_SHORT: Partial<Record<keyof typeof WINNER_CONTEXT_LABELS, string>> = {
  practical: 'Practical',
  expressive: 'Expressive',
  safest: 'Safest',
  mostExciting: 'Exciting',
  currentSelf: 'Cur-you',
  aspirationalSelf: 'Asp-you',
  value: 'Value',
  quality: 'Quality',
  style: 'Style',
  risk: 'Low risk',
  occasion: 'Occasion',
  overall: 'Overall',
}

function BulletList({
  items,
  icon: Icon,
  tone,
  formatLine,
  dense,
  maxItems,
}: {
  items: string[]
  icon: typeof CheckCircle
  tone: 'violet' | 'amber' | 'neutral'
  /** Optional per-line transform (e.g. swap “Product 123” for the real title). */
  formatLine?: (line: string) => string
  dense?: boolean
  /** Cap rows for shorter detail panels */
  maxItems?: number
}) {
  if (!items.length) return null
  const iconCls =
    tone === 'violet' ? 'text-[#7d4b3a]' : tone === 'amber' ? 'text-[#3d3030]' : 'text-neutral-400'
  const capped = maxItems != null ? items.slice(0, maxItems) : items
  const lines = formatLine ? capped.map(formatLine) : capped
  return (
    <ul className={dense ? 'space-y-1.5' : 'space-y-2'}>
      {lines.map((line, i) => (
        <li
          key={i}
          className={`flex items-start gap-2 rounded-lg bg-[#faf9f7] text-neutral-700 ring-1 ring-[#ebe8e4] ${
            dense ? 'px-2.5 py-1.5 text-xs leading-snug' : 'px-3 py-2.5 text-sm leading-relaxed'
          }`}
        >
          <Icon className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${iconCls}`} />
          <span>{line}</span>
        </li>
      ))}
    </ul>
  )
}

function SectionHeader({
  icon: Icon,
  title,
  subtitle,
  compact,
}: {
  icon: typeof Sparkles
  title: string
  subtitle?: string
  compact?: boolean
}) {
  const iconWrap = compact ? 'h-8 w-8 rounded-xl' : 'h-11 w-11 rounded-2xl'
  const iconSz = compact ? 'h-4 w-4' : 'h-[22px] w-[22px]'
  return (
    <div className={compact ? 'mb-3' : 'mb-5'}>
      <div className="flex items-start gap-2.5">
        <span
          className={`flex shrink-0 items-center justify-center bg-[#f4ece6] text-[#2a2623] ring-1 ring-[#eadfd7] ${iconWrap}`}
        >
          <Icon className={iconSz} strokeWidth={2} />
        </span>
        <div className="min-w-0 pt-0.5">
          <h3 className={`font-display font-bold tracking-tight text-[#2a2623] ${compact ? 'text-sm' : 'text-xl'}`}>
            {title}
          </h3>
          {subtitle ? (
            <p className={`text-neutral-500 mt-0.5 ${compact ? 'text-xs leading-snug' : 'text-sm leading-relaxed'}`}>
              {subtitle}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function TensionAxisRow({
  axis,
  productIds,
  products,
}: {
  axis: CompareDecisionResponse['tensionAxes'][number]
  productIds: number[]
  products: Product[] | undefined
}) {
  const colors = [
    'bg-brand-active shadow-brand-active/40',
    'bg-brand shadow-brand/40',
    'bg-brand-hover shadow-brand/40',
    'bg-[#c9ae9f] shadow-[#c9ae9f]/40',
    'bg-[#7d4b3a] shadow-[#7d4b3a]/40',
  ]

  /** One marker per compared product, in tray order (A, B, …), even if the API omitted an id. */
  const merged = useMemo(() => {
    return productIds.map((id) => {
      const hit = axis.positions?.find((p) => normalizeCompareProductId(p.productId) === id)
      let v = hit?.value ?? 0.5
      if (typeof v !== 'number' || !Number.isFinite(v)) v = 0.5
      if (v > 1) v = v / 100
      return { productId: id, value: Math.max(0, Math.min(1, v)) }
    })
  }, [axis.positions, productIds])

  /** Nudge pixels when two scores map to nearly the same % so both labels stay readable. */
  const stackOffsetPx = useMemo(() => {
    const pcts = merged.map((p) => (p.value <= 1 ? p.value * 100 : p.value))
    return pcts.map((pct, i) => {
      let stack = 0
      for (let j = 0; j < i; j++) {
        if (Math.abs(pcts[j]! - pct) < 5) stack += 1
      }
      return stack * 18
    })
  }, [merged])

  return (
    <div className="rounded-xl border border-[#ebe8e4] bg-white p-3 shadow-sm ring-1 ring-inset ring-[#faf9f7]">
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#3d3030] mb-2">
        {axis.axis.replace(/_/g, ' ')}
      </p>
      <div className="flex justify-between text-xs font-medium text-neutral-600 mb-3 gap-4">
        <span className="text-left leading-snug text-[#2a2623]/90">{axis.leftLabel}</span>
        <span className="text-right leading-snug text-[#2a2623]/90">{axis.rightLabel}</span>
      </div>
      <div className="relative h-11 rounded-full bg-gradient-to-r from-[#f7f0eb] via-neutral-100 to-[#f3ece6] border border-neutral-200/60 overflow-visible shadow-inner">
        <div className="absolute inset-y-2 left-3 right-3 rounded-full bg-white/60" aria-hidden />
        {merged.map((p, i) => {
          const pidN = normalizeCompareProductId(p.productId)
          if (pidN == null) return null
          const pct = Math.max(0, Math.min(100, p.value <= 1 ? p.value * 100 : p.value))
          const color = colors[i % colors.length]
          const letter = productLetter(productIds, pidN)
          const ox = stackOffsetPx[i] ?? 0
          const z = 10 + Math.round(ox / 18)
          return (
            <div
              key={`${axis.axis}-${pidN}-${i}`}
              className="absolute top-1/2 flex flex-col items-center group"
              style={{
                left: `${pct}%`,
                transform: `translate(calc(-50% + ${ox}px), -50%)`,
                zIndex: z,
              }}
              title={`${letter} — ${displayNameForCompareProduct(products, pidN, letter)} · ${Math.round(pct)}`}
            >
              <span
                className={`w-4 h-4 rounded-full ${color} ring-[3px] ring-white shadow-lg transition-transform group-hover:scale-110`}
              />
              <span className="mt-1.5 text-[10px] font-bold tabular-nums text-neutral-700 bg-white/95 px-1.5 py-0.5 rounded-md border border-neutral-200/80 shadow-sm">
                {letter}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function truncateSummary(s: string, max: number) {
  const t = s.trim()
  if (t.length <= max) return t
  return `${t.slice(0, Math.max(0, max - 1)).trim()}…`
}

export function CompareDecisionResults({
  result,
  products,
}: {
  result: CompareDecisionResponse
  products: Product[] | undefined
}) {
  const [detailsOpen, setDetailsOpen] = useState(true)

  const ids = useMemo(() => {
    const raw = result.comparisonContext.productIds ?? []
    const out: number[] = []
    for (const x of raw) {
      const n = normalizeCompareProductId(x)
      if (n != null) out.push(n)
    }
    return out
  }, [result.comparisonContext.productIds])
  const attraction = getAttractionState(result)
  const fmt = (s: string) => humanizeProductIdInCopy(s, products)
  const fmtLines = (lines: string[]) => humanizeProductIdInCopyLines(lines, products)

  const overallPid = normalizeCompareProductId(result.winnersByContext?.overall)

  const summaryBlurb =
    (result.decisionConfidence.explanation?.[0] &&
      truncateSummary(fmt(result.decisionConfidence.explanation[0]), 100)) ||
    truncateSummary(fmt(result.comparisonContext.modeReason), 100)

  const confidenceScore = normalizeScoreDisplay(result.decisionConfidence.score)

  const quickWinnerKeys = ['overall', 'value', 'style'] as const

  const overallLetter =
    overallPid != null ? productLetter(ids, overallPid) : null

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="space-y-4"
    >
      {/* Above-the-fold: big photos + scores, compact verdict */}
      <div className="rounded-2xl border border-[#ebe8e4] bg-white p-4 sm:p-5 shadow-[0_6px_28px_-16px_rgba(42,38,35,0.1)]">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="inline-flex items-center rounded-full border border-[#e8e4df] bg-[#faf9f7] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-[#6b6560]">
              {MODE_COPY[result.comparisonMode]}
          </span>
          {result.requestedGoal ? (
            <span className="text-[11px] font-medium text-[#7a726b]">
              Goal: <span className="text-[#2a2623]">{result.requestedGoal.replace(/_/g, ' ')}</span>
            </span>
          ) : null}
          {result.requestedOccasion ? (
            <span className="text-[11px] font-medium text-[#7a726b]">
              · <span className="text-[#2a2623]">{result.requestedOccasion}</span>
              </span>
          ) : null}
        </div>

        {ids.length > 0 &&
          (ids.length === 2 ? (
            <div className="mb-4">
              <CompareStudioTwoUp result={result} products={products} ids={[ids[0]!, ids[1]!]} />
            </div>
          ) : (
            <div
              className={`grid gap-3 sm:gap-4 mb-4 ${ids.length <= 2 ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3'}`}
              aria-label="Compared products"
            >
                {ids.map((pid) => {
                  const row =
                    products?.find((p) => normalizeCompareProductId(p.id) === pid) ??
                    products?.find((p) => Number(p.id) === pid)
                  const title =
                    row?.title?.trim() ||
                    displayNameForCompareProduct(products, pid, `Option ${productLetter(ids, pid)}`)
                  const imgSrc =
                    row?.image_cdn || row?.image_url || 'https://placehold.co/112x140/f5f5f5/a3a3a3?text=No+image'
                  const letter = productLetter(ids, pid)
                  const insight = getProductInsightById(result, pid)
                  const itemOverall = insight ? normalizeScoreDisplay(insight.scores?.overall) : null
                  const ringCol = itemOverall != null ? scoreToLevelColor(itemOverall) : scoreToLevelColor(0)

                  return (
                    <Link
                      key={pid}
                      href={productDetailHrefFromCompare(pid)}
                      className="group/thumb flex flex-col gap-2 min-w-0"
                    >
                      <div className="relative aspect-[3/4] w-full min-h-[11.5rem] sm:min-h-[13.5rem] overflow-hidden rounded-2xl bg-neutral-100 ring-2 ring-[#ebe8e4] shadow-md transition-[box-shadow,transform] group-hover/thumb:ring-[#d8c6bb] group-hover/thumb:shadow-lg">
                        <Image
                          src={imgSrc}
                          alt={title}
                          fill
                          className="object-cover transition-transform duration-300 group-hover/thumb:scale-[1.02]"
                          sizes="(max-width:640px) 42vw, 220px"
                          priority={letter === 'A'}
                        />
                        <span className="absolute top-2 left-2 flex h-8 w-8 items-center justify-center rounded-xl bg-[#3d2e26] text-sm font-bold text-white shadow-md ring-1 ring-white">
                          {letter}
              </span>
                        {itemOverall != null ? (
                          <div
                            className="absolute bottom-2 right-2 z-10 rounded-full bg-black/40 p-0.5 shadow-md ring-1 ring-white/25 backdrop-blur-[3px]"
                            aria-label={`Score ${itemOverall}`}
                          >
                            <ScoreRing score={itemOverall} color={ringCol} size={38} label="" />
                          </div>
                        ) : null}
                      </div>
                      <p className="text-[11px] font-medium text-[#5c5752] text-center line-clamp-2 leading-snug px-0.5">
                        {title}
                      </p>
                    </Link>
                  )
                })}
          </div>
          ))}

        <div className="space-y-2 border-t border-[#f0ebe6] pt-4">
          <h2 className="font-display text-lg sm:text-xl font-bold text-[#2a2623] tracking-tight">
            {CONFIDENCE_COPY[result.decisionConfidence.level]}
          </h2>
          <p className="text-[11px] text-[#6b6560] flex flex-wrap items-center gap-x-2 gap-y-0.5">
            {overallLetter ? (
              <>
                <span>
                  Lead <strong className="text-[#2a2623] font-semibold">{overallLetter}</strong>
                </span>
                <span className="text-[#e3ddd4]" aria-hidden>
                  ·
                </span>
              </>
            ) : null}
            <span className="tabular-nums">Confidence {confidenceScore}</span>
          </p>
          <p className="text-xs text-[#5c5752] leading-snug">{summaryBlurb}</p>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {quickWinnerKeys.map((key) => {
              const pidRaw = result.winnersByContext[key]
              const pid = normalizeCompareProductId(pidRaw)
              if (pid == null) return null
              const letter = productLetter(ids, pid)
              return (
                <span
                  key={key}
                  className="inline-flex items-center gap-1 rounded-full border border-[#e8e4df] bg-[#f3f1ee] px-2.5 py-1 text-[11px] font-semibold text-[#2a2623]"
                >
                  <span className="font-bold text-[#3d3030]">{letter}</span>
                  <span className="text-[#6b6560]">{QUICK_WINNER_SHORT[key]}</span>
                </span>
              )
            })}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setDetailsOpen((v) => !v)}
          className="mt-4 inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-full bg-brand px-4 py-2 text-[13px] font-semibold text-white shadow-sm ring-1 ring-brand/25 hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 transition-colors"
          aria-expanded={detailsOpen}
        >
          {detailsOpen ? 'Hide details' : 'Details'}
          <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${detailsOpen ? 'rotate-180' : ''}`} />
        </button>
      </div>

      <AnimatePresence initial={false}>
        {detailsOpen ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="space-y-4 pt-1"
          >
            <div className="rounded-2xl border border-[#ebe8e4] bg-white p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[#9c9590] mb-1">Why</p>
              <p className="text-xs text-[#5c5752] leading-snug">
                {truncateSummary(fmt(result.comparisonContext.modeReason), 140)}
              </p>
      </div>

      {/* Data quality */}
      {result.comparisonContext.dataQuality && (
        <div className="rounded-2xl border border-amber-200/70 bg-amber-50/50 px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span className="text-xs font-semibold text-amber-950">
              Quality {normalizeScoreDisplay(result.comparisonContext.dataQuality.overallScore)}
            </span>
          </div>
          {result.comparisonContext.dataQuality.notes?.length > 0 && (
            <BulletList
              items={result.comparisonContext.dataQuality.notes}
              icon={AlertTriangle}
              tone="amber"
              formatLine={fmt}
              dense
              maxItems={2}
            />
          )}
        </div>
      )}

      {result.decisionConfidence.explanation?.length > 1 && (
        <div className="rounded-2xl border border-[#ebe8e4] bg-white p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#9c9590] mb-2">More</p>
              <BulletList
            items={result.decisionConfidence.explanation.slice(1)}
                icon={Sparkles}
                tone="violet"
                formatLine={fmt}
            dense
            maxItems={2}
              />
            </div>
          )}

      {/* Winners by context */}
      <div className="rounded-2xl border border-[#ebe8e4] bg-white p-4 shadow-sm">
        <SectionHeader icon={GitCompare} title="By lens" compact />
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-2">
          {(Object.keys(WINNER_CONTEXT_LABELS) as Array<keyof typeof WINNER_CONTEXT_LABELS>).map((key) => {
            const pidRaw = result.winnersByContext[key]
            const pid = normalizeCompareProductId(pidRaw)
            if (pid == null) return null
            const label = WINNER_CONTEXT_LABELS[key]
            const letter = productLetter(ids, pid)
            const row =
              products?.find((p) => normalizeCompareProductId(p.id) === pid) ??
              products?.find((p) => p.id === pid)
            const imgSrc =
              row?.image_cdn || row?.image_url || 'https://placehold.co/96x128/f5f5f5/a3a3a3?text=No+image'
            return (
              <div
                key={key}
                className="group flex items-center gap-2 rounded-xl border border-[#ebe8e4] bg-[#faf9f7] p-2 transition-colors hover:border-[#d8d2cd]"
              >
                <div className="relative h-11 w-9 shrink-0 overflow-hidden rounded-lg bg-neutral-100 ring-1 ring-[#ebe8e4]">
                  <Image
                    src={imgSrc}
                    alt=""
                    fill
                    className="object-cover transition-transform group-hover:scale-105"
                    sizes="40px"
                  />
                </div>
                <div className="min-w-0 flex-1 flex items-center gap-2">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand text-xs font-bold text-white shadow-sm">
                      {letter}
                    </span>
                  <p className="text-[11px] font-semibold text-neutral-800 truncate">{label}</p>
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
        <div className="rounded-2xl border border-[#ebe8e4] bg-white p-4 shadow-sm">
          <SectionHeader icon={Eye} title="First glance" compact />
          {attraction.firstAttractionProductId != null && (
            <p className="text-xs text-neutral-700 mb-2">
              Pick{' '}
              <span className="font-mono font-bold text-[#2a2623]">
                {productLetter(ids, attraction.firstAttractionProductId)}
              </span>
            </p>
          )}
          {attraction.scores.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2 text-xs text-neutral-700">
              {attraction.scores.map((s) => {
                const letter = productLetter(ids, s.productId)
                return (
                  <span key={s.productId} className="tabular-nums">
                    <span className="font-mono font-bold text-[#2a2623]">{letter}</span>
                    <span className="text-neutral-400"> · </span>
                    {Math.round(s.score <= 1 ? s.score * 100 : s.score)}
                  </span>
                )
              })}
            </div>
          )}
          {attraction.explanation.length > 0 && (
            <BulletList items={attraction.explanation} icon={CheckCircle} tone="violet" formatLine={fmt} dense maxItems={2} />
          )}
        </div>
      )}

      {/* Visual differences */}
      {result.stepInsights.visualDifferences?.length > 0 && (
        <div className="rounded-2xl border border-[#ebe8e4] bg-white p-4 shadow-sm">
          <SectionHeader icon={Sparkles} title="Looks" compact />
          <BulletList
            items={result.stepInsights.visualDifferences}
            icon={CheckCircle}
            tone="neutral"
            formatLine={fmt}
            dense
            maxItems={2}
          />
        </div>
      )}

      {/* Tension axes */}
      {result.tensionAxes?.length > 0 && (
        <div className="space-y-3">
          <SectionHeader icon={Split} title="Style poles" compact />
          <div className="grid md:grid-cols-2 gap-3">
            {result.tensionAxes.map((axis) => (
              <TensionAxisRow key={axis.axis} axis={axis} productIds={ids} products={products} />
            ))}
          </div>
        </div>
      )}

      {/* Why not both */}
      {result.whyNotBoth?.enabled && (
        <div className="rounded-2xl border border-[#eadfd7] bg-[#faf9f7] p-4 shadow-sm">
          <SectionHeader icon={Split} title="Both?" compact />
          {result.whyNotBoth.explanation?.length > 0 && (
            <BulletList
              items={result.whyNotBoth.explanation}
              icon={Sparkles}
              tone="violet"
              formatLine={fmt}
              dense
              maxItems={2}
            />
          )}
          {result.whyNotBoth.productRoles?.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-neutral-800">
              {result.whyNotBoth.productRoles.map((pr) => (
                <li key={pr.productId} className="flex gap-1.5 min-w-0">
                  <span className="font-mono font-bold text-[#2a2623] shrink-0">{productLetter(ids, pr.productId)}</span>
                  <span className="text-neutral-500 shrink-0">·</span>
                  <span className="truncate">{pr.role}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Outfit impact */}
      {result.outfitImpact?.enabled && (
        <div className="rounded-2xl border border-[#ebe8e4] bg-white p-4 shadow-sm">
          <SectionHeader icon={Shirt} title="Wardrobe" compact />
          {result.outfitImpact.explanation?.length > 0 && (
            <BulletList
              items={result.outfitImpact.explanation}
              icon={CheckCircle}
              tone="violet"
              formatLine={fmt}
              dense
              maxItems={2}
            />
          )}
          <div className="grid sm:grid-cols-2 gap-3 mt-3">
            <div>
              <p className="text-[10px] font-semibold uppercase text-neutral-500 mb-1.5">Versatile</p>
              <ul className="text-xs space-y-1 tabular-nums">
                {result.outfitImpact.versatilityScores?.map((v) => (
                  <li key={v.productId}>
                    <span className="font-mono font-semibold text-[#2a2623]">{productLetter(ids, v.productId)}</span>
                    <span className="text-neutral-400"> · </span>
                    {normalizeScoreDisplay(v.score)}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase text-neutral-500 mb-1.5">Gap fill</p>
              <ul className="text-xs space-y-1 tabular-nums">
                {result.outfitImpact.wardrobeGapFillScores?.map((v) => (
                  <li key={v.productId}>
                    <span className="font-mono font-semibold text-[#2a2623]">{productLetter(ids, v.productId)}</span>
                    <span className="text-neutral-400"> · </span>
                    {normalizeScoreDisplay(v.score)}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Social mirror */}
      {result.socialMirror?.enabled && result.socialMirror.explanation?.length > 0 && (
        <div className="rounded-2xl border border-[#ebe8e4] bg-white p-4 shadow-sm">
          <SectionHeader icon={Users} title="Social" compact />
          <ul className="space-y-1.5">
            {result.socialMirror.explanation.map((row) => (
              <li key={row.productId} className="text-xs text-neutral-700 leading-snug">
                <span className="font-mono font-bold text-[#2a2623]">{productLetter(ids, row.productId)}</span>
                <span className="text-neutral-400"> · </span>
                <span className="line-clamp-2">{fmt(row.message)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* People like you */}
      {result.peopleLikeYou?.enabled && (
        <div className="rounded-2xl border border-[#ebe8e4] bg-white p-4 shadow-sm">
          <SectionHeader icon={Sparkles} title="Similar shoppers" compact />
          {(result.peopleLikeYou.explanation?.length ?? 0) > 0 && (
            <BulletList
              items={result.peopleLikeYou.explanation ?? []}
              icon={CheckCircle}
              tone="neutral"
              formatLine={fmt}
              dense
              maxItems={2}
            />
          )}
          {(result.peopleLikeYou.notes?.length ?? 0) > 0 && (
            <div className="mt-2 text-[11px] text-neutral-500 space-y-1">
              {fmtLines(result.peopleLikeYou.notes ?? [])
                .slice(0, 2)
                .map((n, i) => (
                  <p key={i} className="line-clamp-2">
                    {n}
                  </p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Per-product — compact horizontal rows */}
      <div>
        <SectionHeader icon={BarChart3} title="Each item" compact />
        <div className="flex flex-col gap-2">
        {ids.map((productId, idx) => {
          const insight = getProductInsightById(result, productId)
            const product =
              products?.find((p) => normalizeCompareProductId(p.id) === productId) ??
              products?.find((p) => Number(p.id) === productId)
          const contexts = getContextsWonByProduct(result, productId)
          const letter = productLetter(ids, productId)
            const overall = insight ? normalizeScoreDisplay(insight.scores?.overall) : null
            const ringColor = overall != null ? scoreToLevelColor(overall) : scoreToLevelColor(0)
            const title =
              product?.title?.trim() ||
              displayNameForCompareProduct(products, productId, `Product #${productId}`)
            const imgSrc = product?.image_cdn || product?.image_url || 'https://placehold.co/96x128'
            const pidHref = product?.id ?? productId

            const v = insight ? normalizeScoreDisplay(insight.scores.value) : null
            const st = insight ? normalizeScoreDisplay(insight.scores.style) : null
            const q = insight ? normalizeScoreDisplay(insight.scores.quality) : null
            const r = insight ? normalizeScoreDisplay(insight.scores.risk) : null

          return (
            <motion.div
              key={productId}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.06 + idx * 0.05, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                className={`relative rounded-xl border bg-white overflow-hidden ${
                contexts.includes('overall')
                    ? 'border-[#d8c6bb] ring-1 ring-[#eadfd7]/80 shadow-sm'
                    : 'border-[#ebe8e4] shadow-sm'
              }`}
            >
              {contexts.length > 0 && (
                  <div className="absolute top-0 left-0 right-0 h-0.5 bg-brand" aria-hidden />
                )}
                <div className="flex items-center gap-3 p-2.5 sm:gap-4 sm:p-3">
                  <Link
                    href={productDetailHrefFromCompare(pidHref)}
                    className="relative shrink-0 w-[4.5rem] sm:w-[5.25rem] aspect-[3/4] rounded-xl overflow-hidden bg-neutral-100 ring-2 ring-[#ebe8e4] shadow-sm transition-[box-shadow,transform] hover:ring-[#d8c6bb] hover:shadow-md group/pimg"
                  >
                        <Image
                      src={imgSrc}
                      alt={title}
                      fill
                      className="object-cover transition-transform duration-300 group-hover/pimg:scale-[1.02]"
                      sizes="(max-width:640px) 72px, 84px"
                    />
                    <span className="absolute top-1 left-1 flex h-7 w-7 items-center justify-center rounded-lg bg-[#3d2e26] text-xs font-bold text-white shadow-md ring-1 ring-white">
                      {letter}
                    </span>
                    {overall != null ? (
                      <div className="absolute bottom-1 right-1 z-10 rounded-full bg-black/40 p-0.5 shadow-md ring-1 ring-white/30 backdrop-blur-[2px]">
                        <ScoreRing score={overall} color={ringColor} size={34} label="" />
                      </div>
                    ) : null}
                    </Link>

                  <div className="flex-1 min-w-0 flex flex-col justify-center gap-1 py-0.5">
                    <div className="flex flex-wrap items-center gap-1">
                      {contexts.includes('overall') ? (
                        <span className="text-[8px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-brand text-white">
                          Top
                      </span>
                      ) : null}
                      {contexts.slice(0, 4).map((c) => (
                        <span
                          key={c}
                          className="text-[8px] sm:text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-950 ring-1 ring-amber-200/70 max-w-[5.5rem] truncate"
                          title={WINNER_CONTEXT_LABELS[c]}
                        >
                          {CONTEXT_CHIP_SHORT[c] ?? WINNER_CONTEXT_LABELS[c]}
                        </span>
                      ))}
                    </div>
                    <Link href={productDetailHrefFromCompare(pidHref)} className="min-w-0 group/t">
                      <p className="text-sm font-semibold text-[#2a2623] leading-snug line-clamp-1 group-hover/t:text-[#3d3030] transition-colors">
                        {title}
                      </p>
                      {product?.brand ? (
                        <p className="text-[10px] font-medium text-neutral-500 uppercase tracking-wide truncate mt-0.5">
                          {product.brand}
                        </p>
                      ) : null}
                    </Link>
                    {insight && v != null && st != null && q != null && r != null ? (
                      <p className="text-[10px] tabular-nums text-neutral-600 leading-tight">
                        <span className="text-neutral-400">V</span> {v}
                        <span className="text-neutral-300 mx-1">·</span>
                        <span className="text-neutral-400">Sty</span> {st}
                        <span className="text-neutral-300 mx-1">·</span>
                        <span className="text-neutral-400">Q</span> {q}
                        <span className="text-neutral-300 mx-1">·</span>
                        <span className="text-neutral-400">R</span> {r}
                      </p>
                    ) : null}
                  </div>
              </div>
            </motion.div>
          )
        })}
        </div>
      </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  )
}
