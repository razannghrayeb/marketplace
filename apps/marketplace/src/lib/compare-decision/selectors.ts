import type { CompareDecisionResponse, TensionAxisType } from '@/types/compareDecision'

export type ProductInsightsEntry = CompareDecisionResponse['productInsights'][number]

export function unwrapCompareDecisionResponse(raw: unknown): CompareDecisionResponse | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.success === 'boolean' && o.success === false) return null
  const inner = o.data
  if (inner && typeof inner === 'object' && isCompareDecisionShape(inner)) {
    return inner as CompareDecisionResponse
  }
  if (isCompareDecisionShape(o)) return o as CompareDecisionResponse
  return null
}

function isCompareDecisionShape(v: object): boolean {
  return (
    'comparisonMode' in v &&
    'comparisonContext' in v &&
    'stepInsights' in v &&
    'productInsights' in v &&
    'decisionConfidence' in v &&
    'winnersByContext' in v
  )
}

export function indexByProductId<T extends { productId: number }>(
  items: T[] | undefined,
): Map<number, T> {
  const m = new Map<number, T>()
  if (!items) return m
  for (const item of items) m.set(item.productId, item)
  return m
}

export function getProductInsightById(
  response: CompareDecisionResponse,
  productId: number,
): ProductInsightsEntry | undefined {
  return response.productInsights.find((p) => p.productId === productId)
}

export function getConsequenceByProductId(
  response: CompareDecisionResponse,
  productId: number,
): CompareDecisionResponse['stepInsights']['consequences'][number] | undefined {
  return response.stepInsights.consequences.find((c) => c.productId === productId)
}

export function getIdentityAlignmentByProductId(
  response: CompareDecisionResponse,
  productId: number,
): CompareDecisionResponse['stepInsights']['identityAlignment'][number] | undefined {
  return response.stepInsights.identityAlignment.find((x) => x.productId === productId)
}

export function getRegretFlashByProductId(
  response: CompareDecisionResponse,
  productId: number,
): CompareDecisionResponse['stepInsights']['regretFlash'][number] | undefined {
  return response.stepInsights.regretFlash.find((r) => r.productId === productId)
}

export function getWinnerProductIdForContext(
  response: CompareDecisionResponse,
  context: keyof CompareDecisionResponse['winnersByContext'],
): number | undefined {
  const v = response.winnersByContext[context]
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

export function getContextsWonByProduct(
  response: CompareDecisionResponse,
  productId: number,
): Array<keyof CompareDecisionResponse['winnersByContext']> {
  const w = response.winnersByContext
  const keys = Object.keys(w) as Array<keyof typeof w>
  return keys.filter((k) => w[k] === productId)
}

export function getTensionAxisByType(
  response: CompareDecisionResponse,
  axis: TensionAxisType,
): CompareDecisionResponse['tensionAxes'][number] | undefined {
  return response.tensionAxes.find((a) => a.axis === axis)
}

export function getAttractionState(response: CompareDecisionResponse): {
  firstAttractionProductId: number | undefined
  scores: Array<{ productId: number; score: number }>
  explanation: string[]
} | null {
  const a = response.stepInsights?.attraction
  if (!a) return null
  return {
    firstAttractionProductId: a.firstAttractionProductId,
    scores: a.attractionScores ?? [],
    explanation: a.explanation ?? [],
  }
}

export function productLetter(productIds: number[], productId: number): string {
  const idx = productIds.indexOf(productId)
  if (idx < 0) return '?'
  return String.fromCharCode(65 + idx)
}

/** Map numeric score to 0–100 for rings / bars (supports 0–1 or 0–100 from API). */
export function normalizeScoreDisplay(score: number | undefined): number {
  if (score == null || !Number.isFinite(score)) return 0
  const s = Math.max(0, score)
  return s <= 1 ? Math.round(s * 100) : Math.round(Math.min(100, s))
}
