import { describe, expect, it } from 'vitest'
import { buildCompareDecisionRequest, parseTagString } from '@/lib/compare-decision/buildRequest'

describe('parseTagString', () => {
  it('splits comma and semicolon', () => {
    expect(parseTagString('a, b; c')).toEqual(['a', 'b', 'c'])
  })
})

describe('buildCompareDecisionRequest', () => {
  it('includes productIds and mode', () => {
    const req = buildCompareDecisionRequest([1, 2], {
      mode: 'standard',
      currentSelfRaw: '',
      aspirationalSelfRaw: '',
    })
    expect(req.productIds).toEqual([1, 2])
    expect(req.mode).toBe('standard')
    expect(req.userSignals).toBeUndefined()
  })

  it('adds identity and signals when set', () => {
    const req = buildCompareDecisionRequest([1, 2], {
      mode: 'alter_ego',
      compareGoal: 'best_value',
      occasion: 'work',
      currentSelfRaw: 'minimal, quiet',
      aspirationalSelfRaw: 'bold',
      firstAttractionProductId: 2,
      safeBoldPreference: 0.7,
      practicalExpressivePreference: 0.4,
      polishedEffortlessPreference: 0.55,
    })
    expect(req.identityContext?.currentSelf).toEqual(['minimal', 'quiet'])
    expect(req.identityContext?.aspirationalSelf).toEqual(['bold'])
    expect(req.userSignals?.firstAttractionProductId).toBe(2)
    expect(req.userSignals?.safeBoldPreference).toBe(0.7)
    expect(req.compareGoal).toBe('best_value')
    expect(req.occasion).toBe('work')
  })

  it('coerces string firstAttractionProductId and productIds to numbers', () => {
    const req = buildCompareDecisionRequest([1, '2'] as unknown as number[], {
      mode: 'standard',
      currentSelfRaw: '',
      aspirationalSelfRaw: '',
      firstAttractionProductId: '2',
    })
    expect(req.productIds).toEqual([1, 2])
    expect(req.userSignals?.firstAttractionProductId).toBe(2)
  })
})
