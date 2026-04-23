import type { CompareDecisionResponse } from "../types";
import { clamp01 } from "./scoreUtils";

export function scoreDecisionConfidence(input: {
  sortedOverallScores: number[];
  allOverallScores?: number[];
  dataQuality: number;
  winnersByContext: CompareDecisionResponse["winnersByContext"];
}): { level: "clear_choice" | "leaning_choice" | "toss_up"; score: number; explanation: string[] } {
  const [first = 0, second = 0] = input.sortedOverallScores;
  const margin = Math.max(0, first - second);
  const allScores = (input.allOverallScores?.length ? input.allOverallScores : input.sortedOverallScores).slice();
  const spread =
    allScores.length > 1 ? Math.max(...allScores) - Math.min(...allScores) : margin;

  const contextWinners = Object.values(input.winnersByContext).filter(Boolean) as number[];
  const uniqueContextWinners = new Set(contextWinners);
  const agreement =
    contextWinners.length > 0 ? clamp01(1 - (uniqueContextWinners.size - 1) / contextWinners.length) : 0.5;

  const score = clamp01(margin * 0.5 + spread * 0.18 + agreement * 0.2 + input.dataQuality * 0.12);
  const marginPoints = Math.round(margin * 100);
  const spreadPoints = Math.round(spread * 100);
  const agreementPct = Math.round(agreement * 100);

  const explanation: string[] = [
    marginPoints <= 1
      ? "Top options are nearly tied on overall score."
      : `The leading product is ahead by ${marginPoints} points.`,
    spreadPoints <= 2
      ? "Overall scores are tightly grouped, so small preference shifts can change the winner."
      : `Score spread across options is ${spreadPoints} points, giving a clearer separation.`,
    `Most scoring signals point to the same winner about ${agreementPct}% of the time.`,
  ];

  if (input.dataQuality < 0.55) {
    explanation.push("Some product details are thin, so treat this recommendation as directional.");
  }

  if (score >= 0.72 && margin >= 0.09) return { level: "clear_choice", score, explanation };
  if (score >= 0.5 && margin >= 0.03) return { level: "leaning_choice", score, explanation };
  return { level: "toss_up", score, explanation };
}
