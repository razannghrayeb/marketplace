import type { ProductDecisionProfile } from "../types";
import { clamp01 } from "./scoreUtils";

function dominantRegretDriver(profile: ProductDecisionProfile): string {
  const drivers = [
    {
      key: "low_repeat_wear",
      score: 1 - profile.usageSignals.repeatWearPotential,
      label: "repeat-wear depth may be limited",
    },
    {
      key: "trend_volatility",
      score: profile.derivedSignals.trendVolatility,
      label: "trend curve may move quickly",
    },
    {
      key: "maintenance_burden",
      score: 1 - profile.usageSignals.maintenanceEase,
      label: "care requirements can add friction",
    },
    {
      key: "photo_confidence_gap",
      score: 1 - profile.trustSignals.photoToRealityConfidence,
      label: "in-person expectation match is less certain",
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
          ? "Immediate impact feels high-energy and attention-grabbing."
          : "Feels like a meaningful upgrade at first wear.",
      longTermReality: `Long-run usage may narrow because ${dominantDriver}.`,
    };
  }
  if (regretProbability >= 0.45) {
    return {
      shortTermFeeling:
        practicalStrength >= 0.62
          ? "Feels strong early on, with visible payoff and workable day-to-day utility."
          : "Feels like a solid change in the short term, especially in styled outfits.",
      longTermReality: `Useful in selective contexts; watch for drag points because ${dominantDriver}.`,
    };
  }
  return {
    shortTermFeeling:
      practicalStrength >= 0.68
        ? "Feels dependable right away without forcing a bold styling leap."
        : "Feels easy to like now, with low emotional overcommitment.",
    longTermReality:
      practicalStrength >= 0.68
        ? "Sustains repeat wear with low regret pressure across regular outfit cycles."
        : `Should hold up over time, though ${dominantDriver}.`,
  };
}
