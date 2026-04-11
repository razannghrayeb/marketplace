/**
 * Cross-Attribute Semantic Constraints (Phase 2, Task 4)
 *
 * Implements rules for attribute interactions and incompatibilities.
 * 
 * Examples:
 * - Denim material + metallic color = unlikely (applies penalty)
 * - Matte texture + metallic shine = incompatible
 * - Leather material + translucent pattern = unlikely
 * - Formal style + tie-dye pattern = less likely
 *
 * Constraints are:
 * - Soft: Apply scoring penalty, product still ranks
 * - Hard: Product fails if constraint not met (used rarely)
 */

import type { SemanticAttribute } from "./multiVectorSearch";

// ============================================================================
// Types
// ============================================================================

export interface AttributeConstraint {
  // Which constraint this is
  name: string;

  // Involved attributes
  attributes: SemanticAttribute[];

  // Strength: "soft" = penalty, "hard" = fail
  strength: "soft" | "hard";

  // Penalty factor (0 = full rejection, 1 = no penalty)
  // Applied multiplicatively: final_score *= penaltyFactor
  penaltyFactor: number;

  // Whether to log violations (for monitoring)
  shouldLog: boolean;

  // Human-readable explanation
  description: string;
}

export interface ConstraintCheckResult {
  constraint: AttributeConstraint;
  violated: boolean;
  severity: "none" | "soft" | "hard";
  penaltyFactor: number;
}

export interface ConstraintResult {
  violations: ConstraintCheckResult[];
  overallPenalty: number; // Multiplicative penalty factor (0-1)
  failsHardConstraint: boolean; // Any hard constraint violated?
  summary: string; // Human-readable summary
}

// ============================================================================
// Semantic Similarity Matrices
// ============================================================================

/**
 * Pre-computed semantic distance between material types.
 * Used to detect material incompatibilities.
 * Higher = more dissimilar = more likely incompatible
 */
const MATERIAL_SIMILARITY: Record<string, Record<string, number>> = {
  leather: { denim: 0.6, polyester: 0.4, cotton: 0.5, silk: 0.3, wool: 0.5 },
  denim: { leather: 0.6, polyester: 0.5, cotton: 0.7, silk: 0.2, wool: 0.4 },
  cotton: { denim: 0.7, polyester: 0.6, leather: 0.5, silk: 0.4, wool: 0.3 },
  silk: { denim: 0.2, leather: 0.3, cotton: 0.4, polyester: 0.3, wool: 0.2 },
  wool: { denim: 0.4, leather: 0.5, cotton: 0.3, silk: 0.2, polyester: 0.5 },
  polyester: { denim: 0.5, leather: 0.4, cotton: 0.6, silk: 0.3, wool: 0.5 },
};

/**
 * Texture-Material compatibility matrix.
 * Some textures work better with certain materials.
 * E.g. "matte" works with leather, "glossy" works with polyester
 */
const TEXTURE_MATERIAL_COMPAT: Record<string, Record<string, number>> = {
  matte: { leather: 0.9, wool: 0.85, cotton: 0.8, denim: 0.8, silk: 0.3, polyester: 0.4 },
  glossy: { silk: 0.9, polyester: 0.85, leather: 0.5, denim: 0.2, cotton: 0.3, wool: 0.4 },
  rough: { wool: 0.9, cotton: 0.8, denim: 0.85, leather: 0.7, silk: 0.2, polyester: 0.2 },
  smooth: { silk: 0.9, polyester: 0.8, leather: 0.7, cotton: 0.6, wool: 0.3, denim: 0.2 },
  fuzzy: { wool: 0.95, cotton: 0.7, polyester: 0.4, silk: 0.2, leather: 0.2, denim: 0.2 },
};

/**
 * Color-Material affinity.
 * Some colors are more common in certain materials.
 * E.g. "metallic" colors are rare in wool, "earth tones" are common in leather
 */
const COLOR_MATERIAL_AFFINITY: Record<string, Record<string, number>> = {
  metallic: { polyester: 0.8, silk: 0.5, leather: 0.3, denim: 0.2, cotton: 0.2, wool: 0.1 },
  "earth tones": { leather: 0.9, wool: 0.8, cotton: 0.7, denim: 0.7, silk: 0.4, polyester: 0.5 },
  "pastel": { cotton: 0.85, silk: 0.85, polyester: 0.7, wool: 0.6, leather: 0.3, denim: 0.2 },
  "dark": { denim: 0.9, leather: 0.85, wool: 0.8, polyester: 0.6, cotton: 0.5, silk: 0.3 },
  "neon": { polyester: 0.9, denim: 0.5, cotton: 0.4, silk: 0.3, leather: 0.2, wool: 0.2 },
};

/**
 * Pattern-Material compatibility.
 * E.g. "tie-dye" works better on cotton, "paisley" works on silk
 */
const PATTERN_MATERIAL_COMPAT: Record<string, Record<string, number>> = {
  "tie-dye": { cotton: 0.95, polyester: 0.6, denim: 0.7, silk: 0.3, leather: 0.1, wool: 0.2 },
  paisley: { silk: 0.9, wool: 0.8, polyester: 0.7, cotton: 0.6, denim: 0.2, leather: 0.1 },
  "geometric": { polyester: 0.85, cotton: 0.75, denim: 0.6, silk: 0.7, wool: 0.4, leather: 0.3 },
  floral: { cotton: 0.9, silk: 0.85, polyester: 0.7, denim: 0.4, wool: 0.3, leather: 0.1 },
  stripes: { cotton: 0.8, silk: 0.75, denim: 0.8, wool: 0.7, polyester: 0.7, leather: 0.2 },
  plaid: { wool: 0.95, cotton: 0.8, silk: 0.5, denim: 0.8, polyester: 0.4, leather: 0.2 },
};

/**
 * Style-Pattern compatibility.
 * E.g. "bohemian" fits paisley/floral, "minimalist" fits geometric/solid
 */
const STYLE_PATTERN_COMPAT: Record<string, Record<string, number>> = {
  bohemian: { paisley: 0.95, floral: 0.9, "tie-dye": 0.85, geometric: 0.3, stripes: 0.4, plaid: 0.3 },
  minimalist: { solid: 0.95, geometric: 0.8, stripes: 0.7, plaid: 0.3, paisley: 0.1, floral: 0.2 },
  formal: { solid: 0.9, stripes: 0.8, geometric: 0.7, paisley: 0.2, "tie-dye": 0.1, floral: 0.3 },
  casual: { floral: 0.8, geometric: 0.8, stripes: 0.8, "tie-dye": 0.7, paisley: 0.5, plaid: 0.8 },
  edgy: { geometric: 0.9, solid: 0.7, stripes: 0.8, paisley: 0.3, floral: 0.1, plaid: 0.2 },
};

// ============================================================================
// Constraint Definitions
// ============================================================================

/**
 * All defined cross-attribute constraints.
 * These are checked against actual attribute values from query + product.
 */
export const SEMANTIC_CONSTRAINTS: AttributeConstraint[] = [
  {
    name: "texture-material-compatibility",
    attributes: ["texture", "material"],
    strength: "soft",
    penaltyFactor: 1.0, // Will be computed based on compatibility matrix
    shouldLog: true,
    description: "Texture must be compatible with material (e.g., matte + leather good, glossy + denim bad)",
  },

  {
    name: "color-material-realistic",
    attributes: ["color", "material"],
    strength: "soft",
    penaltyFactor: 1.0, // Will be computed
    shouldLog: true,
    description: "Color must be realistic for material (e.g., metallic colors rare in wool)",
  },

  {
    name: "pattern-material-fit",
    attributes: ["pattern", "material"],
    strength: "soft",
    penaltyFactor: 1.0, // Will be computed
    shouldLog: true,
    description: "Pattern must work with material (e.g., paisley on silk good, tie-dye on leather bad)",
  },

  {
    name: "style-pattern-coherence",
    attributes: ["style", "pattern"],
    strength: "soft",
    penaltyFactor: 1.0, // Will be computed
    shouldLog: true,
    description: "Style should match pattern tradition (e.g., bohemian + paisley, minimalist + solid)",
  },
];

// ============================================================================
// Constraint Evaluation
// ============================================================================

/**
 * Evaluate a single constraint against product attribute values.
 *
 * @param constraint Definition of the constraint
 * @param productValues Map of attribute→value (e.g., { color: "blue", material: "cotton" })
 * @returns Score (0-1) and whether violated
 */
export function evaluateConstraint(
  constraint: AttributeConstraint,
  productValues: Partial<Record<SemanticAttribute, string>>,
): ConstraintCheckResult {
  // Check if we have the necessary attributes
  const hasAll = constraint.attributes.every((attr) => productValues[attr]);
  if (!hasAll) {
    return {
      constraint,
      violated: false,
      severity: "none",
      penaltyFactor: 1, // No data, no penalty
    };
  }

  let compatScore = 1; // Default to full compatibility

  // Evaluate specific constraint types
  if (constraint.name === "texture-material-compatibility") {
    const texture = productValues.texture?.toLowerCase();
    const material = productValues.material?.toLowerCase();

    if (texture && material && TEXTURE_MATERIAL_COMPAT[texture]) {
      compatScore = TEXTURE_MATERIAL_COMPAT[texture][material] ?? 0.5;
    }
  } else if (constraint.name === "color-material-realistic") {
    const color = productValues.color?.toLowerCase();
    const material = productValues.material?.toLowerCase();

    if (color && material && COLOR_MATERIAL_AFFINITY[color]) {
      compatScore = COLOR_MATERIAL_AFFINITY[color][material] ?? 0.5;
    }
  } else if (constraint.name === "pattern-material-fit") {
    const pattern = productValues.pattern?.toLowerCase();
    const material = productValues.material?.toLowerCase();

    if (pattern && material && PATTERN_MATERIAL_COMPAT[pattern]) {
      compatScore = PATTERN_MATERIAL_COMPAT[pattern][material] ?? 0.5;
    }
  } else if (constraint.name === "style-pattern-coherence") {
    const style = productValues.style?.toLowerCase();
    const pattern = productValues.pattern?.toLowerCase();

    if (style && pattern && STYLE_PATTERN_COMPAT[style]) {
      compatScore = STYLE_PATTERN_COMPAT[style][pattern] ?? 0.5;
    }
  }

  // Determine violation
  // Soft constraints: score < 0.4 is a warning, < 0.2 is violation
  // Hard constraints: score < 0.5 is violation
  let violated = false;
  if (constraint.strength === "soft") {
    violated = compatScore < 0.3; // Soft violation threshold
  } else {
    violated = compatScore < 0.5; // Hard violation threshold
  }

  return {
    constraint,
    violated,
    severity: violated ? constraint.strength : "none",
    penaltyFactor: compatScore, // Use score directly as penalty
  };
}

/**
 * Evaluate all constraints against product attributes.
 *
 * @param productValues Map of attribute→value
 * @returns Detailed constraint violations and overall penalty
 */
export function evaluateAllConstraints(
  productValues: Partial<Record<SemanticAttribute, string>>,
): ConstraintResult {
  const violations: ConstraintCheckResult[] = [];
  let overallPenalty = 1; // Multiplicative penalty
  let failsHardConstraint = false;

  for (const constraint of SEMANTIC_CONSTRAINTS) {
    const result = evaluateConstraint(constraint, productValues);
    violations.push(result);

    // Apply penalty
    overallPenalty *= result.penaltyFactor;

    // Check hard failures
    if (result.severity === "hard") {
      failsHardConstraint = true;
    }

    if (result.violated && constraint.shouldLog) {
      console.warn(`[constraints] Constraint violated: ${constraint.name}`, {
        attributes: constraint.attributes.map((a) => `${a}=${productValues[a] ?? "null"}`).join(", "),
        penaltyFactor: result.penaltyFactor,
      });
    }
  }

  // Summary
  const violationCount = violations.filter((v) => v.violated).length;
  const summary =
    violationCount === 0
      ? "✓ All constraints satisfied"
      : `⚠ ${violationCount} constraint(s) violated (penalty: ${(overallPenalty * 100).toFixed(0)}%)`;

  return {
    violations,
    overallPenalty: Math.max(0.1, overallPenalty), // Never reduce below 10%
    failsHardConstraint,
    summary,
  };
}

/**
 * Quick check: do not hard constraints pass?
 *
 * Useful for early rejection.
 *
 * @param productValues Map of attribute→value
 * @returns true if all hard constraints pass
 */
export function hardConstraintsPassed(
  productValues: Partial<Record<SemanticAttribute, string>>,
): boolean {
  const result = evaluateAllConstraints(productValues);
  return !result.failsHardConstraint;
}
