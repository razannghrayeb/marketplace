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
      explanation: ["This look is likely to get immediate compliments because it stands out clearly."],
    };
  }
  if (score >= 0.62) {
    return {
      score,
      type: profile.styleSignals.polished > profile.styleSignals.expressive ? "polished_respect" : "stylish_attention",
      explanation: [
        "People are likely to notice this positively without it feeling too loud.",
      ],
    };
  }
  if (score >= 0.45) {
    const primaryDriver =
      profile.styleSignals.polished >= profile.styleSignals.expressive
        ? "polished consistency"
        : "expressive styling cues";
    return {
      score,
      type: "subtle_admiration",
      explanation: [`This is more likely to be appreciated for ${primaryDriver} than for big statement energy.`],
    };
  }
  return {
    score,
    type: "low_reaction_high_utility",
    explanation: [
      occasionScore > 0.6
        ? "This leans practical and occasion-right more than attention-grabbing."
        : "Reactions may be quieter, but it stays useful and easy to wear.",
    ],
  };
}
