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
      `Great everyday pick: ${primaryUsageLever} plus ${secondaryUsageLever} means you'll likely wear it often.`
    );
  } else if (scores.practical >= 0.72) {
    bullets.push(`Strong daily option thanks to ${primaryUsageLever}, so it should slot into your weekly outfits easily.`);
  } else if (scores.practical >= 0.6) {
    bullets.push(`Solid for regular wear, with ${primaryUsageLever} doing most of the heavy lifting.`);
  } else {
    bullets.push(`More of a planned piece: weaker ${primaryUsageLever} means you'll need to style it more intentionally.`);
  }

  if (scores.expressive >= 0.72) {
    bullets.push(`Statement-heavy look led by ${primaryExpressionLever}; this one is more likely to get noticed.`);
  } else if (scores.expressive >= 0.58) {
    bullets.push(`Balanced personality: ${primaryExpressionLever} adds character without taking over the whole outfit.`);
  } else {
    bullets.push(`More understated overall; ${primaryExpressionLever} reads subtle rather than spotlight-seeking.`);
  }

  if (profile.usageSignals.occasionRange < 0.4) {
    bullets.push(`Best for specific moments: this ${profile.category.toLowerCase()} is less flexible across different occasions.`);
  } else if (profile.usageSignals.occasionRange < 0.6) {
    bullets.push(`Moderately flexible: it works best when you already know the vibe or plan for the day.`);
  } else {
    bullets.push(`Very flexible: this ${profile.category.toLowerCase()} can move from casual looks to more polished outfits.`);
  }

  return bullets;
}
