import type { CompareDecisionResponse } from "../types";
import { to2 } from "../engine/scoreUtils";

export function serializeCompareDecisionResponse(
  response: CompareDecisionResponse
): CompareDecisionResponse {
  return {
    ...response,
    comparisonContext: {
      ...response.comparisonContext,
      dataQuality: {
        ...response.comparisonContext.dataQuality,
        overallScore: to2(response.comparisonContext.dataQuality.overallScore),
      },
    },
    productInsights: response.productInsights.map((insight) => ({
      ...insight,
      frictionIndex: to2(insight.frictionIndex),
      complimentPrediction: {
        ...insight.complimentPrediction,
        score: to2(insight.complimentPrediction.score),
      },
      wearFrequency: {
        ...insight.wearFrequency,
        confidence: to2(insight.wearFrequency.confidence),
      },
      photoRealityGap: {
        ...insight.photoRealityGap,
        score: to2(insight.photoRealityGap.score),
      },
      scores: {
        value: to2(insight.scores.value),
        quality: to2(insight.scores.quality),
        style: to2(insight.scores.style),
        risk: to2(insight.scores.risk),
        occasion: to2(insight.scores.occasion),
        overall: to2(insight.scores.overall),
        practical: to2(insight.scores.practical),
        expressive: to2(insight.scores.expressive),
        currentSelf: to2(insight.scores.currentSelf),
        aspirationalSelf: to2(insight.scores.aspirationalSelf),
      },
    })),
    decisionConfidence: {
      ...response.decisionConfidence,
      score: to2(response.decisionConfidence.score),
    },
    tensionAxes: response.tensionAxes.map((axis) => ({
      ...axis,
      positions: axis.positions.map((p) => ({ productId: p.productId, value: to2(p.value) })),
    })),
    stepInsights: {
      ...response.stepInsights,
      attraction: response.stepInsights.attraction
        ? {
            ...response.stepInsights.attraction,
            attractionScores: response.stepInsights.attraction.attractionScores.map((a) => ({
              productId: a.productId,
              score: to2(a.score),
            })),
          }
        : undefined,
    },
    outfitImpact: response.outfitImpact
      ? {
          ...response.outfitImpact,
          versatilityScores: response.outfitImpact.versatilityScores.map((v) => ({
            productId: v.productId,
            score: to2(v.score),
          })),
          wardrobeGapFillScores: response.outfitImpact.wardrobeGapFillScores.map((v) => ({
            productId: v.productId,
            score: to2(v.score),
          })),
        }
      : undefined,
  };
}
