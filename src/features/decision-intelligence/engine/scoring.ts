import type {
  CompareDecisionRequest,
  CompareOccasion,
  ProductDecisionProfile,
} from "../types";
import { decisionScoringConfig } from "./scoringConfig";
import { clamp01, normalizePriceScore, weightedSum } from "./scoreUtils";

function materialCue(profile: ProductDecisionProfile): number {
  return clamp01((profile.imageSignals.textureRichness + profile.trustSignals.descriptionClarity) / 2);
}

export function scoreValue(
  profile: ProductDecisionProfile,
  minPrice: number,
  maxPrice: number
): number {
  const values = {
    price: normalizePriceScore(profile.effectivePrice, maxPrice, minPrice),
    returnSafety: 1 - profile.trustSignals.returnRisk,
    repeatWear: profile.usageSignals.repeatWearPotential,
    versatility: profile.usageSignals.versatility,
    trust: profile.trustSignals.photoToRealityConfidence,
    description: profile.trustSignals.descriptionClarity,
  };
  return weightedSum(values, decisionScoringConfig.valueWeights);
}

export function scoreQuality(profile: ProductDecisionProfile): number {
  const values = {
    texture: profile.imageSignals.textureRichness,
    structure: profile.imageSignals.structureLevel,
    imageQuality: profile.trustSignals.imageQuality,
    description: profile.trustSignals.descriptionClarity,
    materialCue: materialCue(profile),
    photoReality: profile.trustSignals.photoToRealityConfidence,
  };
  return weightedSum(values, decisionScoringConfig.qualityWeights);
}

export function scoreStyle(
  profile: ProductDecisionProfile,
  request: CompareDecisionRequest
): number {
  const goalFit = goalStyleFit(profile, request.compareGoal, request.identityContext?.aspirationalSelf || []);
  const styleConsistency = clamp01(
    1 - Math.abs(profile.styleSignals.expressive - profile.derivedSignals.statementLevel)
  );
  const imageWeight = clamp01(
    profile.imageSignals.visualBoldness * 0.5 +
      profile.imageSignals.silhouetteSharpness * 0.25 +
      profile.imageSignals.colorEnergy * 0.25
  );

  return weightedSum(
    { image: imageWeight, styleConsistency, goalFit },
    decisionScoringConfig.styleWeights
  );
}

export function scoreRisk(profile: ProductDecisionProfile): number {
  const values = {
    returnRisk: 1 - profile.trustSignals.returnRisk,
    realismGap: profile.imageSignals.realismConfidence,
    photoRealityGap: profile.trustSignals.photoToRealityConfidence,
    stylingFriction: profile.usageSignals.stylingEase,
    occasionNarrowness: profile.usageSignals.occasionRange,
  };
  return weightedSum(values, decisionScoringConfig.riskWeights);
}

export function scoreOccasion(
  profile: ProductDecisionProfile,
  requestedOccasion?: CompareOccasion
): number {
  if (!requestedOccasion) return 0.5;

  const occasionLookup: Record<CompareOccasion, { polished: number; relaxed: number; expressive: number }> = {
    casual: { polished: 0.2, relaxed: 0.8, expressive: 0.4 },
    work: { polished: 0.9, relaxed: 0.3, expressive: 0.35 },
    formal: { polished: 0.88, relaxed: 0.2, expressive: 0.55 },
    party: { polished: 0.5, relaxed: 0.35, expressive: 0.9 },
    travel: { polished: 0.35, relaxed: 0.8, expressive: 0.3 },
  };

  const target = occasionLookup[requestedOccasion];

  const styleFit = clamp01(
    1 -
      (Math.abs(profile.styleSignals.polished - target.polished) +
        Math.abs(profile.styleSignals.relaxed - target.relaxed) +
        Math.abs(profile.styleSignals.expressive - target.expressive)) /
        3
  );

  const categoryAppropriateness = clamp01(
    (profile.usageSignals.occasionRange + profile.usageSignals.stylingEase) / 2
  );
  const visualAppropriateness = clamp01(
    (profile.imageSignals.outfitFlexibilityVisual + styleFit) / 2
  );

  const socialFit =
    requestedOccasion === "party"
      ? clamp01(profile.derivedSignals.socialVisibility * 0.55 + profile.derivedSignals.statementLevel * 0.45)
      : clamp01((profile.derivedSignals.socialVisibility + profile.derivedSignals.statementLevel) / 2);

  const values = {
    tagRelevance: styleFit,
    styleFit,
    ease: profile.usageSignals.stylingEase,
    categoryAppropriateness,
    visualAppropriateness,
    socialFit,
  };

  const base = weightedSum(values, {
    ...decisionScoringConfig.occasionWeights,
    socialFit: 0.14,
    tagRelevance: decisionScoringConfig.occasionWeights.tagRelevance - 0.06,
    styleFit: decisionScoringConfig.occasionWeights.styleFit - 0.04,
    categoryAppropriateness: decisionScoringConfig.occasionWeights.categoryAppropriateness - 0.04,
  });

  if (requestedOccasion !== "party") return base;

  // For party use-cases, stronger visual/social presence matters more than generic flexibility.
  return clamp01(
    base * 0.82 +
      profile.styleSignals.expressive * 0.08 +
      profile.imageSignals.visualBoldness * 0.05 +
      profile.derivedSignals.socialVisibility * 0.05
  );
}

export function scorePractical(profile: ProductDecisionProfile): number {
  return clamp01(
    profile.usageSignals.versatility * 0.35 +
      profile.usageSignals.stylingEase * 0.25 +
      profile.usageSignals.maintenanceEase * 0.15 +
      profile.trustSignals.photoToRealityConfidence * 0.25
  );
}

export function scoreExpressive(profile: ProductDecisionProfile): number {
  return clamp01(
    profile.styleSignals.expressive * 0.35 +
      profile.imageSignals.visualBoldness * 0.3 +
      profile.derivedSignals.statementLevel * 0.2 +
      profile.derivedSignals.socialVisibility * 0.15
  );
}

export function goalStyleFit(
  profile: ProductDecisionProfile,
  compareGoal?: CompareDecisionRequest["compareGoal"],
  aspirationalLabels: string[] = []
): number {
  const base = profile.styleSignals;
  const aspirationBias = aspirationalLabels.length > 0 ? 0.08 : 0;
  switch (compareGoal) {
    case "premium_quality":
      return clamp01(base.polished * 0.55 + base.classic * 0.35 + aspirationBias);
    case "style_match":
      return clamp01(base.expressive * 0.45 + base.minimal * 0.2 + base.polished * 0.35 + aspirationBias);
    case "occasion_fit":
      return clamp01(base.polished * 0.4 + base.relaxed * 0.3 + base.expressive * 0.3);
    case "low_risk_return":
      return clamp01(base.classic * 0.5 + base.minimal * 0.3 + (1 - base.trendy) * 0.2);
    case "best_value":
    default:
      return clamp01(base.classic * 0.4 + base.relaxed * 0.3 + base.polished * 0.3);
  }
}
