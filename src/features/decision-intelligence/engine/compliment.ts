import type { ProductDecisionProfile } from "../types";
import { clamp01 } from "./scoreUtils";

export function predictCompliment(
  profile: ProductDecisionProfile,
  occasionScore: number
): {
  score: number;
  type:
    | "direct_compliments"
    | "subtle_admiration"
    | "polished_respect"
    | "stylish_attention"
    | "low_reaction_high_utility";
  explanation: string[];
} {
  const score = clamp01(
    profile.derivedSignals.socialVisibility * 0.35 +
      profile.imageSignals.visualBoldness * 0.2 +
      profile.styleSignals.polished * 0.18 +
      profile.styleSignals.expressive * 0.17 +
      profile.derivedSignals.statementLevel * 0.1
  );

  if (score >= 0.78) {
    return {
      score,
      type: "direct_compliments",
      explanation: ["High visibility and expressive contrast tend to attract immediate comments."],
    };
  }
  if (score >= 0.62) {
    return {
      score,
      type: profile.styleSignals.polished > profile.styleSignals.expressive ? "polished_respect" : "stylish_attention",
      explanation: [
        "Balanced social visibility with coherent styling suggests noticeable positive reactions.",
      ],
    };
  }
  if (score >= 0.45) {
    return {
      score,
      type: "subtle_admiration",
      explanation: ["Likely to be appreciated more for consistency than for statement impact."],
    };
  }
  return {
    score,
    type: "low_reaction_high_utility",
    explanation: [
      occasionScore > 0.6
        ? "This item leans practical and occasion-appropriate over social spotlight."
        : "Low social visibility profile keeps reactions muted while staying useful.",
    ],
  };
}
