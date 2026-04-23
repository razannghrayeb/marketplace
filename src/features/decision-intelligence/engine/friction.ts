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
    explanation.push("Needs more styling effort to look put together.");
  }
  if (values.inverseVersatility > 0.55) {
    explanation.push("Pairs well with fewer pieces in your closet.");
  }
  if (values.maintenanceBurden > 0.55) {
    explanation.push("Care needs are a bit higher than average.");
  }
  if (values.statementPenalty > 0.6) {
    explanation.push("The bold look can make it less of an everyday default.");
  }

  if (explanation.length === 0) {
    if (clampedIndex <= 0.24) {
      explanation.push("Very easy to wear repeatedly through the week.");
    } else if (clampedIndex <= 0.34) {
      explanation.push("Low-friction choice with strong repeat-wear potential.");
    } else {
      explanation.push("Generally practical, with a few styling limits to keep in mind.");
    }
  }

  return { index: clampedIndex, explanation };
}
