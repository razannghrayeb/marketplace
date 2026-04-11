import { z } from "zod";

/**
 * Request body for POST /api/compare/decision (camelCase, matches storefront contract).
 */
export const compareDecisionRequestSchema = z.object({
  productIds: z.array(z.number().int().positive()).min(2).max(5),
  compareGoal: z
    .enum(["best_value", "premium_quality", "style_match", "low_risk_return", "occasion_fit"])
    .optional(),
  occasion: z.enum(["casual", "work", "formal", "party", "travel"]).optional(),
  mode: z.enum(["standard", "alter_ego"]).optional(),
  identityContext: z
    .object({
      currentSelf: z.array(z.string()).optional(),
      aspirationalSelf: z.array(z.string()).optional(),
    })
    .optional(),
  userSignals: z
    .object({
      firstAttractionProductId: z.number().int().positive().optional(),
      safeBoldPreference: z.number().min(0).max(1).optional(),
      practicalExpressivePreference: z.number().min(0).max(1).optional(),
      polishedEffortlessPreference: z.number().min(0).max(1).optional(),
    })
    .optional(),
});

export type CompareDecisionRequestParsed = z.infer<typeof compareDecisionRequestSchema>;
