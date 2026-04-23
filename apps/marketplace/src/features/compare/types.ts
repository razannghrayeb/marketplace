export type CompareGoal =
  | 'best_value'
  | 'premium_quality'
  | 'style_match'
  | 'low_risk_return'
  | 'occasion_fit'

export type CompareOccasion = 'casual' | 'work' | 'formal' | 'party' | 'travel'

export type CompareBusinessMode = 'standard' | 'alter_ego'

export type ComparisonMode = 'direct_head_to_head' | 'scenario_compare' | 'outfit_compare'

export interface CompareDecisionRequest {
  productIds: number[]
  compareGoal?: CompareGoal
  occasion?: CompareOccasion
  mode?: CompareBusinessMode
  identityContext?: {
    currentSelf?: string[]
    aspirationalSelf?: string[]
  }
  userSignals?: {
    firstAttractionProductId?: number
    safeBoldPreference?: number
    practicalExpressivePreference?: number
    polishedEffortlessPreference?: number
  }
}

export interface CompareDecisionResponse {
  comparisonMode: ComparisonMode
  requestedGoal?: string
  requestedOccasion?: string

  comparisonContext: {
    productIds: number[]
    evaluatedAt: string
    version: string
    modeReason: string
    dataQuality: {
      overallScore: number
      notes: string[]
    }
  }

  stepInsights: {
    attraction?: {
      firstAttractionProductId?: number
      attractionScores: Array<{
        productId: number
        score: number
      }>
      explanation: string[]
    }
    visualDifferences: string[]
    consequences: Array<{
      productId: number
      ifYouChooseThis: string[]
    }>
    regretFlash: Array<{
      productId: number
      shortTermFeeling: string
      longTermReality: string
    }>
    identityAlignment: Array<{
      productId: number
      currentSelfScore: number
      aspirationalSelfScore: number
      explanation: string[]
    }>
  }

  productInsights: Array<{
    productId: number
    frictionIndex: number
    frictionExplanation: string[]
    complimentPrediction: {
      score: number
      type:
        | 'direct_compliments'
        | 'subtle_admiration'
        | 'polished_respect'
        | 'stylish_attention'
        | 'low_reaction_high_utility'
      explanation: string[]
    }
    wearFrequency: {
      estimatedMonthlyWear: number
      confidence: number
      explanation: string[]
    }
    photoRealityGap: {
      score: number
      label: 'photo_stronger' | 'real_life_stronger' | 'aligned'
      explanation: string[]
    }
    hiddenFlaw: string
    microStory: string
    decisionRationale: {
      whyThisWon: string[]
      tradeoffsToKnow: string[]
    }
    scores: {
      value: number
      quality: number
      style: number
      risk: number
      occasion: number
      overall: number
      practical: number
      expressive: number
      currentSelf: number
      aspirationalSelf: number
    }
  }>

  tensionAxes: Array<{
    axis: 'safe_bold' | 'versatile_expressive' | 'polished_effortless' | 'practical_statement'
    leftLabel: string
    rightLabel: string
    positions: Array<{
      productId: number
      value: number
    }>
  }>

  decisionConfidence: {
    level: 'clear_choice' | 'leaning_choice' | 'toss_up'
    score: number
    explanation: string[]
  }

  winnersByContext: {
    practical?: number
    expressive?: number
    safest?: number
    mostExciting?: number
    currentSelf?: number
    aspirationalSelf?: number
    value?: number
    quality?: number
    style?: number
    risk?: number
    occasion?: number
    overall?: number
  }

  whyNotBoth?: {
    enabled: boolean
    explanation: string[]
    productRoles: Array<{
      productId: number
      role: string
    }>
  }

  outfitImpact?: {
    enabled: boolean
    versatilityScores: Array<{ productId: number; score: number }>
    wardrobeGapFillScores: Array<{ productId: number; score: number }>
    explanation: string[]
  }

  socialMirror?: {
    enabled: boolean
    explanation: Array<{
      productId: number
      message: string
    }>
  }

  peopleLikeYou?: {
    enabled: boolean
    explanation: string[]
    notes?: string[]
  }
}
