import type { ProductDecisionProfile } from "../types";
import { decisionScoringConfig } from "./scoringConfig";
import { clamp01, weightedSum } from "./scoreUtils";

export function scoreFrictionIndex(
  profile: ProductDecisionProfile
): { index: number; explanation: string[] } {
  const values = {
    inverseStylingEase: 1 - profile.usageSignals.stylingEase,
    inverseVersatility: 1 - profile.usageSignals.versatility,
    inverseOccasionRange: 1 - profile.usageSignals.occasionRange,
    maintenanceBurden: 1 - profile.usageSignals.maintenanceEase,
    trendVolatility: profile.derivedSignals.trendVolatility,
    detailDensityPenalty: profile.imageSignals.detailDensity,
    statementPenalty: profile.derivedSignals.statementLevel,
  };

  const index = weightedSum(values, decisionScoringConfig.frictionWeights);
  const clampedIndex = clamp01(index);

  const explanation: string[] = [];
  if (values.inverseStylingEase > 0.55) {
    explanation.push("Requires more styling effort to look intentional.");
  }
  if (values.inverseVersatility > 0.55) {
    explanation.push("Works in fewer outfit combinations.");
  }
  if (values.maintenanceBurden > 0.55) {
    explanation.push("Care routine is above average for repeat wear.");
  }
  if (values.statementPenalty > 0.6) {
    explanation.push("High statement profile can reduce everyday utility.");
  }

  if (explanation.length === 0) {
    if (clampedIndex <= 0.24) {
      explanation.push("Very low-friction profile with easy repeat-wear across weekly outfits.");
    } else if (clampedIndex <= 0.34) {
      explanation.push("Low-friction item with strong repeat-wear practicality.");
    } else {
      explanation.push("Moderately low-friction profile; practical overall with a few styling constraints.");
    }
  }

  return { index: clampedIndex, explanation };
}
