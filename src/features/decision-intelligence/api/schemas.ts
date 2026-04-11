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
const comparisonModeSchema = z.enum(["direct_head_to_head", "scenario_compare", "outfit_compare"]);

const preferenceSchema = z.number().min(0).max(1);
const positiveIntFromNumberOrStringSchema = z
  .union([z.number(), z.string().regex(/^\d+$/)])
  .transform((v) => Number(v))
  .pipe(z.number().int().positive());

export const CompareDecisionRequestSchema = z
  .object({
    productIds: z.array(positiveIntFromNumberOrStringSchema).min(2).max(5).optional(),
    product_ids: z.array(positiveIntFromNumberOrStringSchema).min(2).max(5).optional(),
    compareGoal: compareGoalSchema.optional(),
    compare_goal: compareGoalSchema.optional(),
    requestedGoal: compareGoalSchema.optional(),
    requested_goal: compareGoalSchema.optional(),
    occasion: occasionSchema.optional(),
    requestedOccasion: occasionSchema.optional(),
    requested_occasion: occasionSchema.optional(),
    comparisonMode: comparisonModeSchema.optional(),
    comparison_mode: comparisonModeSchema.optional(),
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
    const compareGoal = v.compareGoal ?? v.compare_goal ?? v.requestedGoal ?? v.requested_goal;
    const occasion = v.occasion ?? v.requestedOccasion ?? v.requested_occasion;
    return {
      productIds,
      compareGoal,
      occasion,
      comparisonMode: v.comparisonMode ?? v.comparison_mode,
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
