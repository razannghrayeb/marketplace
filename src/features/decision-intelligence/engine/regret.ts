import type { ProductDecisionProfile } from "../types";
import { clamp01 } from "./scoreUtils";

export function scoreRegretProbability(
  profile: ProductDecisionProfile,
  attractionScore: number,
  frictionIndex: number
): number {
  return clamp01(
    attractionScore * 0.24 +
      (1 - profile.usageSignals.repeatWearPotential) * 0.22 +
      profile.derivedSignals.trendVolatility * 0.16 +
      frictionIndex * 0.18 +
      (1 - profile.trustSignals.photoToRealityConfidence) * 0.12 +
      (1 - profile.usageSignals.occasionRange) * 0.08
  );
}

export function buildRegretFlash(
  profile: ProductDecisionProfile,
  regretProbability: number
): { shortTermFeeling: string; longTermReality: string } {
  if (regretProbability >= 0.68) {
    return {
      shortTermFeeling: "Immediate excitement and visual payoff.",
      longTermReality: "Likely to become an occasional piece with lower repeat wear.",
    };
  }
  if (regretProbability >= 0.45) {
    return {
      shortTermFeeling: "Feels like a strong upgrade in the short term.",
      longTermReality: "Useful in selective contexts, but not the easiest weekly default.",
    };
  }
  return {
    shortTermFeeling: "Feels satisfying without overcommitting.",
    longTermReality: "Sustains repeat wear with lower post-purchase regret risk.",
  };
}
