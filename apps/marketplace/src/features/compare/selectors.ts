import type { CompareDecisionResponse } from './types'

export function getProductInsightById(response: CompareDecisionResponse | undefined, productId: number) {
  return response?.productInsights.find((p) => p.productId === productId)
}

export function getConsequenceByProductId(response: CompareDecisionResponse | undefined, productId: number) {
  return response?.stepInsights.consequences.find((c) => c.productId === productId)
}

export function getIdentityAlignmentByProductId(response: CompareDecisionResponse | undefined, productId: number) {
  return response?.stepInsights.identityAlignment.find((i) => i.productId === productId)
}

export function getRegretByProductId(response: CompareDecisionResponse | undefined, productId: number) {
  return response?.stepInsights.regretFlash.find((r) => r.productId === productId)
}

export function getWinnerProductId(
  response: CompareDecisionResponse | undefined,
  key: keyof CompareDecisionResponse['winnersByContext'] = 'overall'
): number | null {
  if (!response) return null
  return response.winnersByContext[key] ?? null
}

export function getTensionAxisByType(
  response: CompareDecisionResponse | undefined,
  axis: 'safe_bold' | 'versatile_expressive' | 'polished_effortless' | 'practical_statement'
) {
  return response?.tensionAxes.find((a) => a.axis === axis)
}

export function getAttractionState(response: CompareDecisionResponse | undefined) {
  const attraction = response?.stepInsights.attraction
  return {
    firstAttractionProductId: attraction?.firstAttractionProductId,
    attractionScores: attraction?.attractionScores ?? [],
    explanation: attraction?.explanation ?? [],
    enabled: Boolean(attraction),
  }
}

export function getModeLabel(mode: CompareDecisionResponse['comparisonMode'] | undefined): string {
  if (!mode) return 'Compare'
  if (mode === 'direct_head_to_head') return 'Head-to-head compare'
  if (mode === 'scenario_compare') return 'Scenario compare'
  return 'Outfit impact compare'
}
