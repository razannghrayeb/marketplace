import { describe, expect, it } from 'vitest'
import type { CompareDecisionResponse } from '@/types/compareDecision'
import {
  getContextsWonByProduct,
  getProductInsightById,
  getTensionAxisByType,
  normalizeScoreDisplay,
  productLetter,
  unwrapCompareDecisionResponse,
} from '@/lib/compare-decision/selectors'

function minimalResponse(overrides: Partial<CompareDecisionResponse> = {}): CompareDecisionResponse {
  const base: CompareDecisionResponse = {
    comparisonMode: 'direct_head_to_head',
    comparisonContext: {
      productIds: [1, 2],
      evaluatedAt: '2026-01-01T00:00:00.000Z',
      version: 'test',
      modeReason: 'reason',
      dataQuality: { overallScore: 80, notes: [] },
    },
    stepInsights: {
      visualDifferences: [],
      consequences: [],
      regretFlash: [],
      identityAlignment: [],
    },
    productInsights: [
      {
        productId: 1,
        frictionIndex: 10,
        frictionExplanation: [],
        complimentPrediction: {
          score: 70,
          type: 'stylish_attention',
          explanation: [],
        },
        wearFrequency: { estimatedMonthlyWear: 4, confidence: 0.5, explanation: [] },
        photoRealityGap: { score: 0.8, label: 'aligned', explanation: [] },
        hiddenFlaw: '',
        microStory: '',
        scores: {
          value: 80,
          quality: 80,
          style: 80,
          risk: 20,
          occasion: 80,
          overall: 80,
          practical: 80,
          expressive: 80,
          currentSelf: 80,
          aspirationalSelf: 80,
        },
      },
    ],
    tensionAxes: [],
    decisionConfidence: { level: 'leaning_choice', score: 60, explanation: [] },
    winnersByContext: { overall: 1, practical: 1 },
  }
  return { ...base, ...overrides }
}

describe('unwrapCompareDecisionResponse', () => {
  it('reads flat response', () => {
    const r = minimalResponse()
    expect(unwrapCompareDecisionResponse(r)).toEqual(r)
  })

  it('reads wrapped data', () => {
    const r = minimalResponse()
    expect(unwrapCompareDecisionResponse({ success: true, data: r })).toEqual(r)
  })

  it('returns null on failure envelope', () => {
    expect(unwrapCompareDecisionResponse({ success: false, error: { message: 'x' } })).toBeNull()
  })

  it('returns null on garbage', () => {
    expect(unwrapCompareDecisionResponse({ foo: 1 })).toBeNull()
  })
})

describe('getProductInsightById', () => {
  it('returns undefined when missing', () => {
    const r = minimalResponse({ productInsights: [] })
    expect(getProductInsightById(r, 99)).toBeUndefined()
  })

  it('returns row', () => {
    const r = minimalResponse()
    expect(getProductInsightById(r, 1)?.frictionIndex).toBe(10)
  })
})

describe('getContextsWonByProduct', () => {
  it('lists keys where product wins', () => {
    const r = minimalResponse({
      winnersByContext: { overall: 2, value: 2, practical: 1 },
    })
    expect(getContextsWonByProduct(r, 2).sort()).toEqual(['overall', 'value'])
  })
})

describe('getTensionAxisByType', () => {
  it('finds axis', () => {
    const r = minimalResponse({
      tensionAxes: [
        {
          axis: 'safe_bold',
          leftLabel: 'L',
          rightLabel: 'R',
          positions: [{ productId: 1, value: 0.5 }],
        },
      ],
    })
    expect(getTensionAxisByType(r, 'safe_bold')?.leftLabel).toBe('L')
    expect(getTensionAxisByType(r, 'practical_statement')).toBeUndefined()
  })
})

describe('normalizeScoreDisplay', () => {
  it('maps 0–1 to percent', () => {
    expect(normalizeScoreDisplay(0.72)).toBe(72)
  })

  it('rounds 0–100', () => {
    expect(normalizeScoreDisplay(73.5)).toBe(74)
  })
})

describe('productLetter', () => {
  it('maps index to letter', () => {
    expect(productLetter([10, 20], 20)).toBe('B')
  })
})
