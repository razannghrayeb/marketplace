import type { ProductDecisionProfile } from "../types";
import { clamp01 } from "./scoreUtils";

function dominantRegretDriver(profile: ProductDecisionProfile): string {
  const drivers = [
    {
      key: "low_repeat_wear",
      score: 1 - profile.usageSignals.repeatWearPotential,
      label: "you may not reach for it as often after the first few wears",
    },
    {
      key: "trend_volatility",
      score: profile.derivedSignals.trendVolatility,
      label: "the style may feel dated sooner than expected",
    },
    {
      key: "maintenance_burden",
      score: 1 - profile.usageSignals.maintenanceEase,
      label: "care needs may make it harder to wear regularly",
    },
    {
      key: "photo_confidence_gap",
      score: 1 - profile.trustSignals.photoToRealityConfidence,
      label: "it may look different in person than it does online",
    },
  ].sort((a, b) => b.score - a.score);

  return drivers[0]?.label ?? "weekly utility may vary";
}

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
  const statementLevel = profile.derivedSignals.statementLevel;
  const practicalStrength = profile.derivedSignals.practicalStrength;
  const dominantDriver = dominantRegretDriver(profile);

  if (regretProbability >= 0.68) {
    return {
      shortTermFeeling:
        statementLevel >= 0.6
          ? "It feels exciting right away and has strong first impression energy."
          : "It feels like a clear upgrade when you first wear it.",
      longTermReality: `Over time, usage may drop because ${dominantDriver}.`,
    };
  }
  if (regretProbability >= 0.45) {
    return {
      shortTermFeeling:
        practicalStrength >= 0.62
          ? "Feels strong early, with a good mix of payoff and day-to-day usability."
          : "Feels like a solid change at first, especially for planned outfits.",
      longTermReality: `Likely best in selected situations; watch for friction because ${dominantDriver}.`,
    };
  }
  return {
    shortTermFeeling:
      practicalStrength >= 0.72
        ? "Feels dependable from day one and easy to keep in rotation."
        : practicalStrength >= 0.6
          ? "Feels dependable quickly without forcing a bold style move."
          : "Easy to like now without feeling like a risky commitment.",
    longTermReality:
      practicalStrength >= 0.72
        ? "Likely to stay in regular rotation with low regret risk."
        : practicalStrength >= 0.6
          ? `Should remain wearable over time, though ${dominantDriver}.`
          : `Can still hold up long term, though ${dominantDriver}.`,
  };
}
