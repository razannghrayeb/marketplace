export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function weightedSum(
  values: Record<string, number>,
  weights: Record<string, number>
): number {
  let sum = 0;
  let weightSum = 0;
  for (const [key, weight] of Object.entries(weights)) {
    const v = values[key] ?? 0;
    sum += clamp01(v) * weight;
    weightSum += weight;
  }
  if (weightSum <= 0) return 0;
  return clamp01(sum / weightSum);
}

export function normalizePriceScore(effectivePrice: number, maxPrice: number, minPrice: number): number {
  if (!Number.isFinite(effectivePrice) || maxPrice <= minPrice) return 0.5;
  const normalized = 1 - (effectivePrice - minPrice) / (maxPrice - minPrice);
  return clamp01(normalized);
}

export function to2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function tokenized(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function hasAny(text: string, words: string[]): boolean {
  const normalized = ` ${text.toLowerCase()} `;
  return words.some((w) => normalized.includes(` ${w.toLowerCase()} `));
}
