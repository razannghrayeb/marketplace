import type { ProductDecisionProfile } from "../types";
import { clamp01 } from "./scoreUtils";

const categoryWearPriors: Record<string, number> = {
  tops: 7,
  bottoms: 7,
  one_piece: 5,
  outerwear: 4,
  footwear: 6,
  accessories: 8,
  other: 5,
};

export function estimateWearFrequency(
  profile: ProductDecisionProfile,
  majorCategory: string
): {
  estimatedMonthlyWear: number;
  confidence: number;
  explanation: string[];
} {
  const prior = categoryWearPriors[majorCategory] ?? categoryWearPriors.other;

  const wearMultiplier = clamp01(
    profile.usageSignals.repeatWearPotential * 0.35 +
      profile.usageSignals.versatility * 0.2 +
      (1 - profile.usageSignals.seasonality) * 0.15 +
      profile.usageSignals.stylingEase * 0.15 +
      profile.usageSignals.occasionRange * 0.15
  );

  const estimatedMonthlyWear = Math.max(1, Math.round(prior * (0.6 + wearMultiplier)));
  const confidence = clamp01(
    profile.trustSignals.descriptionClarity * 0.4 +
      profile.trustSignals.photoToRealityConfidence * 0.35 +
      profile.trustSignals.imageQuality * 0.25
  );

  const explanation = [
    `Estimated around ${estimatedMonthlyWear} wears per month based on how easy this category is to rewear.`,
  ];
  if (profile.usageSignals.versatility < 0.45) {
    explanation.push("Lower versatility may limit how often you naturally reach for it each week.");
  }

  return { estimatedMonthlyWear, confidence, explanation };
}
