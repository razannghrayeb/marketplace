import type { CompareDecisionRequest, CompareGoal, CompareMode, CompareOccasion } from '@/types/compareDecision'

export function parseTagString(s: string): string[] {
  return s
    .split(/[,;\n]+/)
    .map((t) => t.trim())
    .filter(Boolean)
}

export type CompareDecisionFormState = {
  compareGoal?: CompareGoal
  occasion?: CompareOccasion
  mode: CompareMode
  currentSelfRaw: string
  aspirationalSelfRaw: string
  firstAttractionProductId?: number
  safeBoldPreference?: number
  practicalExpressivePreference?: number
  polishedEffortlessPreference?: number
}

export function buildCompareDecisionRequest(
  productIds: number[],
  form: CompareDecisionFormState,
): CompareDecisionRequest {
  const currentSelf = parseTagString(form.currentSelfRaw)
  const aspirationalSelf = parseTagString(form.aspirationalSelfRaw)

  const req: CompareDecisionRequest = {
    productIds,
    mode: form.mode,
  }

  if (form.compareGoal) req.compareGoal = form.compareGoal
  if (form.occasion) req.occasion = form.occasion

  if (currentSelf.length > 0 || aspirationalSelf.length > 0) {
    req.identityContext = {}
    if (currentSelf.length > 0) req.identityContext.currentSelf = currentSelf
    if (aspirationalSelf.length > 0) req.identityContext.aspirationalSelf = aspirationalSelf
  }

  const us: CompareDecisionRequest['userSignals'] = {}
  if (form.firstAttractionProductId != null) us.firstAttractionProductId = form.firstAttractionProductId
  if (form.safeBoldPreference != null) us.safeBoldPreference = form.safeBoldPreference
  if (form.practicalExpressivePreference != null) us.practicalExpressivePreference = form.practicalExpressivePreference
  if (form.polishedEffortlessPreference != null) us.polishedEffortlessPreference = form.polishedEffortlessPreference
  if (Object.keys(us).length > 0) req.userSignals = us

  return req
}
