import type { ProductDecisionProfile } from "../types";

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

export function buildConsequences(
  profile: ProductDecisionProfile,
  scores: { practical: number; expressive: number; overall: number }
): string[] {
  const bullets: string[] = [];
  const primaryUsageLever = formatUsageLever(topKey(profile.usageSignals));
  const secondaryUsageLever = formatUsageLever(secondKey(profile.usageSignals));
  const primaryExpressionLever = formatExpressionLever(topKey(profile.styleSignals));

  if (scores.practical >= 0.8) {
    bullets.push(
      `Very high daily utility driven by ${primaryUsageLever} plus ${secondaryUsageLever}, so this integrates quickly into outfit rotation.`
    );
  } else if (scores.practical >= 0.72) {
    bullets.push(`High daily utility driven by ${primaryUsageLever}, so this integrates quickly into outfit rotation.`);
  } else if (scores.practical >= 0.6) {
    bullets.push(`Practical enough for steady weekly use, with ${primaryUsageLever} doing most of the work.`);
  } else {
    bullets.push(`More deliberate piece: weaker ${primaryUsageLever} means styling effort stays higher day to day.`);
  }

  if (scores.expressive >= 0.72) {
    bullets.push(`Strong statement direction anchored by ${primaryExpressionLever}, likely to draw more social attention.`);
  } else if (scores.expressive >= 0.58) {
    bullets.push(`Balanced expression: ${primaryExpressionLever} adds personality without dominating the whole look.`);
  } else {
    bullets.push(`Lower statement pressure overall; ${primaryExpressionLever} reads subtle rather than spotlight-seeking.`);
  }

  if (profile.usageSignals.occasionRange < 0.4) {
    bullets.push(`Narrow occasion lane for ${profile.category.toLowerCase()} styling, better as a selective-context option.`);
  } else if (profile.usageSignals.occasionRange < 0.6) {
    bullets.push(`Moderate occasion spread: works best when the styling context is planned in advance.`);
  } else {
    bullets.push(`Broad occasion coverage for ${profile.category.toLowerCase()} wear, from casual to polished plans.`);
  }

  return bullets;
}
