import { z } from "zod";
import type { CompareDecisionRequest } from "../types";

const compareGoalSchema = z.enum([
  "best_value",
  "premium_quality",
  "style_match",
  "low_risk_return",
  "occasion_fit",
]);

const occasionSchema = z.enum(["casual", "work", "formal", "party", "travel"]);

const modeSchema = z.enum(["standard", "alter_ego"]);

const preferenceSchema = z.number().min(0).max(1);

export const CompareDecisionRequestSchema = z
  .object({
    productIds: z.array(z.number().int().positive()).min(2).max(5).optional(),
    product_ids: z.array(z.number().int().positive()).min(2).max(5).optional(),
    compareGoal: compareGoalSchema.optional(),
    compare_goal: compareGoalSchema.optional(),
    occasion: occasionSchema.optional(),
    mode: modeSchema.optional(),
    identityContext: z
      .object({
        currentSelf: z.array(z.string().min(1)).optional(),
        aspirationalSelf: z.array(z.string().min(1)).optional(),
      })
      .optional(),
    userSignals: z
      .object({
        firstAttractionProductId: z.number().int().positive().optional(),
        safeBoldPreference: preferenceSchema.optional(),
        practicalExpressivePreference: preferenceSchema.optional(),
        polishedEffortlessPreference: preferenceSchema.optional(),
      })
      .optional(),
    debug: z.boolean().optional(),
  })
  .transform((v): CompareDecisionRequest => {
    const productIds = v.productIds ?? v.product_ids ?? [];
    return {
      productIds,
      compareGoal: v.compareGoal ?? v.compare_goal,
      occasion: v.occasion,
      mode: v.mode,
      identityContext: v.identityContext,
      userSignals: v.userSignals,
      debug: v.debug,
    };
  })
  .superRefine((v, ctx) => {
    const uniqueCount = new Set(v.productIds).size;
    if (uniqueCount !== v.productIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "productIds must contain unique IDs",
        path: ["productIds"],
      });
    }
  });

export type CompareDecisionRequestInput = z.input<typeof CompareDecisionRequestSchema>;
