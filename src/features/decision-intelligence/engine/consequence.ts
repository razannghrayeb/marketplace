import type { ProductDecisionProfile } from "../types";

export function buildConsequences(
  profile: ProductDecisionProfile,
  scores: { practical: number; expressive: number; overall: number }
): string[] {
  const bullets: string[] = [];

  if (scores.practical >= 0.65) {
    bullets.push("Easier to integrate into repeat wear with lower daily styling friction.");
  } else {
    bullets.push("Requires more deliberate styling, with less automatic day-to-day utility.");
  }

  if (scores.expressive >= 0.65) {
    bullets.push("More visually assertive, increasing social visibility and statement value.");
  } else {
    bullets.push("Safer visual profile with lower statement pressure in routine use.");
  }

  if (profile.usageSignals.occasionRange < 0.45) {
    bullets.push("Best for targeted occasions rather than broad weekly rotation.");
  } else {
    bullets.push("Supports broader occasion coverage from casual to polished contexts.");
  }

  return bullets;
}
