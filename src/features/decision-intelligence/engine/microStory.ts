import type { ProductDecisionProfile } from "../types";

export function buildMicroStory(profile: ProductDecisionProfile, practical: number, expressive: number): string {
  if (practical >= 0.65 && expressive < 0.55) {
    return `${profile.title} is an easy anchor piece you can throw on often without overthinking your outfit.`;
  }
  if (practical < 0.55 && expressive >= 0.65) {
    return `${profile.title} feels like a mood piece: memorable when you choose it, but not your most automatic weekly reach.`;
  }
  return `${profile.title} balances everyday practicality with personality, so it can work for both regular plans and standout moments.`;
}
