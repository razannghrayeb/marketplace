import type { CompareOccasion, ProductDecisionProfile } from "../types";

function topKey<T extends Record<string, number>>(obj: T): keyof T {
  return Object.entries(obj).sort((a, b) => b[1] - a[1])[0][0] as keyof T;
}

function formatUsageLever(key: keyof ProductDecisionProfile["usageSignals"]): string {
  switch (key) {
    case "stylingEase":
      return "easy styling";
    case "versatility":
      return "mix-and-match versatility";
    case "occasionRange":
      return "cross-occasion range";
    case "maintenanceEase":
      return "low-maintenance care";
    case "seasonality":
      return "seasonal flexibility";
    case "repeatWearPotential":
      return "repeat-wear potential";
    default:
      return "everyday usability";
  }
}

function formatExpressionLever(key: keyof ProductDecisionProfile["styleSignals"]): string {
  switch (key) {
    case "classic":
      return "classic line";
    case "trendy":
      return "trend-forward edge";
    case "polished":
      return "polished finish";
    case "relaxed":
      return "relaxed attitude";
    case "edgy":
      return "edgy energy";
    case "feminine":
      return "feminine tone";
    case "minimal":
      return "minimal framing";
    case "expressive":
      return "expressive styling";
    default:
      return "visual identity";
  }
}

function secondKey<T extends Record<string, number>>(obj: T): keyof T {
  const sorted = Object.entries(obj).sort((a, b) => b[1] - a[1]);
  return (sorted[1]?.[0] ?? sorted[0][0]) as keyof T;
}

function categoryNoun(category: string): string {
  const normalized = category.trim().toLowerCase();
  if (!normalized) return "piece";
  if (normalized.endsWith("dresses")) return "dress";
  if (normalized.endsWith("ies")) return `${normalized.slice(0, -3)}y`;
  if (normalized.endsWith("s")) return normalized.slice(0, -1);
  return normalized;
}

function buildOccasionGuidance(
  requestedOccasion: CompareOccasion | undefined,
  occasionScore: number
): string | undefined {
  if (!requestedOccasion) return undefined;

  if (requestedOccasion === "casual") {
    if (occasionScore < 0.58) return "For casual plans specifically, this may feel a bit dressier and need more intentional styling.";
    if (occasionScore >= 0.72) return "For casual days, this should feel easy, relaxed, and low-effort to style.";
    return undefined;
  }

  if (requestedOccasion === "work") {
    if (occasionScore < 0.58) return "For work settings, this can read a bit too expressive, so you may need more polished styling.";
    if (occasionScore >= 0.72) return "For work, this has a polished, dependable vibe that should be easy to wear confidently.";
    return undefined;
  }

  if (requestedOccasion === "formal") {
    if (occasionScore < 0.58) return "For formal events, this may read a little too relaxed unless you style it up with stronger accessories.";
    if (occasionScore >= 0.72) return "For formal events, this has the polished presence you usually want in dressier settings.";
    return undefined;
  }

  if (requestedOccasion === "party") {
    if (occasionScore < 0.58) return "For party plans, this can feel more quiet than standout, so styling details will matter more.";
    if (occasionScore >= 0.72) return "For party plans, this carries strong social energy and should stand out in the right way.";
    return undefined;
  }

  if (requestedOccasion === "travel") {
    if (occasionScore < 0.58) return "For travel, this may need more planning than ideal, especially if you want easy repeat outfits.";
    if (occasionScore >= 0.72) return "For travel, this looks easy to repeat, pack around, and wear across different plans.";
    return undefined;
  }

  return undefined;
}

export function buildConsequences(
  profile: ProductDecisionProfile,
  scores: { practical: number; expressive: number; overall: number },
  requestedOccasion?: CompareOccasion,
  occasionScore: number = 0.5
): string[] {
  const bullets: string[] = [];
  const primaryUsageLever = formatUsageLever(topKey(profile.usageSignals));
  const secondaryUsageLever = formatUsageLever(secondKey(profile.usageSignals));
  const primaryExpressionLever = formatExpressionLever(topKey(profile.styleSignals));
  const contextAdjustedPractical =
    requestedOccasion != null ? scores.practical * (0.55 + occasionScore * 0.45) : scores.practical;

  if (contextAdjustedPractical >= 0.8) {
    bullets.push(
      `Easy winner for real life: ${primaryUsageLever} and ${secondaryUsageLever} make this one simple to wear on repeat.`
    );
  } else if (contextAdjustedPractical >= 0.72) {
    bullets.push(`Great day-to-day option. ${primaryUsageLever} helps it slide into your weekly outfits with less effort.`);
  } else if (contextAdjustedPractical >= 0.6) {
    bullets.push(`Solid for regular wear, with ${primaryUsageLever} doing most of the work.`);
  } else {
    bullets.push(`More of a planned look than a grab-and-go piece, so you'll likely style it with intention.`);
  }

  const occasionGuidance = buildOccasionGuidance(requestedOccasion, occasionScore);
  if (occasionGuidance) {
    bullets.push(occasionGuidance);
  }

  if (scores.expressive >= 0.72) {
    bullets.push(`This one has clear statement energy. ${primaryExpressionLever} gives it a stronger "notice me" vibe.`);
  } else if (scores.expressive >= 0.58) {
    bullets.push(`Balanced style personality: ${primaryExpressionLever} adds character without taking over your whole look.`);
  } else {
    bullets.push(`More on the subtle side. ${primaryExpressionLever} feels polished and quiet instead of spotlight-seeking.`);
  }

  if (profile.usageSignals.occasionRange < 0.4) {
    bullets.push(`Best for specific moments. This ${categoryNoun(profile.category)} is less flexible across different occasions.`);
  } else if (profile.usageSignals.occasionRange < 0.6) {
    bullets.push(`Moderately flexible: it works best when you already know the vibe or have a plan.`);
  } else {
    bullets.push(`Very flexible: you can dress this ${categoryNoun(profile.category)} down for casual plans or up for polished moments.`);
  }

  return bullets;
}
