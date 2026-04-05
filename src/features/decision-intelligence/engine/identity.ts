import type { ProductDecisionProfile } from "../types";
import { clamp01 } from "./scoreUtils";

const identitySignalMap: Record<string, Array<{ signal: keyof ProductDecisionProfile["styleSignals"] | "visualBoldness" | "practicalStrength"; weight: number }>> = {
  confident: [
    { signal: "polished", weight: 0.35 },
    { signal: "visualBoldness", weight: 0.35 },
    { signal: "practicalStrength", weight: 0.3 },
  ],
  relaxed: [
    { signal: "relaxed", weight: 0.6 },
    { signal: "practicalStrength", weight: 0.4 },
  ],
  bold: [
    { signal: "visualBoldness", weight: 0.45 },
    { signal: "edgy", weight: 0.25 },
    { signal: "expressive", weight: 0.3 },
  ],
  polished: [
    { signal: "polished", weight: 0.6 },
    { signal: "minimal", weight: 0.2 },
    { signal: "classic", weight: 0.2 },
  ],
  feminine: [
    { signal: "feminine", weight: 0.7 },
    { signal: "expressive", weight: 0.3 },
  ],
  edgy: [
    { signal: "edgy", weight: 0.65 },
    { signal: "visualBoldness", weight: 0.35 },
  ],
  timeless: [
    { signal: "classic", weight: 0.65 },
    { signal: "minimal", weight: 0.35 },
  ],
  expressive: [
    { signal: "expressive", weight: 0.7 },
    { signal: "visualBoldness", weight: 0.3 },
  ],
};

function getSignal(profile: ProductDecisionProfile, key: string): number {
  if (key === "visualBoldness") return profile.imageSignals.visualBoldness;
  if (key === "practicalStrength") return profile.derivedSignals.practicalStrength;
  return profile.styleSignals[key as keyof ProductDecisionProfile["styleSignals"]] ?? 0;
}

function scoreFromLabels(profile: ProductDecisionProfile, labels: string[]): number {
  if (labels.length === 0) return 0.5;
  const scores = labels.map((label) => {
    const mapping = identitySignalMap[label.toLowerCase()];
    if (!mapping) return 0.5;
    const sum = mapping.reduce((acc, item) => acc + getSignal(profile, item.signal) * item.weight, 0);
    const weight = mapping.reduce((acc, item) => acc + item.weight, 0);
    return weight > 0 ? sum / weight : 0.5;
  });
  return clamp01(scores.reduce((acc, s) => acc + s, 0) / scores.length);
}

export function scoreIdentityAlignment(
  profile: ProductDecisionProfile,
  currentSelf: string[] = [],
  aspirationalSelf: string[] = []
): { currentSelfScore: number; aspirationalSelfScore: number; explanation: string[] } {
  const currentSelfScore = scoreFromLabels(profile, currentSelf);
  const aspirationalSelfScore = scoreFromLabels(profile, aspirationalSelf);

  const explanation: string[] = [];
  if (currentSelf.length > 0) {
    explanation.push(
      `Current-self fit tracks ${Math.round(currentSelfScore * 100)}% across your selected identity markers.`
    );
  }
  if (aspirationalSelf.length > 0) {
    explanation.push(
      `Aspirational fit tracks ${Math.round(aspirationalSelfScore * 100)}% toward how you want to show up.`
    );
  }
  if (explanation.length === 0) {
    explanation.push("No identity terms provided, so alignment is scored from neutral baseline.");
  }

  return { currentSelfScore, aspirationalSelfScore, explanation };
}
