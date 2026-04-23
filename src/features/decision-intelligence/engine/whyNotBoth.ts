import type { ComparisonMode, ProductDecisionProfile } from "../types";
import { decisionScoringConfig } from "./scoringConfig";

export function detectWhyNotBoth(input: {
  mode: ComparisonMode;
  sortedByOverall: Array<{ productId: number; overall: number; practical: number; expressive: number }>;
  profilesById: Map<number, ProductDecisionProfile>;
}): {
  enabled: boolean;
  explanation: string[];
  productRoles: Array<{ productId: number; role: string }>;
} | undefined {
  if (input.sortedByOverall.length < 2) return undefined;

  const [a, b] = input.sortedByOverall;
  const margin = a.overall - b.overall;
  const practicalGap = Math.abs(a.practical - b.practical);
  const expressiveGap = Math.abs(a.expressive - b.expressive);
  const complementarity = (practicalGap + expressiveGap) / 2;

  const shouldEnable =
    margin <= decisionScoringConfig.whyNotBoth.maxTopMargin &&
    complementarity >= decisionScoringConfig.whyNotBoth.minComplementarity;

  if (!shouldEnable) return undefined;

  const roleA = a.practical > a.expressive ? "daily_anchor" : "statement_lift";
  const roleB = b.practical > b.expressive ? "daily_anchor" : "statement_lift";

  return {
    enabled: true,
    explanation: [
      "The top options are close overall, but they solve different shopping needs.",
      "Keeping both can make sense when you want one everyday piece and one more expressive piece.",
      input.mode === "outfit_compare"
        ? "Because the items live in different wardrobe areas, they can work together instead of competing directly."
        : "Their different strengths make a two-item choice feel more balanced than picking only one.",
    ],
    productRoles: [
      { productId: a.productId, role: roleA },
      { productId: b.productId, role: roleB },
    ],
  };
}
