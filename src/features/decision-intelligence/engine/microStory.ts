import type { ProductDecisionProfile } from "../types";

export function buildMicroStory(profile: ProductDecisionProfile, practical: number, expressive: number): string {
  if (practical >= 0.65 && expressive < 0.55) {
    return `${profile.title} becomes a high-rotation anchor piece that quietly stabilizes your wardrobe decisions.`;
  }
  if (practical < 0.55 && expressive >= 0.65) {
    return `${profile.title} works as a selective mood piece: memorable when chosen, less automatic for weekly wear.`;
  }
  return `${profile.title} balances utility and expression, making it a flexible option across routine and standout moments.`;
}
