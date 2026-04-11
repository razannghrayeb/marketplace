import { compareProductsWithVerdict } from "./compare.service";
import type { CompareDecisionRequestParsed } from "./compare-decision.schema";
import { legacyCompareToDecisionResponse, type CompareDecisionResponse } from "./compare-decision.adapter";

export type { CompareDecisionResponse };

export async function runCompareDecision(req: CompareDecisionRequestParsed): Promise<CompareDecisionResponse> {
  const legacy = await compareProductsWithVerdict(req.productIds);
  return legacyCompareToDecisionResponse(legacy, req);
}
