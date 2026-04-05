import type {
  CompareBusinessMode,
  CompareDecisionRequest,
  CompareGoal,
  CompareOccasion,
} from './types'

export interface CompareDecisionDraft {
  productIds: number[]
  compareGoal: CompareGoal
  occasion?: CompareOccasion | ''
  mode: CompareBusinessMode
  currentSelf: string
  aspirationalSelf: string
  firstAttractionProductId?: number
  safeBoldPreference: number
  practicalExpressivePreference: number
  polishedEffortlessPreference: number
}

function parseIdentityInput(raw: string): string[] {
  return raw
    .split(/[\n,;|]+/)
    .map((v) => v.trim())
    .filter(Boolean)
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0.5
  return Math.max(0, Math.min(1, value))
}

export function buildCompareDecisionRequest(draft: CompareDecisionDraft): CompareDecisionRequest {
  const req: CompareDecisionRequest = {
    productIds: draft.productIds,
    compareGoal: draft.compareGoal,
    mode: draft.mode,
    userSignals: {
      firstAttractionProductId: draft.firstAttractionProductId,
      safeBoldPreference: clamp01(draft.safeBoldPreference),
      practicalExpressivePreference: clamp01(draft.practicalExpressivePreference),
      polishedEffortlessPreference: clamp01(draft.polishedEffortlessPreference),
    },
  }

  if (draft.occasion) req.occasion = draft.occasion

  const currentSelf = parseIdentityInput(draft.currentSelf)
  const aspirationalSelf = parseIdentityInput(draft.aspirationalSelf)
  if (currentSelf.length > 0 || aspirationalSelf.length > 0) {
    req.identityContext = {
      ...(currentSelf.length > 0 ? { currentSelf } : {}),
      ...(aspirationalSelf.length > 0 ? { aspirationalSelf } : {}),
    }
  }

  if (!req.userSignals?.firstAttractionProductId) {
    delete req.userSignals?.firstAttractionProductId
  }

  return req
}
