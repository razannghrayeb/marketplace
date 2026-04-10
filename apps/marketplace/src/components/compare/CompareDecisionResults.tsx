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

function BulletList({ items, icon: Icon, tone }: { items: string[]; icon: typeof CheckCircle; tone: 'violet' | 'amber' | 'neutral' }) {
  if (!items.length) return null
  const iconCls =
    tone === 'violet' ? 'text-violet-500' : tone === 'amber' ? 'text-amber-500' : 'text-neutral-400'
  return (
    <ul className="space-y-1.5">
      {items.map((line, i) => (
        <li key={i} className="flex items-start gap-2 text-sm text-neutral-700">
          <Icon className={`w-4 h-4 flex-shrink-0 mt-0.5 ${iconCls}`} />
          <span>{line}</span>
        </li>
      ))}
    </ul>
  )
}

function TensionAxisRow({
  axis,
  productIds,
}: {
  axis: CompareDecisionResponse['tensionAxes'][number]
  productIds: number[]
}) {
  const colors = ['bg-violet-500', 'bg-fuchsia-500', 'bg-rose-500', 'bg-amber-500', 'bg-cyan-500']
  return (
    <div className="rounded-2xl border border-neutral-200/80 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-3">{axis.axis.replace(/_/g, ' ')}</p>
      <div className="flex justify-between text-xs text-neutral-600 mb-2">
        <span>{axis.leftLabel}</span>
        <span>{axis.rightLabel}</span>
      </div>
      <div className="relative h-8 rounded-full bg-neutral-100 border border-neutral-200/80">
        {axis.positions.map((p, i) => {
          const pct = Math.max(0, Math.min(100, p.value <= 1 ? p.value * 100 : p.value))
          const color = colors[i % colors.length]
          return (
            <div
              key={p.productId}
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 flex flex-col items-center"
              style={{ left: `${pct}%` }}
              title={`${productLetter(productIds, p.productId)}: ${Math.round(pct)}`}
            >
              <span className={`w-3 h-3 rounded-full ${color} ring-2 ring-white shadow`} />
              <span className="mt-1 text-[10px] font-bold text-neutral-600">{productLetter(productIds, p.productId)}</span>
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
      {/* Context strip */}
      <div className="rounded-2xl border border-neutral-200/60 bg-white/90 p-4 sm:p-5 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-violet-100 text-violet-800 text-xs font-bold uppercase tracking-wide">
            <GitCompare className="w-3.5 h-3.5" />
            {MODE_COPY[result.comparisonMode]}
          </span>
          {result.requestedGoal && (
            <span className="text-xs text-neutral-600">
              Goal: <span className="font-medium text-neutral-800">{result.requestedGoal.replace(/_/g, ' ')}</span>
            </span>
          )}
          {result.requestedOccasion && (
            <span className="text-xs text-neutral-600">
              Occasion:{' '}
              <span className="font-medium text-neutral-800">{result.requestedOccasion}</span>
            </span>
          )}
        </div>
        <p className="text-sm text-neutral-600 max-w-xl">{result.comparisonContext.modeReason}</p>
      </div>

      {/* Data quality */}
      {result.comparisonContext.dataQuality && (
        <div className="rounded-2xl border border-amber-100 bg-amber-50/50 px-4 py-3 text-sm text-amber-950">
          <span className="font-semibold">Data quality {normalizeScoreDisplay(result.comparisonContext.dataQuality.overallScore)}</span>
          {result.comparisonContext.dataQuality.notes?.length > 0 && (
            <BulletList items={result.comparisonContext.dataQuality.notes} icon={AlertTriangle} tone="amber" />
          )}
        </div>
      )}

      {/* Decision confidence — replaces single-winner verdict */}
      <div className="relative overflow-hidden rounded-3xl border border-neutral-200/60 bg-white shadow-lg">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-violet-500 via-fuchsia-500 to-rose-400" />
        <div className="p-6 sm:p-8">
          <div className="flex items-start gap-4 mb-4">
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-md flex-shrink-0">
              <BarChart3 className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="font-display text-xl sm:text-2xl font-bold text-neutral-900">
                {CONFIDENCE_COPY[result.decisionConfidence.level]}
              </h2>
              <p className="text-neutral-500 mt-1">
                Confidence score: {normalizeScoreDisplay(result.decisionConfidence.score)}
              </p>
            </div>
          </div>
          {result.decisionConfidence.explanation?.length > 0 && (
            <BulletList items={result.decisionConfidence.explanation} icon={Sparkles} tone="violet" />
          )}
        </div>
      </div>

      {/* Winners by context */}
      <div className="rounded-3xl border border-neutral-200/60 bg-white p-6 shadow-sm">
        <h3 className="font-display font-bold text-lg text-neutral-900 mb-4">Winners by context</h3>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(WINNER_CONTEXT_LABELS) as Array<keyof typeof WINNER_CONTEXT_LABELS>).map((key) => {
            const pid = result.winnersByContext[key]
            if (typeof pid !== 'number') return null
            const label = WINNER_CONTEXT_LABELS[key]
            const letter = productLetter(ids, pid)
            const title = products?.find((p) => p.id === pid)?.title
            return (
              <span
                key={key}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-neutral-100 text-sm text-neutral-800 border border-neutral-200/80"
              >
                <span className="font-semibold text-violet-700">{label}:</span>
                <span className="font-mono text-xs bg-white px-1.5 py-0.5 rounded border border-neutral-200">{letter}</span>
                {title && <span className="text-xs text-neutral-600 truncate max-w-[140px]">{title}</span>}
              </span>
            )
          })}
        </div>
      </div>

      {/* Attraction */}
      {attraction &&
        (attraction.explanation.length > 0 ||
          attraction.scores.length > 0 ||
          attraction.firstAttractionProductId != null) && (
        <div className="rounded-3xl border border-neutral-200/60 bg-white p-6 shadow-sm">
          <h3 className="font-display font-bold text-lg text-neutral-900 mb-3 flex items-center gap-2">
            <Eye className="w-5 h-5 text-violet-600" />
            Attraction
          </h3>
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
        <div className="rounded-3xl border border-neutral-200/60 bg-white p-6 shadow-sm">
          <h3 className="font-display font-bold text-lg text-neutral-900 mb-3">Visual differences</h3>
          <BulletList items={result.stepInsights.visualDifferences} icon={CheckCircle} tone="neutral" />
        </div>
      )}

      {/* Tension axes */}
      {result.tensionAxes?.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-display font-bold text-lg text-neutral-900">Tension axes</h3>
          <div className="grid md:grid-cols-2 gap-4">
            {result.tensionAxes.map((axis) => (
              <TensionAxisRow key={axis.axis} axis={axis} productIds={ids} />
            ))}
          </div>
        </div>
      )}

      {/* Why not both */}
      {result.whyNotBoth?.enabled && (
        <div className="rounded-3xl border border-fuchsia-200/80 bg-fuchsia-50/40 p-6 shadow-sm">
          <h3 className="font-display font-bold text-lg text-neutral-900 mb-3 flex items-center gap-2">
            <Split className="w-5 h-5 text-fuchsia-600" />
            Why not both?
          </h3>
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
        <div className="rounded-3xl border border-neutral-200/60 bg-white p-6 shadow-sm">
          <h3 className="font-display font-bold text-lg text-neutral-900 mb-3 flex items-center gap-2">
            <Shirt className="w-5 h-5 text-violet-600" />
            Outfit impact
          </h3>
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
        <div className="rounded-3xl border border-neutral-200/60 bg-white p-6 shadow-sm">
          <h3 className="font-display font-bold text-lg text-neutral-900 mb-3 flex items-center gap-2">
            <Users className="w-5 h-5 text-violet-600" />
            Social mirror
          </h3>
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
        <div className="rounded-3xl border border-neutral-200/60 bg-white p-6 shadow-sm">
          <h3 className="font-display font-bold text-lg text-neutral-900 mb-3">People like you</h3>
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
              className={`relative rounded-2xl border bg-white shadow-sm overflow-hidden transition-shadow hover:shadow-lg ${
                contexts.includes('overall') ? 'border-violet-300 ring-2 ring-violet-200/50' : 'border-neutral-200/80'
              }`}
            >
              {contexts.length > 0 && (
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
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-gradient-to-br from-violet-100 to-fuchsia-100 text-sm font-bold text-violet-700">
                        {letter}
                      </span>
                      {contexts.slice(0, 3).map((c) => (
                        <span
                          key={c}
                          className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-amber-100 text-amber-800"
                        >
                          {WINNER_CONTEXT_LABELS[c]}
                        </span>
                      ))}
                    </div>
                    <p className="font-semibold text-neutral-900 text-sm line-clamp-1">{product?.title ?? `Product ${productId}`}</p>
                    <p className="text-xs text-neutral-500 mt-0.5">{product?.brand ?? ''}</p>
                  </div>
                  {insight && <ScoreRing score={overall} color={ringColor} />}
                </div>

                {insight && (
                  <>
                    <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-neutral-600">
                      <span>Value {normalizeScoreDisplay(insight.scores.value)}</span>
                      <span>Quality {normalizeScoreDisplay(insight.scores.quality)}</span>
                      <span>Style {normalizeScoreDisplay(insight.scores.style)}</span>
                      <span>Risk {normalizeScoreDisplay(insight.scores.risk)}</span>
                      <span>Practical {normalizeScoreDisplay(insight.scores.practical)}</span>
                      <span>Expressive {normalizeScoreDisplay(insight.scores.expressive)}</span>
                    </div>

                    <div className="mt-4 space-y-3 text-sm border-t border-neutral-100 pt-4">
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
    </motion.div>
  )
}
