/**
 * AI Verdict Generator
 * 
 * Generates human-readable verdicts from comparison results.
 * 
 * Design principles:
 * - Template-based (MVP) with optional LLM enhancement
 * - Never says "scam", "fake" - uses professional language
 * - Lebanese market aware
 * - Safe legal language
 */

import { CompareVerdict, CompareReason, ProductComparison } from "./compareEngine";

// ============================================================================
// Types
// ============================================================================

export interface VerdictOutput {
  // Main verdict
  title: string;
  subtitle: string;
  
  // Bullet points (max 3)
  bullet_points: string[];
  
  // Tradeoff section
  tradeoff: string | null;
  
  // Confidence indicator
  confidence_label: string;
  confidence_description: string;
  
  // Overall recommendation
  recommendation: string;
}

export interface ProductSummary {
  product_id: number;
  level_label: string;        // "Higher Confidence" / "Medium Confidence" / "Lower Confidence"
  level_color: "green" | "yellow" | "red";
  score: number;
  
  // Key points about this product
  highlights: string[];
  concerns: string[];
  
  // Tooltips for UI
  tooltips: Record<string, string>;
}

export interface FullVerdictResponse {
  verdict: VerdictOutput;
  product_summaries: ProductSummary[];
  comparison_details: {
    winner_id: number | null;
    is_tie: boolean;
    score_difference: number;
  };
  comparison_context: {
    mode: CompareVerdict["comparison_mode"];
    comparable: boolean;
    reason: string;
    category_groups: Record<number, string>;
  };
  shopping_insights: CompareVerdict["shopping_insights"];
}

// ============================================================================
// Reason Templates
// ============================================================================

const REASON_TEMPLATES: Record<CompareReason, { text: string; tooltip: string }> = {
  better_description_quality: {
    text: "More detailed product information",
    tooltip: "This product has more complete description including fabric, fit, and sizing details"
  },
  stable_pricing: {
    text: "Stable and consistent pricing",
    tooltip: "Price has remained stable over time, indicating reliable pricing"
  },
  original_images: {
    text: "Appears to use original product images",
    tooltip: "Product images appear unique and not widely reused across other listings"
  },
  clear_return_policy: {
    text: "Clear return/exchange policy",
    tooltip: "Return and exchange terms are clearly stated"
  },
  premium_fabric: {
    text: "Premium fabric mentioned",
    tooltip: "Product description includes premium materials like silk, cashmere, or genuine leather"
  },
  lower_price_risk: {
    text: "Lower pricing risk",
    tooltip: "No unusual price patterns or concerning discount behaviors detected"
  },
  detailed_sizing: {
    text: "Detailed size information",
    tooltip: "Includes specific measurements or comprehensive size guide"
  },
  care_instructions: {
    text: "Care instructions provided",
    tooltip: "Washing and care instructions are included"
  },
  price_volatility: {
    text: "Price has fluctuated",
    tooltip: "Price has changed significantly over recent weeks"
  },
  limited_details: {
    text: "Limited product details",
    tooltip: "Description lacks specific information about materials, sizing, or care"
  },
  suspicious_pricing: {
    text: "Unusual pricing pattern",
    tooltip: "Price is significantly below market average or shows unusual discount patterns"
  },
  no_return_policy: {
    text: "No return policy mentioned",
    tooltip: "Return/exchange terms are not specified"
  },
  generic_images: {
    text: "Common product images",
    tooltip: "Similar images found on multiple other listings"
  },
  red_flag_content: {
    text: "Marketing language needs verification",
    tooltip: "Description contains claims that warrant additional verification"
  },
};

// ============================================================================
// Verdict Templates
// ============================================================================

interface VerdictTemplate {
  title: string;
  subtitle: string;
  recommendation: string;
}

const VERDICT_TEMPLATES: Record<CompareVerdict["confidence"], VerdictTemplate> = {
  high: {
    title: "Product {winner_letter} is the safer choice",
    subtitle: "Based on description quality, pricing stability, and seller information",
    recommendation: "We recommend Product {winner_letter} based on overall quality signals."
  },
  medium: {
    title: "Product {winner_letter} appears slightly better",
    subtitle: "Some advantages, but consider your priorities",
    recommendation: "Product {winner_letter} has some advantages, but differences are moderate."
  },
  low: {
    title: "Product {winner_letter} has minor advantages",
    subtitle: "Differences are subtle - consider other factors",
    recommendation: "Products are similar in quality signals. Consider your specific needs."
  },
  tie: {
    title: "Both products are comparable",
    subtitle: "No clear winner based on available information",
    recommendation: "Choose based on your preferences - both show similar quality signals."
  },
};

const CONFIDENCE_LABELS: Record<CompareVerdict["confidence"], { label: string; description: string }> = {
  high: {
    label: "High Confidence",
    description: "Clear differences in quality signals"
  },
  medium: {
    label: "Medium Confidence", 
    description: "Moderate differences detected"
  },
  low: {
    label: "Low Confidence",
    description: "Minor differences only"
  },
  tie: {
    label: "Tie",
    description: "Products are essentially equivalent"
  },
};

// ============================================================================
// Product Summary Generation
// ============================================================================

/**
 * Get level label (safe language)
 */
function getLevelLabel(level: "green" | "yellow" | "red"): string {
  switch (level) {
    case "green": return "Higher Confidence";
    case "yellow": return "Medium Confidence";
    case "red": return "Lower Confidence (Limited Details)";
  }
}

/**
 * Generate highlights for a product
 */
function generateHighlights(comparison: ProductComparison): string[] {
  const highlights: string[] = [];
  const { signals } = comparison;
  
  // Text quality highlights
  if (signals.text_quality.signals.has_fabric) {
    const fabrics = signals.text_quality.attributes.fabrics;
    if (fabrics.length > 0) {
      const tier = signals.text_quality.attributes.fabric_quality_tier;
      if (tier === "premium") {
        highlights.push(`Premium fabric: ${fabrics.join(", ")}`);
      } else {
        highlights.push(`Fabric: ${fabrics.join(", ")}`);
      }
    }
  }
  
  if (signals.text_quality.signals.has_fit) {
    highlights.push(`Fit: ${signals.text_quality.attributes.fits.join(", ")}`);
  }
  
  if (signals.text_quality.signals.has_size_info && signals.text_quality.signals.has_measurements) {
    highlights.push("Detailed sizing with measurements");
  } else if (signals.text_quality.signals.has_size_info) {
    highlights.push("Size information provided");
  }
  
  if (signals.text_quality.signals.has_care_instructions) {
    highlights.push("Care instructions included");
  }
  
  // Price highlights
  if (signals.price_analysis.stability === "stable") {
    highlights.push("Price has been stable");
  }
  if (signals.price_analysis.market_position === "normal") {
    highlights.push("Fair market price");
  }
  
  // Image highlights
  if (signals.image_signals.is_original) {
    highlights.push("Original product images");
  }
  
  // Return policy highlights
  if (signals.return_policy_signals.allows_returns) {
    if (signals.return_policy_signals.return_window_days) {
      highlights.push(`${signals.return_policy_signals.return_window_days}-day return policy`);
    } else {
      highlights.push("Returns accepted");
    }
  }
  
  return highlights.slice(0, 5); // Max 5 highlights
}

/**
 * Generate concerns for a product (safe language)
 */
function generateConcerns(comparison: ProductComparison): string[] {
  const concerns: string[] = [];
  const { signals } = comparison;
  
  // Text quality concerns
  if (signals.text_quality.signals.is_too_short) {
    concerns.push("Limited product description");
  }
  
  if (!signals.text_quality.signals.has_fabric) {
    concerns.push("Fabric/material not specified");
  }
  
  if (signals.text_quality.redFlags.some(f => f.severity === "high")) {
    concerns.push("Some claims may need verification");
  }
  
  // Price concerns (safe language)
  if (signals.price_analysis.stability === "high_risk") {
    concerns.push("Price has fluctuated recently");
  }
  
  if (signals.price_analysis.market_position === "suspicious_low") {
    concerns.push("Price significantly below market average");
  }
  
  if (signals.price_analysis.discount_behavior === "suspicious") {
    concerns.push("Frequent discount changes");
  }
  
  // Image concerns
  if (!signals.image_signals.has_image) {
    concerns.push("No product image");
  } else if (signals.image_signals.similar_image_count > 5) {
    concerns.push("Common product image");
  }
  
  // Return policy concerns
  if (signals.return_policy_signals.is_final_sale) {
    concerns.push("Final sale - no returns");
  } else if (!signals.return_policy_signals.has_policy) {
    concerns.push("Return policy not specified");
  }
  
  return concerns.slice(0, 4); // Max 4 concerns
}

/**
 * Generate tooltips for UI
 */
function generateTooltips(comparison: ProductComparison): Record<string, string> {
  const tooltips: Record<string, string> = {};
  
  // Quality score tooltip
  tooltips["quality_score"] = `Based on description completeness, fabric details, and sizing information. Score: ${comparison.text_score}/100`;
  
  // Price score tooltip
  tooltips["price_score"] = `Based on price stability and market position. Risk level: ${comparison.signals.price_analysis.risk_level}`;
  
  // Image tooltip
  tooltips["image"] = comparison.signals.image_signals.is_original
    ? "Product images appear to be original"
    : `Similar images found on ${comparison.signals.image_signals.similar_image_count} other listings`;
  
  // Return policy tooltip
  tooltips["return_policy"] = comparison.signals.return_policy_signals.has_policy
    ? (comparison.signals.return_policy_signals.allows_returns ? "Returns are accepted" : "Final sale - no returns")
    : "Return policy not specified";
  
  return tooltips;
}

/**
 * Generate product summary
 */
function generateProductSummary(comparison: ProductComparison): ProductSummary {
  return {
    product_id: comparison.product_id,
    level_label: getLevelLabel(comparison.overall_level),
    level_color: comparison.overall_level,
    score: comparison.overall_score,
    highlights: generateHighlights(comparison),
    concerns: generateConcerns(comparison),
    tooltips: generateTooltips(comparison),
  };
}

// ============================================================================
// Main Verdict Generation
// ============================================================================

/**
 * Generate full verdict from comparison result
 */
export function generateVerdict(
  verdict: CompareVerdict,
  productLetters: Map<number, string> = new Map() // Map product IDs to letters (A, B, C...)
): FullVerdictResponse {
  // Ensure we have letter mappings
  if (productLetters.size === 0) {
    const letters = ["A", "B", "C", "D", "E"];
    verdict.products.forEach((p, i) => {
      productLetters.set(p.product_id, letters[i] || `${i + 1}`);
    });
  }
  
  const winnerLetter = verdict.winner_product_id 
    ? productLetters.get(verdict.winner_product_id) || "A"
    : null;
  
  // Get template
  const template = VERDICT_TEMPLATES[verdict.confidence];
  const confidenceInfo = CONFIDENCE_LABELS[verdict.confidence];
  
  // Generate title with winner letter
  const defaultTitle = winnerLetter
    ? template.title.replace("{winner_letter}", winnerLetter)
    : template.title;

  const defaultRecommendation = winnerLetter
    ? template.recommendation.replace("{winner_letter}", winnerLetter)
    : template.recommendation;

  // Generate bullet points from reasons
  const defaultBulletPoints = verdict.top_reasons.map(reason => {
    return REASON_TEMPLATES[reason]?.text || reason;
  }).slice(0, 3);
  
  // Generate tradeoff text
  let tradeoff = verdict.tradeoff_reason;
  if (tradeoff && productLetters.size >= 2) {
    // Replace "other option" with letter
    const loserLetter = Array.from(productLetters.values()).find(l => l !== winnerLetter) || "B";
    tradeoff = tradeoff.replace(/the other option/gi, `Product ${loserLetter}`);
  }
  
  let verdictOutput: VerdictOutput;
  if (verdict.comparison_mode === "cross_category_guidance") {
    verdictOutput = {
      title: "These products serve different fashion roles",
      subtitle: "No direct winner selected because this is a cross-category selection",
      bullet_points: verdict.shopping_insights.notes.slice(0, 3),
      tradeoff,
      confidence_label: "Smart Guidance",
      confidence_description: "Use picks below for quality, value, and budget",
      recommendation: verdict.shopping_insights.suggested_next_action,
    };
  } else {
    verdictOutput = {
      title: defaultTitle,
      subtitle: template.subtitle,
      bullet_points: defaultBulletPoints,
      tradeoff,
      confidence_label: confidenceInfo.label,
      confidence_description: confidenceInfo.description,
      recommendation: defaultRecommendation,
    };
  }
  
  // Generate product summaries
  const productSummaries = verdict.products.map(generateProductSummary);
  
  return {
    verdict: verdictOutput,
    product_summaries: productSummaries,
    comparison_details: {
      winner_id: verdict.winner_product_id,
      is_tie: verdict.confidence === "tie",
      score_difference: verdict.score_difference,
    },
    comparison_context: {
      mode: verdict.comparison_mode,
      comparable: verdict.compatibility.is_comparable,
      reason: verdict.compatibility.reason,
      category_groups: verdict.compatibility.category_groups,
    },
    shopping_insights: verdict.shopping_insights,
  };
}

/**
 * Get reason tooltip
 */
export function getReasonTooltip(reason: CompareReason): string {
  return REASON_TEMPLATES[reason]?.tooltip || "";
}

/**
 * Get all reason templates (for UI)
 */
export function getAllReasonTemplates(): Record<CompareReason, { text: string; tooltip: string }> {
  return { ...REASON_TEMPLATES };
}

// ============================================================================
// LLM Enhancement (Optional - for future use)
// ============================================================================

export interface LLMVerdictInput {
  winner_letter: string | null;
  confidence: string;
  reasons: string[];
  tradeoff: string | null;
  winner_score: number;
  loser_score: number;
}

/**
 * Format input for LLM (if used)
 * 
 * The LLM ONLY receives structured data and generates nicer wording.
 * It does NOT make decisions.
 */
export function formatForLLM(
  verdict: CompareVerdict,
  winnerLetter: string | null
): LLMVerdictInput {
  const [winner, loser] = verdict.products;
  
  return {
    winner_letter: winnerLetter,
    confidence: verdict.confidence,
    reasons: verdict.top_reasons.map(r => REASON_TEMPLATES[r]?.text || r),
    tradeoff: verdict.tradeoff_reason,
    winner_score: winner?.overall_score || 0,
    loser_score: loser?.overall_score || 0,
  };
}

/**
 * LLM prompt template (for reference)
 * 
 * IMPORTANT: LLM only rewrites, never decides!
 */
export const LLM_PROMPT_TEMPLATE = `
You are a fashion marketplace assistant helping customers compare products.

Given the following comparison data, write a brief, professional verdict:

Winner: Product {winner_letter}
Confidence: {confidence}
Key reasons:
{reasons}
Tradeoff: {tradeoff}

Rules:
- Never say "scam", "fake", or "counterfeit"
- Use professional language like "lower confidence", "limited information"
- Keep it under 50 words
- Be helpful but neutral

Write a verdict paragraph:
`;
