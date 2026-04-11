export type CompareGoal =
  | "best_value"
  | "premium_quality"
  | "style_match"
  | "low_risk_return"
  | "occasion_fit";

export type CompareOccasion = "casual" | "work" | "formal" | "party" | "travel";

export type CompareBusinessMode = "standard" | "alter_ego";

export type ComparisonMode = "direct_head_to_head" | "scenario_compare" | "outfit_compare";

export interface RawProduct {
  id: number;
  title: string;
  brand: string;
  category: string;
  subcategory?: string;
  gender?: string;
  ageGroup?: string;
  price: number;
  salePrice?: number;
  colors?: string[];
  material?: string[];
  fit?: string;
  styleTags?: string[];
  occasionTags?: string[];
  careTags?: string[];
  description?: string;
  imageUrls: string[];
  reviewSummary?: string;
  metadata?: Record<string, unknown>;
}

export interface ProductDecisionProfile {
  id: number;
  title: string;
  brand: string;
  category: string;
  subcategory?: string;
  price: number;
  salePrice?: number;
  effectivePrice: number;

  imageSignals: {
    silhouetteSharpness: number;
    visualBoldness: number;
    softness: number;
    textureRichness: number;
    structureLevel: number;
    detailDensity: number;
    colorEnergy: number;
    realismConfidence: number;
    outfitFlexibilityVisual: number;
  };

  styleSignals: {
    classic: number;
    trendy: number;
    polished: number;
    relaxed: number;
    edgy: number;
    feminine: number;
    minimal: number;
    expressive: number;
  };

  usageSignals: {
    versatility: number;
    stylingEase: number;
    occasionRange: number;
    maintenanceEase: number;
    seasonality: number;
    repeatWearPotential: number;
  };

  trustSignals: {
    photoToRealityConfidence: number;
    returnRisk: number;
    descriptionClarity: number;
    imageQuality: number;
  };

  derivedSignals: {
    trendVolatility: number;
    statementLevel: number;
    practicalStrength: number;
    emotionalPull: number;
    socialVisibility: number;
  };

  sourceMeta: {
    usedHeuristics: string[];
    hasVisionSignals: boolean;
  };
}

export interface CompareDecisionRequest {
  productIds: number[];
  compareGoal?: CompareGoal;
  occasion?: CompareOccasion;
  comparisonMode?: ComparisonMode;
  mode?: CompareBusinessMode;
  identityContext?: {
    currentSelf?: string[];
    aspirationalSelf?: string[];
  };
  userSignals?: {
    firstAttractionProductId?: number;
    safeBoldPreference?: number;
    practicalExpressivePreference?: number;
    polishedEffortlessPreference?: number;
  };
  debug?: boolean;
}

export interface CompareDecisionResponse {
  comparisonMode: ComparisonMode;
  requestedGoal?: string;
  requestedOccasion?: string;

  comparisonContext: {
    productIds: number[];
    evaluatedAt: string;
    version: string;
    modeReason: string;
    dataQuality: {
      overallScore: number;
      notes: string[];
    };
  };

  stepInsights: {
    attraction?: {
      firstAttractionProductId?: number;
      attractionScores: Array<{
        productId: number;
        score: number;
      }>;
      explanation: string[];
    };

    visualDifferences: string[];

    consequences: Array<{
      productId: number;
      ifYouChooseThis: string[];
    }>;

    regretFlash: Array<{
      productId: number;
      shortTermFeeling: string;
      longTermReality: string;
    }>;

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
      type:
        | "direct_compliments"
        | "subtle_admiration"
        | "polished_respect"
        | "stylish_attention"
        | "low_reaction_high_utility";
      explanation: string[];
    };

    wearFrequency: {
      estimatedMonthlyWear: number;
      confidence: number;
      explanation: string[];
    };

    photoRealityGap: {
      score: number;
      label: "photo_stronger" | "real_life_stronger" | "aligned";
      explanation: string[];
    };

    hiddenFlaw: string;
    microStory: string;

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
    positions: Array<{
      productId: number;
      value: number;
    }>;
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
    productRoles: Array<{
      productId: number;
      role: string;
    }>;
  };

  outfitImpact?: {
    enabled: boolean;
    versatilityScores: Array<{ productId: number; score: number }>;
    wardrobeGapFillScores: Array<{ productId: number; score: number }>;
    explanation: string[];
  };

  socialMirror?: {
    enabled: boolean;
    explanation: Array<{
      productId: number;
      message: string;
    }>;
  };

  peopleLikeYou?: {
    enabled: boolean;
    explanation: string[];
    notes?: string[];
  };

  debug?: {
    enabled: boolean;
    weightsUsed: Record<string, number>;
    scoreBreakdownByProduct: Array<{
      productId: number;
      metrics: Record<string, number>;
    }>;
  };
}

export interface CompareDecisionError {
  code:
    | "INVALID_REQUEST"
    | "PRODUCTS_NOT_FOUND"
    | "INSUFFICIENT_PRODUCT_DATA"
    | "UNSUPPORTED_COMPARE_GOAL"
    | "UNSUPPORTED_OCCASION"
    | "INTERNAL_ERROR";
  message: string;
  details?: Record<string, unknown>;
}

export interface DecisionEventPublisher {
  publish(event: {
    name:
      | "compare_request_received"
      | "compare_mode_resolved"
      | "fallback_heuristics_used"
      | "why_not_both_triggered"
      | "low_data_quality_detected"
      | "response_generated";
    payload: Record<string, unknown>;
  }): void;
}

export interface CompareDecisionServiceResult {
  ok: true;
  response: CompareDecisionResponse;
}

export interface CompareDecisionServiceFailure {
  ok: false;
  error: CompareDecisionError;
}

export type CompareDecisionServiceResponse =
  | CompareDecisionServiceResult
  | CompareDecisionServiceFailure;
