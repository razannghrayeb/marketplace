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
  const styleTarget: Record<CompareOccasion, { polished: number; relaxed: number; expressive: number }> = {
    casual: { polished: 0.25, relaxed: 0.82, expressive: 0.35 },
    work: { polished: 0.82, relaxed: 0.3, expressive: 0.35 },
    formal: { polished: 0.9, relaxed: 0.2, expressive: 0.58 },
    party: { polished: 0.55, relaxed: 0.3, expressive: 0.9 },
    travel: { polished: 0.35, relaxed: 0.75, expressive: 0.3 },
  };
  const target = styleTarget[requestedOccasion];
  const styleFit = clamp01(
    1 -
      (Math.abs(profile.styleSignals.polished - target.polished) * 0.38 +
        Math.abs(profile.styleSignals.relaxed - target.relaxed) * 0.32 +
        Math.abs(profile.styleSignals.expressive - target.expressive) * 0.3)
  );

  const versatilityCore = clamp01(
    profile.usageSignals.stylingEase * 0.3 +
      profile.usageSignals.versatility * 0.3 +
      profile.usageSignals.occasionRange * 0.2 +
      profile.imageSignals.outfitFlexibilityVisual * 0.2
  );

  const workFit = clamp01(
    profile.styleSignals.polished * 0.34 +
      profile.styleSignals.classic * 0.2 +
      profile.usageSignals.stylingEase * 0.2 +
      profile.usageSignals.occasionRange * 0.14 +
      (1 - profile.derivedSignals.statementLevel) * 0.12
  );
  const formalFit = clamp01(
    profile.styleSignals.polished * 0.33 +
      profile.imageSignals.structureLevel * 0.2 +
      profile.imageSignals.textureRichness * 0.17 +
      profile.derivedSignals.socialVisibility * 0.15 +
      profile.styleSignals.expressive * 0.15
  );
  const partyFit = clamp01(
    profile.derivedSignals.socialVisibility * 0.28 +
      profile.derivedSignals.statementLevel * 0.24 +
      profile.styleSignals.expressive * 0.22 +
      profile.imageSignals.visualBoldness * 0.16 +
      profile.imageSignals.colorEnergy * 0.1
  );
  const casualFit = clamp01(
    profile.styleSignals.relaxed * 0.3 +
      profile.usageSignals.stylingEase * 0.24 +
      profile.usageSignals.versatility * 0.22 +
      profile.usageSignals.maintenanceEase * 0.14 +
      (1 - profile.derivedSignals.statementLevel) * 0.1
  );
  const travelFit = clamp01(
    profile.usageSignals.stylingEase * 0.28 +
      profile.usageSignals.maintenanceEase * 0.24 +
      profile.usageSignals.versatility * 0.22 +
      profile.usageSignals.occasionRange * 0.16 +
      (1 - profile.imageSignals.detailDensity) * 0.1
  );

  const fitByOccasion: Record<CompareOccasion, number> = {
    casual: casualFit,
    work: workFit,
    formal: formalFit,
    party: partyFit,
    travel: travelFit,
  };

  const mismatchPenaltyByOccasion: Record<CompareOccasion, number> = {
    casual: clamp01(
      profile.derivedSignals.statementLevel * 0.45 +
        profile.styleSignals.polished * 0.25 +
        profile.imageSignals.visualBoldness * 0.3
    ),
    work: clamp01(
      profile.derivedSignals.statementLevel * 0.45 +
        profile.styleSignals.expressive * 0.25 +
        profile.imageSignals.visualBoldness * 0.3
    ),
    formal: clamp01(
      profile.styleSignals.relaxed * 0.45 +
        (1 - profile.imageSignals.structureLevel) * 0.3 +
        profile.usageSignals.maintenanceEase * 0.25
    ),
    party: clamp01(
      (1 - profile.derivedSignals.socialVisibility) * 0.4 +
        (1 - profile.styleSignals.expressive) * 0.35 +
        (1 - profile.imageSignals.visualBoldness) * 0.25
    ),
    travel: clamp01(
      (1 - profile.usageSignals.stylingEase) * 0.35 +
        (1 - profile.usageSignals.maintenanceEase) * 0.35 +
        profile.imageSignals.detailDensity * 0.3
    ),
  };

  const fit = fitByOccasion[requestedOccasion];
  const mismatchPenalty = mismatchPenaltyByOccasion[requestedOccasion];
  return clamp01(styleFit * 0.25 + versatilityCore * 0.2 + fit * 0.7 - mismatchPenalty * 0.35);
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
