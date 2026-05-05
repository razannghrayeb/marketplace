'use client'

import { useMemo, useState, useEffect } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { CompareDecisionResponse } from '@/types/compareDecision'
import type { Product } from '@/types/product'
import type { ProductImage } from '@/types/product'
import { normalizeCompareProductId } from '@/store/compare'
import { displayNameForCompareProduct } from '@/lib/compare-decision/humanizeProductCopy'
import { productDetailHrefFromCompare } from '@/lib/navigation/productDetailReturn'
import { getProductInsightById, normalizeScoreDisplay, productLetter } from '@/lib/compare-decision/selectors'
import { ScoreRing, scoreToLevelColor } from '@/components/compare/ScoreRing'

const PLACEHOLDER = 'https://placehold.co/112x140/f5f5f5/a3a3a3?text=No+image'

/** Series A — warm beige (lighter); series B — charcoal so A/B read clearly at a glance */
const SERIES_A_FILL = '#e8d9cf'
const SERIES_A_STROKE = '#a67c52'
const SERIES_A_SOLID = '#c9a88e'
const SERIES_B_FILL = '#3d3030'
const SERIES_B_STROKE = '#2a2623'

function galleryUrls(p: Product | undefined): string[] {
  if (!p) return []
  const primary = p.image_cdn || p.image_url
  const extra =
    (p as Product & { images?: ProductImage[] }).images?.map((i) => i.cdn_url).filter(Boolean) ?? []
  const merged = [primary, ...extra].filter(Boolean) as string[]
  if (!merged.length) return []
  if (merged.length === 1) return merged
  return merged.slice(0, 5)
}

function StudioProductCard({
  pid,
  productIds,
  products,
  thumbSide,
  result,
}: {
  pid: number
  productIds: [number, number]
  products: Product[] | undefined
  thumbSide: 'left' | 'right'
  result: CompareDecisionResponse
}) {
  const row =
    products?.find((p) => normalizeCompareProductId(p.id) === pid) ??
    products?.find((p) => Number(p.id) === pid)
  const urls = galleryUrls(row)
  const [active, setActive] = useState(0)
  useEffect(() => {
    setActive(0)
  }, [pid, row?.image_cdn, row?.image_url])
  const safeIdx = urls.length ? Math.min(active, urls.length - 1) : 0
  const src = urls[safeIdx] ?? PLACEHOLDER
  const title =
    row?.title?.trim() ||
    displayNameForCompareProduct(products, pid, `Option ${productLetter(productIds, pid)}`)
  const letter = productLetter(productIds, pid)

  const insight = getProductInsightById(result, pid)
  const itemOverall = insight?.scores?.overall != null ? normalizeScoreDisplay(insight.scores.overall) : null
  const ringCol = itemOverall != null ? scoreToLevelColor(itemOverall) : scoreToLevelColor(0)

  const thumbs = urls.length <= 1 ? [src] : urls.slice(0, 4)

  return (
    <div
      className={`flex gap-2 sm:gap-3 flex-1 min-w-0 ${thumbSide === 'right' ? 'flex-row-reverse' : 'flex-row'}`}
    >
      <div className="flex flex-col gap-1.5 sm:gap-2 w-11 sm:w-14 shrink-0 py-1">
        {thumbs.map((u, i) => (
          <button
            key={`${u}-${i}`}
            type="button"
            onClick={() => setActive(i)}
            className={`relative aspect-[3/4] w-full rounded-xl overflow-hidden transition-all ${
              safeIdx === i
                ? 'ring-2 ring-[#3d3030] shadow-md shadow-[#3d3030]/15 scale-[1.02]'
                : 'ring-1 ring-[#e8e4df] opacity-80 hover:opacity-100 hover:ring-[#d4cbc2]'
            }`}
            aria-label={`View image ${i + 1}`}
          >
            <Image src={u} alt="" fill className="object-cover" sizes="56px" />
          </button>
        ))}
      </div>

      <Link
        href={productDetailHrefFromCompare(pid)}
        className="group/studio flex-1 min-w-0 rounded-[26px] bg-[#fdfcfa] ring-1 ring-[#ebe8e4] shadow-[0_20px_50px_-28px_rgba(42,38,35,0.22)] overflow-hidden flex flex-col"
      >
        <div className="relative flex-1 min-h-[14rem] sm:min-h-[18rem] aspect-[3/4]">
          <Image
            src={src}
            alt={title}
            fill
            className="object-cover transition-transform duration-500 group-hover/studio:scale-[1.02]"
            sizes="(max-width:640px) 38vw, min(280px, 28vw)"
            priority={letter === 'A'}
          />
          <span className="absolute top-3 left-3 flex h-9 w-9 items-center justify-center rounded-full bg-[#3d2e26] text-sm font-bold text-white shadow-lg ring-2 ring-white">
            {letter}
          </span>
          {urls.length > 1 ? (
            <div
              className={`absolute left-0 right-0 flex justify-center gap-1.5 ${itemOverall != null ? 'bottom-14' : 'bottom-3'}`}
            >
              {urls.slice(0, 6).map((_, i) => (
                <span
                  key={i}
                  className={`h-1.5 rounded-full transition-all ${safeIdx === i ? 'w-5 bg-white shadow' : 'w-1.5 bg-white/45'}`}
                  aria-hidden
                />
              ))}
            </div>
          ) : null}
          {itemOverall != null ? (
            <div
              className="absolute bottom-3 right-3 z-10 rounded-full bg-black/35 p-0.5 shadow-md ring-1 ring-white/30 backdrop-blur-[3px]"
              aria-label={`Score ${itemOverall}`}
            >
              <ScoreRing score={itemOverall} color={ringCol} size={38} label="" />
            </div>
          ) : null}
        </div>
        <p className="px-3 py-2.5 text-[11px] sm:text-xs font-medium text-[#5c5752] text-center line-clamp-2 leading-snug border-t border-[#f0ebe6] bg-white/90">
          {title}
        </p>
      </Link>
    </div>
  )
}

export function CompareStudioTwoUp({
  result,
  products,
  ids,
}: {
  result: CompareDecisionResponse
  products: Product[] | undefined
  ids: [number, number]
}) {
  const [a, b] = ids

  const insightPair = useMemo(() => {
    type Scores = CompareDecisionResponse['productInsights'][number]['scores']
    const ia = getProductInsightById(result, a)
    const ib = getProductInsightById(result, b)
    const pick = (ins: typeof ia, key: keyof Scores) =>
      ins?.scores ? normalizeScoreDisplay(ins.scores[key]) : 0
    const metricKeys = ['value', 'quality', 'style', 'risk', 'overall'] as const
    const rows = metricKeys.map((key) => ({
      name: key.charAt(0).toUpperCase() + key.slice(1),
      A: pick(ia, key),
      B: pick(ib, key),
    }))
    const radar = metricKeys.map((key) => ({
      subject: key.charAt(0).toUpperCase() + key.slice(1),
      A: pick(ia, key),
      B: pick(ib, key),
      fullMark: 100,
    }))
    const lineTrend = metricKeys.map((key, i) => ({
      step: String(i + 1),
      label: key,
      A: pick(ia, key),
      B: pick(ib, key),
    }))
    return { rows, radar, lineTrend, hasScores: Boolean(ia?.scores && ib?.scores) }
  }, [result, a, b])

  const chartTooltipStyle = {
    borderRadius: 12,
    border: '1px solid #ebe8e4',
    fontSize: 11,
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-stretch lg:justify-center lg:gap-8">
        <StudioProductCard pid={a} productIds={ids} products={products} thumbSide="left" result={result} />
        <StudioProductCard pid={b} productIds={ids} products={products} thumbSide="right" result={result} />
      </div>

      {insightPair.hasScores ? (
        <div className="rounded-[22px] border border-[#ebe8e4] bg-[#faf9f7]/80 p-4 sm:p-5 shadow-inner">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#9c9590] mb-1">
            Score shapes
          </p>
          <p className="text-[11px] text-[#7a726b] mb-4 max-w-3xl">
            Same five signals everywhere: value, quality, style, risk, and overall — beige traces{' '}
            <span className="font-semibold text-[#a67c52]">{productLetter(ids, a)}</span>, dark traces{' '}
            <span className="font-semibold text-[#2a2623]">{productLetter(ids, b)}</span>.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 md:gap-4">
            <figure className="flex flex-col gap-2 min-w-0">
              <figcaption className="px-0.5">
                <span className="block text-[12px] font-semibold text-[#3d3632]">Multi-axis radar</span>
                <span className="block mt-1 text-[10px] text-[#8a8078] leading-snug">
                  One polygon per option — distance from center shows strength on each dimension (0–100).
                </span>
              </figcaption>
              <div className="h-[210px] min-h-[180px] rounded-2xl bg-white ring-1 ring-[#ebe8e4] p-2 pt-3 shadow-sm">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart cx="50%" cy="50%" outerRadius="72%" data={insightPair.radar}>
                    <PolarGrid stroke="#ebe8e4" />
                    <PolarAngleAxis dataKey="subject" tick={{ fill: '#6b6560', fontSize: 9 }} />
                    <Radar
                      name={`${productLetter(ids, a)}`}
                      dataKey="A"
                      stroke={SERIES_A_STROKE}
                      fill={SERIES_A_FILL}
                      fillOpacity={0.55}
                    />
                    <Radar
                      name={`${productLetter(ids, b)}`}
                      dataKey="B"
                      stroke={SERIES_B_STROKE}
                      fill={SERIES_B_FILL}
                      fillOpacity={0.28}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Tooltip contentStyle={chartTooltipStyle} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </figure>

            <figure className="flex flex-col gap-2 min-w-0">
              <figcaption className="px-0.5">
                <span className="block text-[12px] font-semibold text-[#3d3632]">Bars by metric</span>
                <span className="block mt-1 text-[10px] text-[#8a8078] leading-snug">
                  Side-by-side bars for each score — easy to see who leads on value, style, risk, etc.
                </span>
              </figcaption>
              <div className="h-[210px] min-h-[180px] rounded-2xl bg-white ring-1 ring-[#ebe8e4] p-2 pt-3 shadow-sm">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart layout="vertical" data={insightPair.rows} margin={{ left: 4, right: 8, top: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0ebe4" />
                    <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: '#9c9590' }} />
                    <YAxis type="category" dataKey="name" width={52} tick={{ fontSize: 10, fill: '#5c5752' }} />
                    <Tooltip contentStyle={chartTooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar
                      dataKey="A"
                      name={`${productLetter(ids, a)}`}
                      fill={SERIES_A_SOLID}
                      radius={[0, 6, 6, 0]}
                      barSize={10}
                    />
                    <Bar
                      dataKey="B"
                      name={`${productLetter(ids, b)}`}
                      fill={SERIES_B_FILL}
                      radius={[0, 6, 6, 0]}
                      barSize={10}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </figure>

            <figure className="flex flex-col gap-2 min-w-0">
              <figcaption className="px-0.5">
                <span className="block text-[12px] font-semibold text-[#3d3632]">Trend across dimensions</span>
                <span className="block mt-1 text-[10px] text-[#8a8078] leading-snug">
                  Metrics in order (1–5) — follow each line to spot peaks and trade-offs between options.
                </span>
              </figcaption>
              <div className="h-[210px] min-h-[180px] rounded-2xl bg-white ring-1 ring-[#ebe8e4] p-2 pt-3 shadow-sm">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={insightPair.lineTrend} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0ebe4" />
                    <XAxis dataKey="step" tick={{ fontSize: 10, fill: '#9c9590' }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#9c9590' }} width={32} />
                    <Tooltip contentStyle={chartTooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line
                      type="monotone"
                      dataKey="A"
                      name={`${productLetter(ids, a)}`}
                      stroke={SERIES_A_STROKE}
                      strokeWidth={2.5}
                      dot={{ fill: SERIES_A_SOLID, stroke: SERIES_A_STROKE, strokeWidth: 1, r: 4 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="B"
                      name={`${productLetter(ids, b)}`}
                      stroke={SERIES_B_STROKE}
                      strokeWidth={2.5}
                      dot={{ fill: SERIES_B_FILL, stroke: SERIES_B_STROKE, strokeWidth: 1, r: 4 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </figure>
          </div>
        </div>
      ) : null}
    </div>
  )
}
