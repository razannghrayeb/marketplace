import type { CompareDecisionRequest, ProductDecisionProfile } from "../types";
import { decisionScoringConfig } from "./scoringConfig";
import { weightedSum } from "./scoreUtils";

export function scoreAttraction(
  profile: ProductDecisionProfile,
  request: CompareDecisionRequest
): number {
  const firstAttractionBoost =
    request.userSignals?.firstAttractionProductId === profile.id ? 1 : 0;

  return weightedSum(
    {
      firstAttractionBoost,
      visualBoldness: profile.imageSignals.visualBoldness,
      silhouetteSharpness: profile.imageSignals.silhouetteSharpness,
      colorEnergy: profile.imageSignals.colorEnergy,
      textureRichness: profile.imageSignals.textureRichness,
      emotionalPull: profile.derivedSignals.emotionalPull,
    },
    decisionScoringConfig.attractionWeights
  );
}
