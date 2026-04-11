import type { CompareDecisionRequest } from "../types";

export const mockDecisionRequests: CompareDecisionRequest[] = [
  {
    productIds: [101, 205],
    compareGoal: "best_value",
    occasion: "work",
    mode: "standard",
    identityContext: {
      currentSelf: ["polished", "timeless"],
      aspirationalSelf: ["confident", "expressive"],
    },
    userSignals: {
      firstAttractionProductId: 101,
      safeBoldPreference: 0.35,
      practicalExpressivePreference: 0.4,
      polishedEffortlessPreference: 0.3,
    },
  },
  {
    productIds: [101, 309],
    compareGoal: "occasion_fit",
    occasion: "party",
    mode: "alter_ego",
  },
];
