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
      "Top options are close overall but excel in different use-cases.",
      "A dual-choice can reduce regret by covering both utility and expression contexts.",
      input.mode === "outfit_compare"
        ? "Mixed-category comparison increases complementarity value."
        : "Complementary style roles justify a dual-ownership recommendation.",
    ],
    productRoles: [
      { productId: a.productId, role: roleA },
      { productId: b.productId, role: roleB },
    ],
  };
}
