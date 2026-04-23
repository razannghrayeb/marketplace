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

function resolveOverallWeights(request: CompareDecisionRequest): {
  value: number;
  quality: number;
  style: number;
  risk: number;
  occasion: number;
  practical: number;
  expressive: number;
} {
  const hasOccasion = Boolean(request.occasion);
  const base = hasOccasion
    ? { value: 0.18, quality: 0.19, style: 0.17, risk: 0.14, occasion: 0.15, practical: 0.09, expressive: 0.08 }
    : { value: 0.2, quality: 0.2, style: 0.18, risk: 0.16, occasion: 0.1, practical: 0.08, expressive: 0.08 };

  switch (request.compareGoal) {
    case "best_value":
      return { ...base, value: base.value + 0.08, quality: base.quality - 0.03, style: base.style - 0.02, risk: base.risk - 0.02, practical: base.practical - 0.01 };
    case "premium_quality":
      return { ...base, quality: base.quality + 0.08, value: base.value - 0.03, style: base.style + 0.01, risk: base.risk - 0.03, practical: base.practical - 0.01, expressive: base.expressive - 0.02 };
    case "style_match":
      return { ...base, style: base.style + 0.08, expressive: base.expressive + 0.04, value: base.value - 0.04, quality: base.quality - 0.03, risk: base.risk - 0.03, practical: base.practical - 0.02 };
    case "low_risk_return":
      return { ...base, risk: base.risk + 0.08, quality: base.quality + 0.03, value: base.value - 0.03, style: base.style - 0.03, expressive: base.expressive - 0.03, practical: base.practical - 0.02 };
    case "occasion_fit":
      return { ...base, occasion: base.occasion + 0.08, style: base.style + 0.03, expressive: base.expressive + 0.02, value: base.value - 0.03, quality: base.quality - 0.03, risk: base.risk - 0.03, practical: base.practical - 0.04 };
    default:
      return base;
  }
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

function metricDeltaLabel(delta: number, metric: string): string {
  const points = Math.abs(Math.round(delta * 100));
  if (points >= 12) return `a clear ${points}-point lead in ${metric}`;
  if (points >= 6) return `a ${points}-point lead in ${metric}`;
  if (points >= 3) return `a slight ${points}-point lead in ${metric}`;
  return `almost tied in ${metric}`;
}

function buildRelativeDecisionNudge(
  current: {
    profile: ProductDecisionProfile;
    scores: { practical: number; expressive: number; quality: number; value: number; overall: number };
  },
  peers: Array<{
    profile: ProductDecisionProfile;
    scores: { practical: number; expressive: number; quality: number; value: number; overall: number };
  }>
): string {
  if (peers.length === 0) {
    return "Strong all-around pick if you want balance without major tradeoffs.";
  }
  const topPeer = peers.sort((a, b) => b.scores.overall - a.scores.overall)[0];
  const practicalDelta = current.scores.practical - topPeer.scores.practical;
  const expressiveDelta = current.scores.expressive - topPeer.scores.expressive;
  const qualityDelta = current.scores.quality - topPeer.scores.quality;
  const valueDelta = current.scores.value - topPeer.scores.value;

  const advantages: Array<{ metric: string; delta: number }> = [
    { metric: "daily practicality", delta: practicalDelta },
    { metric: "expressive style", delta: expressiveDelta },
    { metric: "quality confidence", delta: qualityDelta },
    { metric: "value for price", delta: valueDelta },
  ].sort((a, b) => b.delta - a.delta);

  const best = advantages[0];
  const weakest = advantages[advantages.length - 1];

  if (best.delta <= 0.02) {
    return `Compared with ${topPeer.profile.title}, the difference is small, so this is mostly a personal style call.`;
  }

  const tradeoff =
    weakest.delta < -0.03
      ? `Main tradeoff: it trails with ${metricDeltaLabel(weakest.delta, weakest.metric)}.`
      : "Tradeoff is small versus the closest alternative.";

  return `Compared with ${topPeer.profile.title}, this has ${metricDeltaLabel(best.delta, best.metric)}. ${tradeoff}`;
}

function metricDisplayLabel(metric: keyof ProductDecisionProfile["derivedSignals"] | "value" | "quality" | "style" | "risk" | "occasion" | "practical" | "expressive"): string {
  switch (metric) {
    case "value":
      return "better value for the price";
    case "quality":
      return "stronger quality confidence";
    case "style":
      return "closer style fit";
    case "risk":
      return "lower return-risk profile";
    case "occasion":
      return "better occasion fit";
    case "practical":
      return "easier day-to-day wear";
    case "expressive":
      return "stronger statement energy";
    default:
      return metric;
  }
}

function buildDecisionRationale(
  current: {
    profile: ProductDecisionProfile;
    scores: {
      value: number;
      quality: number;
      style: number;
      risk: number;
      occasion: number;
      practical: number;
      expressive: number;
      overall: number;
    };
  },
  peers: Array<{
    profile: ProductDecisionProfile;
    scores: {
      value: number;
      quality: number;
      style: number;
      risk: number;
      occasion: number;
      practical: number;
      expressive: number;
      overall: number;
    };
  }>
): { whyThisWon: string[]; tradeoffsToKnow: string[] } {
  if (peers.length === 0) {
    return {
      whyThisWon: ["Solid all-around profile with balanced scoring signals."],
      tradeoffsToKnow: ["No direct comparison tradeoffs available."],
    };
  }

  const nearestPeer = [...peers].sort(
    (a, b) =>
      Math.abs(current.scores.overall - a.scores.overall) - Math.abs(current.scores.overall - b.scores.overall)
  )[0];

  const dimensions: Array<{
    metric: "value" | "quality" | "style" | "risk" | "occasion" | "practical" | "expressive";
    delta: number;
  }> = [
    { metric: "value", delta: current.scores.value - nearestPeer.scores.value },
    { metric: "quality", delta: current.scores.quality - nearestPeer.scores.quality },
    { metric: "style", delta: current.scores.style - nearestPeer.scores.style },
    { metric: "risk", delta: current.scores.risk - nearestPeer.scores.risk },
    { metric: "occasion", delta: current.scores.occasion - nearestPeer.scores.occasion },
    { metric: "practical", delta: current.scores.practical - nearestPeer.scores.practical },
    { metric: "expressive", delta: current.scores.expressive - nearestPeer.scores.expressive },
  ];

  const strengths = [...dimensions].sort((a, b) => b.delta - a.delta).slice(0, 3);
  const tradeoffs = [...dimensions].sort((a, b) => a.delta - b.delta).slice(0, 2);

  const whyThisWon = strengths.map((s) =>
    s.delta > 0.02
      ? `Leads ${nearestPeer.profile.title} with ${metricDeltaLabel(s.delta, metricDisplayLabel(s.metric))}.`
      : `Stays competitive on ${metricDisplayLabel(s.metric)} with only a small gap versus ${nearestPeer.profile.title}.`
  );

  const tradeoffsToKnow = tradeoffs.map((t) =>
    t.delta < -0.02
      ? `Trails ${nearestPeer.profile.title} with ${metricDeltaLabel(t.delta, metricDisplayLabel(t.metric))}.`
      : `${metricDisplayLabel(t.metric)} is close to ${nearestPeer.profile.title}, so preference and styling context matter.`
  );

  return { whyThisWon, tradeoffsToKnow };
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
  const overallWeights = resolveOverallWeights(request);

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
      value * overallWeights.value +
        quality * overallWeights.quality +
        style * overallWeights.style +
        risk * overallWeights.risk +
        occasion * overallWeights.occasion +
        practical * overallWeights.practical +
        expressive * overallWeights.expressive
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
    allOverallScores: productResults.map((r) => r.scores.overall),
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
          "Attraction blends first-glance impact: boldness, silhouette clarity, color energy, and overall emotional pull.",
          request.userSignals?.firstAttractionProductId
            ? "Your first-attraction pick was included as a small tie-breaker boost."
            : "No first-attraction input was provided, so this score is based only on product signals.",
        ],
      },
      visualDifferences: buildVisualDifferences(profiles),
      consequences: productResults.map((r) => ({
        productId: r.profile.id,
        ifYouChooseThis: [
          ...r.consequence,
          buildRelativeDecisionNudge(
            {
              profile: r.profile,
              scores: {
                practical: r.scores.practical,
                expressive: r.scores.expressive,
                quality: r.scores.quality,
                value: r.scores.value,
                overall: r.scores.overall,
              },
            },
            productResults
              .filter((candidate) => candidate.profile.id !== r.profile.id)
              .map((candidate) => ({
                profile: candidate.profile,
                scores: {
                  practical: candidate.scores.practical,
                  expressive: candidate.scores.expressive,
                  quality: candidate.scores.quality,
                  value: candidate.scores.value,
                  overall: candidate.scores.overall,
                },
              }))
          ),
        ],
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
      decisionRationale: buildDecisionRationale(
        {
          profile: r.profile,
          scores: {
            value: r.scores.value,
            quality: r.scores.quality,
            style: r.scores.style,
            risk: r.scores.risk,
            occasion: r.scores.occasion,
            practical: r.scores.practical,
            expressive: r.scores.expressive,
            overall: r.scores.overall,
          },
        },
        productResults
          .filter((candidate) => candidate.profile.id !== r.profile.id)
          .map((candidate) => ({
            profile: candidate.profile,
            scores: {
              value: candidate.scores.value,
              quality: candidate.scores.quality,
              style: candidate.scores.style,
              risk: candidate.scores.risk,
              occasion: candidate.scores.occasion,
              practical: candidate.scores.practical,
              expressive: candidate.scores.expressive,
              overall: candidate.scores.overall,
            },
          }))
      ),
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
            overall_value: overallWeights.value,
            overall_quality: overallWeights.quality,
            overall_style: overallWeights.style,
            overall_risk: overallWeights.risk,
            overall_occasion: overallWeights.occasion,
            overall_practical: overallWeights.practical,
            overall_expressive: overallWeights.expressive,
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

  response.decisionConfidence.explanation = [
    ...response.decisionConfidence.explanation,
    response.decisionConfidence.level === "toss_up"
      ? "Recommendation: pick your top priority (value, quality, or style expression) to break this close tie."
      : response.decisionConfidence.level === "leaning_choice"
        ? "Recommendation: the leading option is stronger, but double-check fit details and return comfort before checkout."
        : "Recommendation: confidence is high enough to choose the leading option unless your personal style preference points elsewhere.",
  ];

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
