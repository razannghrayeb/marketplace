import type { ProductDecisionProfile } from "../types";
import { clamp01 } from "./scoreUtils";

export function scoreOutfitImpact(
  profiles: ProductDecisionProfile[]
): {
  enabled: boolean;
  versatilityScores: Array<{ productId: number; score: number }>;
  wardrobeGapFillScores: Array<{ productId: number; score: number }>;
  explanation: string[];
} {
  const categoryCounts = new Map<string, number>();
  for (const p of profiles) {
    const c = p.category.toLowerCase();
    categoryCounts.set(c, (categoryCounts.get(c) || 0) + 1);
  }

  const versatilityScores = profiles.map((p) => ({
    productId: p.id,
    score: clamp01(p.usageSignals.versatility * 0.5 + p.imageSignals.outfitFlexibilityVisual * 0.5),
  }));

  const wardrobeGapFillScores = profiles.map((p) => {
    const c = p.category.toLowerCase();
    const rarityBoost = clamp01(1 - Math.min(1, (categoryCounts.get(c) || 1) / profiles.length));
    const score = clamp01(
      rarityBoost * 0.4 +
        p.usageSignals.occasionRange * 0.3 +
        p.usageSignals.repeatWearPotential * 0.3
    );
    return { productId: p.id, score };
  });

  return {
    enabled: true,
    versatilityScores,
    wardrobeGapFillScores,
    explanation: [
      "Outfit impact emphasizes wardrobe coverage over forced direct winner logic.",
      "Gap-fill scoring rewards category rarity plus cross-occasion utility.",
    ],
  };
}
