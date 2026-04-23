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
          ? "It gives an instant wow feeling and makes a strong first impression."
          : "It feels like a noticeable upgrade from your first wear.",
      longTermReality: `Over time, you might wear it less often because ${dominantDriver}.`,
    };
  }
  if (regretProbability >= 0.45) {
    return {
      shortTermFeeling:
        practicalStrength >= 0.62
          ? "Early on, it feels strong with a nice balance of style payoff and everyday use."
          : "At first it feels like a good change, especially for planned outfits.",
      longTermReality: `Best for selected situations over time; keep in mind that ${dominantDriver}.`,
    };
  }
  return {
    shortTermFeeling:
      practicalStrength >= 0.72
        ? "Feels dependable from day one and easy to keep wearing."
        : practicalStrength >= 0.6
          ? "Feels dependable quickly without pushing you into a bold style move."
          : "Easy to like now without feeling like a risky buy.",
    longTermReality:
      practicalStrength >= 0.72
        ? "Likely to stay in your regular rotation with low regret risk."
        : practicalStrength >= 0.6
          ? `Should stay wearable over time, although ${dominantDriver}.`
          : `Can still hold up long term, although ${dominantDriver}.`,
  };
}
