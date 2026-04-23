import type { ProductDecisionProfile } from "../types";
import { clamp01 } from "./scoreUtils";

export function analyzePhotoRealityGap(
  profile: ProductDecisionProfile
): {
  score: number;
  label: "photo_stronger" | "real_life_stronger" | "aligned";
  explanation: string[];
} {
  const confidence = clamp01(
    profile.imageSignals.realismConfidence * 0.35 +
      profile.trustSignals.photoToRealityConfidence * 0.35 +
      profile.trustSignals.imageQuality * 0.15 +
      profile.trustSignals.descriptionClarity * 0.15
  );

  const mismatch = clamp01(
    Math.abs(profile.imageSignals.detailDensity - profile.usageSignals.maintenanceEase) * 0.6 +
      (1 - confidence) * 0.4
  );

  const label: "photo_stronger" | "real_life_stronger" | "aligned" =
    confidence >= 0.62 ? "aligned" : mismatch >= 0.55 ? "photo_stronger" : "real_life_stronger";

  const explanation: string[] = [];
  if (label === "aligned") {
    explanation.push("Photos look close to what you should expect in real life.");
  } else if (label === "photo_stronger") {
    explanation.push("Photos may feel a bit more impressive than the item does in everyday wear.");
  } else {
    explanation.push("This one may look even better in person than in the listing photos.");
  }

  return {
    score: confidence,
    label,
    explanation,
  };
}
