import type { ParsedIntent } from "../prompt/gemeni";

function norm(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function addPositiveTokens(from: string, into: Set<string>): void {
  const n = norm(from);
  if (n.length < 2) return;
  into.add(n);
  for (const part of n.split(/[,;/|]+/).map((p) => p.trim()).filter((p) => p.length >= 2)) {
    into.add(part);
  }
}

function collectPositiveTokens(intent: ParsedIntent): Set<string> {
  const positives = new Set<string>();
  for (const ii of intent.imageIntents || []) {
    const ev = ii.extractedValues;
    if (!ev) continue;
    for (const val of Object.values(ev)) {
      const arr = Array.isArray(val) ? val : [val];
      for (const x of arr) addPositiveTokens(String(x), positives);
    }
  }
  for (const m of intent.constraints?.mustHave || []) {
    addPositiveTokens(String(m), positives);
  }
  return positives;
}

function conflictsWithPositive(negativeNorm: string, positives: Set<string>): boolean {
  if (!negativeNorm || negativeNorm.length < 2) return false;
  if (positives.has(negativeNorm)) return true;
  for (const p of positives) {
    if (p.length < 2 || negativeNorm.length < 2) continue;
    if (p === negativeNorm) return true;
    if (p.includes(negativeNorm) || negativeNorm.includes(p)) return true;
  }
  return false;
}

/**
 * Remove negative constraint values that also appear in positive image intents or mustHave,
 * avoiding OpenSearch should + must_not collisions on the same lexical signal.
 */
export function reconcileIntentNegativeCollisions(intent: ParsedIntent): void {
  const positives = collectPositiveTokens(intent);
  if (positives.size === 0) return;

  const na = intent.constraints.negativeAttributes;
  if (na) {
    for (const key of Object.keys(na) as (keyof typeof na)[]) {
      const arr = na[key];
      if (!Array.isArray(arr)) continue;
      const kept: string[] = [];
      for (const v of arr) {
        const n = norm(String(v));
        if (conflictsWithPositive(n, positives)) {
          console.warn(
            `[intent] Dropped negative "${v}" (${String(key)}) — overlaps positive intent`,
          );
        } else {
          kept.push(v);
        }
      }
      (na as Record<string, string[]>)[key as string] = kept;
    }
  }

  const mn = intent.constraints.mustNotHave;
  if (mn?.length) {
    intent.constraints.mustNotHave = mn.filter((v) => {
      const n = norm(String(v));
      if (conflictsWithPositive(n, positives)) {
        console.warn(`[intent] Dropped mustNotHave "${v}" — overlaps positive intent`);
        return false;
      }
      return true;
    });
  }
}
