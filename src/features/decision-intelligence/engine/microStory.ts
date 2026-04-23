import type { ProductDecisionProfile } from "../types";

export function buildMicroStory(profile: ProductDecisionProfile, practical: number, expressive: number): string {
  if (practical >= 0.65 && expressive < 0.55) {
    return `${profile.title} is the kind of anchor piece you can wear often without overthinking the outfit.`;
  }
  if (practical < 0.55 && expressive >= 0.65) {
    return `${profile.title} feels like a mood piece: memorable when you choose it, but not your most automatic weekly pick.`;
  }
  return `${profile.title} balances practicality and personality, so it can work for both regular days and standout moments.`;
}
