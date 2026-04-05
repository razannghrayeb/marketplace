export const decisionScoringConfig = {
  version: "2026.04.05",
  valueWeights: {
    price: 0.3,
    returnSafety: 0.2,
    repeatWear: 0.2,
    versatility: 0.15,
    trust: 0.1,
    description: 0.05,
  },
  qualityWeights: {
    texture: 0.2,
    structure: 0.15,
    imageQuality: 0.15,
    description: 0.15,
    materialCue: 0.15,
    photoReality: 0.2,
  },
  styleWeights: {
    image: 0.35,
    styleConsistency: 0.35,
    goalFit: 0.3,
  },
  riskWeights: {
    returnRisk: 0.3,
    realismGap: 0.2,
    photoRealityGap: 0.2,
    stylingFriction: 0.15,
    occasionNarrowness: 0.15,
  },
  occasionWeights: {
    tagRelevance: 0.28,
    styleFit: 0.22,
    ease: 0.2,
    categoryAppropriateness: 0.15,
    visualAppropriateness: 0.15,
  },
  attractionWeights: {
    firstAttractionBoost: 0.2,
    visualBoldness: 0.18,
    silhouetteSharpness: 0.14,
    colorEnergy: 0.16,
    textureRichness: 0.12,
    emotionalPull: 0.2,
  },
  frictionWeights: {
    inverseStylingEase: 0.2,
    inverseVersatility: 0.18,
    inverseOccasionRange: 0.16,
    maintenanceBurden: 0.14,
    trendVolatility: 0.14,
    detailDensityPenalty: 0.1,
    statementPenalty: 0.08,
  },
  confidenceThresholds: {
    clearChoiceMargin: 0.12,
    leaningChoiceMargin: 0.06,
  },
  whyNotBoth: {
    maxTopMargin: 0.07,
    minComplementarity: 0.2,
  },
} as const;

export type DecisionScoringConfig = typeof decisionScoringConfig;
