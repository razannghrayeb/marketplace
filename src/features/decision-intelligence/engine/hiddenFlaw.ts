import type { ProductDecisionProfile } from "../types";

export function buildHiddenFlaw(profile: ProductDecisionProfile, frictionIndex: number): string {
  if (frictionIndex >= 0.7) {
    return "Looks great at first glance, but it needs careful styling to avoid feeling overdone.";
  }
  if (profile.usageSignals.maintenanceEase < 0.45) {
    return "Looks premium, but the upkeep may make you wear it less often over time.";
  }
  if (profile.derivedSignals.trendVolatility > 0.65) {
    return "Very trend-driven style may feel dated sooner than its price suggests.";
  }
  return "Overall dependable choice, with less novelty than more expressive alternatives.";
}
