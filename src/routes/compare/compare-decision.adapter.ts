/**
 * TEMPORARY adapter: maps legacy `compareProductsWithVerdict` output into the
 * CompareDecisionResponse shape expected by the new storefront.
 *
 * Replace this with the dedicated decision engine once that service is wired
 * behind POST /api/compare/decision (same JSON contract).
 */

import type { CompareProductsResult } from "./compare.service";
import type { CompareDecisionRequestParsed } from "./compare-decision.schema";

export type CompareDecisionResponse = {
  comparisonMode: "direct_head_to_head" | "scenario_compare" | "outfit_compare";
  requestedGoal?: string;
  requestedOccasion?: string;
  comparisonContext: {
    productIds: number[];
    evaluatedAt: string;
    version: string;
    modeReason: string;
    dataQuality: { overallScore: number; notes: string[] };
  };
  stepInsights: {
    attraction?: {
      firstAttractionProductId?: number;
      attractionScores: Array<{ productId: number; score: number }>;
      explanation: string[];
    };
    visualDifferences: string[];
    consequences: Array<{ productId: number; ifYouChooseThis: string[] }>;
    regretFlash: Array<{ productId: number; shortTermFeeling: string; longTermReality: string }>;
    identityAlignment: Array<{
      productId: number;
      currentSelfScore: number;
      aspirationalSelfScore: number;
      explanation: string[];
    }>;
  };
  productInsights: Array<{
    productId: number;
    frictionIndex: number;
    frictionExplanation: string[];
    complimentPrediction: {
      score: number;
      type: "direct_compliments" | "subtle_admiration" | "polished_respect" | "stylish_attention" | "low_reaction_high_utility";
      explanation: string[];
    };
    wearFrequency: { estimatedMonthlyWear: number; confidence: number; explanation: string[] };
    photoRealityGap: {
      score: number;
      label: "photo_stronger" | "real_life_stronger" | "aligned";
      explanation: string[];
    };
    hiddenFlaw: string;
    microStory: string;
    decisionRationale: {
      whyThisWon: string[];
      tradeoffsToKnow: string[];
    };
    scores: {
      value: number;
      quality: number;
      style: number;
      risk: number;
      occasion: number;
      overall: number;
      practical: number;
      expressive: number;
      currentSelf: number;
      aspirationalSelf: number;
    };
  }>;
  tensionAxes: Array<{
    axis: "safe_bold" | "versatile_expressive" | "polished_effortless" | "practical_statement";
    leftLabel: string;
    rightLabel: string;
    positions: Array<{ productId: number; value: number }>;
  }>;
  decisionConfidence: {
    level: "clear_choice" | "leaning_choice" | "toss_up";
    score: number;
    explanation: string[];
  };
  winnersByContext: {
    practical?: number;
    expressive?: number;
    safest?: number;
    mostExciting?: number;
    currentSelf?: number;
    aspirationalSelf?: number;
    value?: number;
    quality?: number;
    style?: number;
    risk?: number;
    occasion?: number;
    overall?: number;
  };
  whyNotBoth?: {
    enabled: boolean;
    explanation: string[];
    productRoles: Array<{ productId: number; role: string }>;
  };
  outfitImpact?: {
    enabled: boolean;
    versatilityScores: Array<{ productId: number; score: number }>;
    wardrobeGapFillScores: Array<{ productId: number; score: number }>;
    explanation: string[];
  };
  socialMirror?: { enabled: boolean; explanation: Array<{ productId: number; message: string }> };
  peopleLikeYou?: { enabled: boolean; explanation: string[]; notes?: string[] };
};

function confidenceLevelFromLegacy(
  label: string,
  isTie: boolean
): { level: CompareDecisionResponse["decisionConfidence"]["level"]; score: number } {
  const L = label.toLowerCase();
  if (isTie || L.includes("tie") || L.includes("close")) {
    return { level: "toss_up", score: 42 };
  }
  if (L.includes("high") || L.includes("strong")) {
    return { level: "clear_choice", score: 82 };
  }
  if (L.includes("medium") || L.includes("moderate")) {
    return { level: "leaning_choice", score: 64 };
  }
  return { level: "leaning_choice", score: 55 };
}

export function legacyCompareToDecisionResponse(
  legacy: CompareProductsResult,
  req: CompareDecisionRequestParsed
): CompareDecisionResponse {
  const { verdict, product_summaries, comparison_details } = legacy;
  const productIds = [...req.productIds];
  const winnerId = comparison_details.winner_id ?? undefined;

  const avgScore =
    product_summaries.length > 0
      ? Math.round(product_summaries.reduce((s, p) => s + p.score, 0) / product_summaries.length)
      : 50;

  const firstAttraction = req.userSignals?.firstAttractionProductId;
  const attraction =
    firstAttraction != null
      ? {
          firstAttractionProductId: firstAttraction,
          attractionScores: product_summaries.map((s) => ({
            productId: s.product_id,
            score: s.product_id === firstAttraction ? Math.min(100, s.score + 5) : s.score,
          })),
          explanation: [
            "First-glance signal captured from your selection; engine may weight fit and styling tension accordingly.",
          ],
        }
      : undefined;

  const visualDifferences = verdict.bullet_points?.length
    ? [...verdict.bullet_points]
    : [`${verdict.title}: ${verdict.subtitle}`];

  const consequences = product_summaries.map((s) => ({
    productId: s.product_id,
    ifYouChooseThis: [
      ...s.highlights.map((h) => `Upside: ${h}`),
      ...s.concerns.map((c) => `Tradeoff: ${c}`),
    ],
  }));

  const regretFlash = product_summaries.map((s) => ({
    productId: s.product_id,
    shortTermFeeling:
      s.concerns[0] ?? (s.level_color === "green" ? "Likely feels like a safe checkout." : "Might feel uncertain at checkout."),
    longTermReality:
      s.highlights[0] ?? "Long-term wear depends on fit, fabric care, and how often you reach for this silhouette.",
  }));

  const identityAlignment = product_summaries.map((s) => {
    const base = s.score;
    const aspirationalBump = req.mode === "alter_ego" ? 8 : 0;
    return {
      productId: s.product_id,
      currentSelfScore: base,
      aspirationalSelfScore: Math.min(100, base + aspirationalBump + (s.product_id === winnerId ? 6 : -4)),
      explanation:
        req.identityContext?.currentSelf?.length || req.identityContext?.aspirationalSelf?.length
          ? [
              "Identity tags were provided; dedicated engine should refine these scores. Adapter maps baseline quality scores as a placeholder.",
            ]
          : ["Baseline alignment from quality signals; add identity tags in the UI for richer output when the engine supports it."],
    };
  });

  const productInsights = product_summaries.map((s) => {
    const overall = s.score;
    return {
      productId: s.product_id,
      frictionIndex: Math.max(0, Math.min(100, 100 - overall + (s.concerns.length > 0 ? 8 : 0))),
      frictionExplanation: s.concerns.length ? s.concerns : ["No major friction flags in legacy signals."],
      complimentPrediction: {
        score: Math.min(100, overall + 4),
        type: "stylish_attention" as const,
        explanation:
          s.highlights.slice(0, 2).length > 0
            ? s.highlights.slice(0, 2)
            : ["Compliment prediction placeholder until social signal model is connected."],
      },
      wearFrequency: {
        estimatedMonthlyWear: overall >= 70 ? 6 : overall >= 45 ? 4 : 2,
        confidence: 48,
        explanation: ["Estimated from overall quality score — replace with wear model output."],
      },
      photoRealityGap: {
        score: 72,
        label: "aligned" as const,
        explanation: ["Legacy compare does not yet separate photo vs in-person perception."],
      },
      hiddenFlaw: s.concerns[0] ?? "No single flaw surfaced in legacy summary.",
      microStory:
        s.highlights[0] ??
        `${s.level_label} pick — see highlights and concerns for nuance.`,
      decisionRationale: {
        whyThisWon:
          s.highlights.slice(0, 3).length > 0
            ? s.highlights.slice(0, 3)
            : ["Balanced signals with no major red flags in legacy scoring."],
        tradeoffsToKnow:
          s.concerns.slice(0, 2).length > 0
            ? s.concerns.slice(0, 2)
            : ["No strong tradeoff surfaced by legacy compare output."],
      },
      scores: {
        value: overall,
        quality: overall,
        style: Math.round(overall * 0.92),
        risk: Math.round(Math.max(0, 100 - overall)),
        occasion: overall,
        overall,
        practical: Math.round(overall * 0.95),
        expressive: Math.round(overall * 0.88),
        currentSelf: overall,
        aspirationalSelf: Math.min(100, overall + (req.mode === "alter_ego" ? 6 : 0)),
      },
    };
  });

  const safeBold = req.userSignals?.safeBoldPreference ?? 0.5;
  const pracExpr = req.userSignals?.practicalExpressivePreference ?? 0.5;
  const polishEff = req.userSignals?.polishedEffortlessPreference ?? 0.5;

  const tensionAxes: CompareDecisionResponse["tensionAxes"] = [
    {
      axis: "safe_bold",
      leftLabel: "Safer",
      rightLabel: "Bolder",
      positions: productIds.map((id) => ({
        productId: id,
        value: Math.max(0, Math.min(1, safeBold + (id === winnerId ? 0.06 : -0.02))),
      })),
    },
    {
      axis: "versatile_expressive",
      leftLabel: "Versatile",
      rightLabel: "Expressive",
      positions: productIds.map((id) => ({
        productId: id,
        value: Math.max(0, Math.min(1, pracExpr + (id === winnerId ? 0.04 : 0))),
      })),
    },
    {
      axis: "polished_effortless",
      leftLabel: "Polished",
      rightLabel: "Effortless",
      positions: productIds.map((id) => ({
        productId: id,
        value: Math.max(0, Math.min(1, polishEff + 0.02)),
      })),
    },
    {
      axis: "practical_statement",
      leftLabel: "Practical",
      rightLabel: "Statement",
      positions: productIds.map((id) => ({
        productId: id,
        value: Math.max(0, Math.min(1, 0.45 + (id === winnerId ? 0.12 : 0.05))),
      })),
    },
  ];

  const { level, score } = confidenceLevelFromLegacy(verdict.confidence_label, comparison_details.is_tie);

  const winnersByContext: CompareDecisionResponse["winnersByContext"] = {};
  if (winnerId != null) {
    winnersByContext.overall = winnerId;
    winnersByContext.value = winnerId;
    winnersByContext.quality = winnerId;
    winnersByContext.style = winnerId;
    winnersByContext.practical = winnerId;
    const runner = productIds.find((id) => id !== winnerId);
    if (runner != null) {
      winnersByContext.expressive = runner;
      winnersByContext.mostExciting = runner;
    }
  }

  const closeCall =
    comparison_details.is_tie ||
    (comparison_details.score_difference != null && comparison_details.score_difference < 12);

  const whyNotBoth =
    closeCall && productIds.length >= 2
      ? {
          enabled: true,
          explanation: [
            verdict.tradeoff ??
              "Scores are close — consider keeping the more versatile piece and the more expressive one if budget allows.",
          ],
          productRoles: productIds.map((id, i) => ({
            productId: id,
            role: i === 0 ? "Core everyday slot" : i === 1 ? "Accent / alternates" : "Occasion-specific",
          })),
        }
      : undefined;

  const outfitImpact =
    req.occasion != null
      ? {
          enabled: true,
          versatilityScores: product_summaries.map((s) => ({ productId: s.product_id, score: s.score })),
          wardrobeGapFillScores: product_summaries.map((s) => ({
            productId: s.product_id,
            score: Math.round(s.score * 0.9),
          })),
          explanation: [`Occasion “${req.occasion}” was requested — outfit engine should refine these scores.`],
        }
      : undefined;

  const comparisonMode: CompareDecisionResponse["comparisonMode"] =
    req.occasion != null ? "outfit_compare" : "direct_head_to_head";

  return {
    comparisonMode,
    requestedGoal: req.compareGoal,
    requestedOccasion: req.occasion,
    comparisonContext: {
      productIds,
      evaluatedAt: new Date().toISOString(),
      version: "legacy-adapter-v1",
      modeReason: verdict.subtitle,
      dataQuality: {
        overallScore: avgScore,
        notes: [
          "Response synthesized from legacy compare until the dedicated decision service is deployed.",
          ...(!avgScore || avgScore < 45 ? ["Some products have thinner signals — treat scores as directional."] : []),
        ],
      },
    },
    stepInsights: {
      ...(attraction ? { attraction } : {}),
      visualDifferences,
      consequences,
      regretFlash,
      identityAlignment,
    },
    productInsights,
    tensionAxes,
    decisionConfidence: {
      level,
      score,
      explanation: [
        verdict.confidence_description,
        verdict.recommendation,
      ].filter(Boolean) as string[],
    },
    winnersByContext,
    ...(whyNotBoth ? { whyNotBoth } : {}),
    ...(outfitImpact ? { outfitImpact } : {}),
  };
}
