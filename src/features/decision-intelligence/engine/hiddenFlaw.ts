import type { ProductDecisionProfile } from "../types";

export function buildHiddenFlaw(profile: ProductDecisionProfile, frictionIndex: number): string {
  if (frictionIndex >= 0.7) {
    return "Strong initial impact, but it demands frequent styling precision to avoid feeling overworked.";
  }
  if (profile.usageSignals.maintenanceEase < 0.45) {
    return "Looks premium, yet maintenance load may quietly reduce how often you reach for it.";
  }
  if (profile.derivedSignals.trendVolatility > 0.65) {
    return "Highly current aesthetic may date faster than its price suggests.";
  }
  return "Reliable profile overall; tradeoff is lower novelty versus more expressive alternatives.";
}
