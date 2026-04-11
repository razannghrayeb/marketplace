import type {
  CompareDecisionRequest,
  CompareDecisionResponse,
  DecisionEventPublisher,
  ProductDecisionProfile,
  RawProduct,
} from "../types";
import { serializeCompareDecisionResponse } from "../api/serializers";
import { scoreAttraction } from "./attraction";
import { predictCompliment } from "./compliment";
import { scoreDecisionConfidence } from "./confidence";
import { buildConsequences } from "./consequence";
import { scoreFrictionIndex } from "./friction";
import { buildHiddenFlaw } from "./hiddenFlaw";
import { scoreIdentityAlignment } from "./identity";
import { resolveComparisonMode, inferMajorCategory } from "./modeResolver";
import { buildMicroStory } from "./microStory";
import { normalizeProducts } from "./normalization";
import { scoreOutfitImpact } from "./outfitImpact";
import { analyzePhotoRealityGap } from "./photoReality";
import { buildRegretFlash, scoreRegretProbability } from "./regret";
import {
  scoreExpressive,
  scoreOccasion,
  scorePractical,
  scoreQuality,
  scoreRisk,
  scoreStyle,
  scoreValue,
} from "./scoring";
import { avg, clamp01 } from "./scoreUtils";
import { buildVisualDifferences } from "./visualDiff";
import { detectWhyNotBoth } from "./whyNotBoth";
import { estimateWearFrequency } from "./wearFrequency";

interface EngineOptions {
  publisher?: DecisionEventPublisher;
  version?: string;
}

function pickWinner(
  scored: Array<{ productId: number; score: number }>
): number | undefined {
  const sorted = [...scored].sort((a, b) => b.score - a.score);
  return sorted[0]?.productId;
}

function toTensionAxes(
  products: Array<{
    productId: number;
    safeBold: number;
    versatileExpressive: number;
    polishedEffortless: number;
    practicalStatement: number;
  }>
): CompareDecisionResponse["tensionAxes"] {
  return [
    {
      axis: "safe_bold",
      leftLabel: "safe",
      rightLabel: "bold",
      positions: products.map((p) => ({ productId: p.productId, value: p.safeBold })),
    },
    {
      axis: "versatile_expressive",
      leftLabel: "versatile",
      rightLabel: "expressive",
      positions: products.map((p) => ({ productId: p.productId, value: p.versatileExpressive })),
    },
    {
      axis: "polished_effortless",
      leftLabel: "polished",
      rightLabel: "effortless",
      positions: products.map((p) => ({ productId: p.productId, value: p.polishedEffortless })),
    },
    {
      axis: "practical_statement",
      leftLabel: "practical",
      rightLabel: "statement",
      positions: products.map((p) => ({ productId: p.productId, value: p.practicalStatement })),
    },
  ];
}

function scoreDataQuality(profiles: ProductDecisionProfile[]): { overallScore: number; notes: string[] } {
  const notes: string[] = [];
  const qualityScores = profiles.map((p) => {
    const perProduct =
      p.trustSignals.descriptionClarity * 0.4 +
      p.trustSignals.imageQuality * 0.35 +
      p.trustSignals.photoToRealityConfidence * 0.25;
    if (!p.sourceMeta.hasVisionSignals) {
      notes.push(`Product ${p.id} uses heuristic visual proxies (vision signals unavailable).`);
    }
    if (p.trustSignals.descriptionClarity < 0.3) {
      notes.push(`Product ${p.id} has sparse text metadata, reducing certainty.`);
    }
    return perProduct;
  });

  return {
    overallScore: clamp01(avg(qualityScores)),
    notes: Array.from(new Set(notes)).slice(0, 6),
  };
}

export function runCompareDecisionEngine(
  rawProducts: RawProduct[],
  request: CompareDecisionRequest,
  options: EngineOptions = {}
): CompareDecisionResponse {
  options.publisher?.publish({
    name: "compare_request_received",
    payload: { productIds: request.productIds, goal: request.compareGoal, occasion: request.occasion },
  });

  const profiles = normalizeProducts(rawProducts);
  const resolvedMode = resolveComparisonMode(profiles);
  const comparisonMode = request.comparisonMode ?? resolvedMode.comparisonMode;
  const reason = request.comparisonMode
    ? request.comparisonMode === resolvedMode.comparisonMode
      ? `Requested mode '${request.comparisonMode}' matches auto-resolved mode. ${resolvedMode.reason}`
      : `Requested mode '${request.comparisonMode}' was applied. Auto-resolved mode would have been '${resolvedMode.comparisonMode}'. ${resolvedMode.reason}`
    : resolvedMode.reason;
  options.publisher?.publish({
    name: "compare_mode_resolved",
    payload: {
      mode: comparisonMode,
      reason,
      requestedMode: request.comparisonMode,
      autoResolvedMode: resolvedMode.comparisonMode,
    },
  });

  if (profiles.some((p) => !p.sourceMeta.hasVisionSignals)) {
    options.publisher?.publish({
      name: "fallback_heuristics_used",
      payload: { productIds: profiles.filter((p) => !p.sourceMeta.hasVisionSignals).map((p) => p.id) },
    });
  }

  const minPrice = Math.min(...profiles.map((p) => p.effectivePrice));
  const maxPrice = Math.max(...profiles.map((p) => p.effectivePrice));

  const productResults = profiles.map((profile) => {
    const value = scoreValue(profile, minPrice, maxPrice);
    const quality = scoreQuality(profile);
    const style = scoreStyle(profile, request);
    const risk = scoreRisk(profile);
    const occasion = scoreOccasion(profile, request.occasion);

    const attraction = scoreAttraction(profile, request);
    const identity = scoreIdentityAlignment(
      profile,
      request.identityContext?.currentSelf,
      request.identityContext?.aspirationalSelf
    );

    const practical = scorePractical(profile);
    const expressive = scoreExpressive(profile);
    const overall = clamp01(
      value * 0.2 +
        quality * 0.2 +
        style * 0.18 +
        risk * 0.16 +
        occasion * 0.1 +
        practical * 0.08 +
        expressive * 0.08
    );

    const friction = scoreFrictionIndex(profile);
    const regretProbability = scoreRegretProbability(profile, attraction, friction.index);
    const regret = buildRegretFlash(profile, regretProbability);
    const consequence = buildConsequences(profile, { practical, expressive, overall });
    const compliment = predictCompliment(profile, occasion);
    const wearFrequency = estimateWearFrequency(profile, inferMajorCategory(profile));
    const photoRealityGap = analyzePhotoRealityGap(profile);
    const hiddenFlaw = buildHiddenFlaw(profile, friction.index);
    const microStory = buildMicroStory(profile, practical, expressive);

    return {
      profile,
      scores: {
        value,
        quality,
        style,
        risk,
        occasion,
        overall,
        practical,
        expressive,
        currentSelf: identity.currentSelfScore,
        aspirationalSelf: identity.aspirationalSelfScore,
      },
      identity,
      friction,
      regret: {
        probability: regretProbability,
        ...regret,
      },
      consequence,
      compliment,
      wearFrequency,
      photoRealityGap,
      hiddenFlaw,
      microStory,
      attractionScore: attraction,
    };
  });

  const sortedByOverall = [...productResults]
    .sort((a, b) => b.scores.overall - a.scores.overall)
    .map((r) => ({
      productId: r.profile.id,
      overall: r.scores.overall,
      practical: r.scores.practical,
      expressive: r.scores.expressive,
    }));

  const winnersByContext: CompareDecisionResponse["winnersByContext"] = {
    practical: pickWinner(productResults.map((r) => ({ productId: r.profile.id, score: r.scores.practical }))),
    expressive: pickWinner(productResults.map((r) => ({ productId: r.profile.id, score: r.scores.expressive }))),
    safest: pickWinner(productResults.map((r) => ({ productId: r.profile.id, score: r.scores.risk }))),
    mostExciting: pickWinner(productResults.map((r) => ({ productId: r.profile.id, score: r.attractionScore }))),
    currentSelf: pickWinner(productResults.map((r) => ({ productId: r.profile.id, score: r.scores.currentSelf }))),
    aspirationalSelf: pickWinner(productResults.map((r) => ({ productId: r.profile.id, score: r.scores.aspirationalSelf }))),
    value: pickWinner(productResults.map((r) => ({ productId: r.profile.id, score: r.scores.value }))),
    quality: pickWinner(productResults.map((r) => ({ productId: r.profile.id, score: r.scores.quality }))),
    style: pickWinner(productResults.map((r) => ({ productId: r.profile.id, score: r.scores.style }))),
    risk: pickWinner(productResults.map((r) => ({ productId: r.profile.id, score: r.scores.risk }))),
    occasion: pickWinner(productResults.map((r) => ({ productId: r.profile.id, score: r.scores.occasion }))),
    overall: pickWinner(productResults.map((r) => ({ productId: r.profile.id, score: r.scores.overall }))),
  };

  const dataQuality = scoreDataQuality(profiles);
  if (dataQuality.overallScore < 0.55) {
    options.publisher?.publish({
      name: "low_data_quality_detected",
      payload: { score: dataQuality.overallScore, notes: dataQuality.notes },
    });
  }

  const confidence = scoreDecisionConfidence({
    sortedOverallScores: sortedByOverall.map((s) => s.overall),
    dataQuality: dataQuality.overallScore,
    winnersByContext,
  });

  const whyNotBoth = detectWhyNotBoth({
    mode: comparisonMode,
    sortedByOverall,
    profilesById: new Map(profiles.map((p) => [p.id, p])),
  });

  if (whyNotBoth?.enabled) {
    options.publisher?.publish({
      name: "why_not_both_triggered",
      payload: { productRoles: whyNotBoth.productRoles, mode: comparisonMode },
    });
  }

  const attractionScores = productResults
    .map((r) => ({ productId: r.profile.id, score: r.attractionScore }))
    .sort((a, b) => b.score - a.score);

  const response: CompareDecisionResponse = {
    comparisonMode,
    requestedGoal: request.compareGoal,
    requestedOccasion: request.occasion,
    comparisonContext: {
      productIds: request.productIds,
      evaluatedAt: new Date().toISOString(),
      version: options.version || "2026.04.05",
      modeReason: reason,
      dataQuality,
    },
    stepInsights: {
      attraction: {
        firstAttractionProductId: request.userSignals?.firstAttractionProductId,
        attractionScores,
        explanation: [
          "Attraction combines visual boldness, silhouette clarity, color energy, and emotional pull.",
          request.userSignals?.firstAttractionProductId
            ? "First-attraction signal was included as a bounded deterministic boost."
            : "No first-attraction input provided, so attraction is purely product-derived.",
        ],
      },
      visualDifferences: buildVisualDifferences(profiles),
      consequences: productResults.map((r) => ({
        productId: r.profile.id,
        ifYouChooseThis: r.consequence,
      })),
      regretFlash: productResults.map((r) => ({
        productId: r.profile.id,
        shortTermFeeling: r.regret.shortTermFeeling,
        longTermReality: r.regret.longTermReality,
      })),
      identityAlignment: productResults.map((r) => ({
        productId: r.profile.id,
        currentSelfScore: r.identity.currentSelfScore,
        aspirationalSelfScore: r.identity.aspirationalSelfScore,
        explanation: r.identity.explanation,
      })),
    },
    productInsights: productResults.map((r) => ({
      productId: r.profile.id,
      frictionIndex: r.friction.index,
      frictionExplanation: r.friction.explanation,
      complimentPrediction: r.compliment,
      wearFrequency: r.wearFrequency,
      photoRealityGap: r.photoRealityGap,
      hiddenFlaw: r.hiddenFlaw,
      microStory: r.microStory,
      scores: r.scores,
    })),
    tensionAxes: toTensionAxes(
      productResults.map((r) => ({
        productId: r.profile.id,
        safeBold: 1 - r.profile.imageSignals.visualBoldness,
        versatileExpressive: r.profile.styleSignals.expressive,
        polishedEffortless: 1 - r.profile.styleSignals.polished,
        practicalStatement: r.profile.derivedSignals.statementLevel,
      }))
    ),
    decisionConfidence: confidence,
    winnersByContext,
    whyNotBoth,
    outfitImpact:
      comparisonMode === "outfit_compare" ? scoreOutfitImpact(profiles) : undefined,
    socialMirror: {
      enabled: false,
      explanation: productResults.map((r) => ({
        productId: r.profile.id,
        message: "Social mirror model is disabled; this is deterministic placeholder messaging.",
      })),
    },
    peopleLikeYou: {
      enabled: false,
      explanation: ["People-like-you personalization is reserved for future behavior model integration."],
      notes: ["Placeholder contract returned for forward compatibility."],
    },
    debug: request.debug
      ? {
          enabled: true,
          weightsUsed: {
            value_price: 0.3,
            quality_texture: 0.2,
            style_goal_fit: 0.3,
            risk_return_inverse: 0.3,
            overall_value: 0.2,
            overall_quality: 0.2,
          },
          scoreBreakdownByProduct: productResults.map((r) => ({
            productId: r.profile.id,
            metrics: {
              value: r.scores.value,
              quality: r.scores.quality,
              style: r.scores.style,
              risk: r.scores.risk,
              occasion: r.scores.occasion,
              practical: r.scores.practical,
              expressive: r.scores.expressive,
              attraction: r.attractionScore,
              friction: r.friction.index,
              regretProbability: r.regret.probability,
            },
          })),
        }
      : undefined,
  };

  options.publisher?.publish({
    name: "response_generated",
    payload: {
      mode: response.comparisonMode,
      winner: response.winnersByContext.overall,
      confidence: response.decisionConfidence.level,
    },
  });

  return serializeCompareDecisionResponse(response);
}
