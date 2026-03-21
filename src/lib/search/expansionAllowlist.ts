import { getProductTypePhrasesLongestFirst } from "./productTypeTaxonomy";
import { getAllCategoryNames } from "../queryProcessor/dictionary";

let allowSet: Set<string> | null = null;

function buildAllowSet(): Set<string> {
  const s = new Set<string>();
  for (const p of getProductTypePhrasesLongestFirst()) {
    const t = p.trim().toLowerCase();
    if (t) s.add(t);
  }
  try {
    for (const n of getAllCategoryNames()) {
      const t = String(n).trim().toLowerCase();
      if (t) s.add(t);
    }
  } catch {
    /* dictionary not initialized in some scripts */
  }
  return s;
}

function allow(): Set<string> {
  if (!allowSet) allowSet = buildAllowSet();
  return allowSet;
}

/** Synonym/category expansions must match taxonomy or catalog vocabulary (reduces poisoned recall). */
export function isExpansionTermAllowed(term: string): boolean {
  const t = String(term || "")
    .trim()
    .toLowerCase();
  if (!t || t.length > 48) return false;
  const S = allow();
  if (S.has(t)) return true;
  if (t.length < 4) return false;
  for (const a of S) {
    if (a.length >= 5 && (a.includes(t) || t.includes(a))) return true;
  }
  return false;
}
