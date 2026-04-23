import type { CompareDecisionResponse } from "../types";
import { clamp01 } from "./scoreUtils";

export function scoreDecisionConfidence(input: {
  sortedOverallScores: number[];
  dataQuality: number;
  winnersByContext: CompareDecisionResponse["winnersByContext"];
}): { level: "clear_choice" | "leaning_choice" | "toss_up"; score: number; explanation: string[] } {
  const [first = 0, second = 0] = input.sortedOverallScores;
  const margin = Math.max(0, first - second);

  const contextWinners = Object.values(input.winnersByContext).filter(Boolean) as number[];
  const uniqueContextWinners = new Set(contextWinners);
  const agreement = contextWinners.length > 0 ? clamp01(1 - (uniqueContextWinners.size - 1) / contextWinners.length) : 0.5;

  const score = clamp01(margin * 0.55 + agreement * 0.25 + input.dataQuality * 0.2);

  const explanation: string[] = [
    `The leading product is ahead by ${Math.round(margin * 100)} points.`,
    `Most scoring signals point to the same winner ${Math.round(agreement * 100)}% of the time.`,
  ];

  if (input.dataQuality < 0.55) {
    explanation.push("Some product details are thin, so the recommendation is a little less certain.");
  }

  if (score >= 0.72) return { level: "clear_choice", score, explanation };
  if (score >= 0.5) return { level: "leaning_choice", score, explanation };
  return { level: "toss_up", score, explanation };
}
