/**
 * Query understanding layer for fashion search: domain gate, expansion policy,
 * soft vs hard color, and default kNN behavior. Feeds `textSearch` orchestration.
 */

import type { QueryAST } from "../queryProcessor/types";
import { isExpansionTermAllowed } from "./expansionAllowlist";

export interface QueryUnderstanding {
  domainConfidence: number;
  /** True → skip search and return empty (when domain gate enabled). */
  offDomain: boolean;
  /** Weak-fashion query: strip expansions and disable CLIP kNN (BM25-only retrieval). */
  borderlineFashion: boolean;
  /** Drop AST category expansions (noisy catalog poisoning). */
  dropCategoryExpansions: boolean;
  /** Drop synonym expansions when confidence is very low. */
  dropSynonymExpansions: boolean;
  /** Max terms total across expansion channels (after filtering). */
  maxExpansionTerms: number;
  /** AST-only color: use should-boost + rerank, not hard OpenSearch filter. */
  softColorFromAst: boolean;
  /** Text hybrid: kNN as should-boost only (no must + min_score). */
  knnTextBoostOnly: boolean;
  filteredSynonyms: string[];
  filteredCategoryExpansions: string[];
  filteredTransliterations: string[];
  /** Human-readable trace for debug / eval. */
  reasons: string[];
}

const OFF_DOMAIN_LEXICON = new Set(
  [
    "food",
    "foods",
    "eat",
    "eating",
    "restaurant",
    "pizza",
    "burger",
    "burgers",
    "coffee",
    "groceries",
    "grocery",
    "kitchen",
    "recipe",
    "phone",
    "phones",
    "iphone",
    "android",
    "laptop",
    "computer",
    "tv",
    "television",
    "car",
    "cars",
    "furniture",
    "book",
    "books",
    "movie",
    "games",
    "gaming",
    "medicine",
    "pharmacy",
    "flight",
    "hotel",
    "tool",
    "tools",
    "drill",
    "hammer",
    "sofa",
    "desk",
    "chair",
    "table",
    "refrigerator",
    "washer",
    "dryer",
    "toy",
    "toys",
    "pet",
    "pets",
    "dog",
    "cat",
    "fish",
    "baby",
    "stroller",
    "vitamin",
    "supplement",
    "software",
    "download",
    "subscription",
    "crypto",
    "bitcoin",
    "weapon",
    "gun",
    "ammunition",
  ].map((s) => s.toLowerCase()),
);

const FASHION_STOPWORDS = new Set([
  "for",
  "with",
  "and",
  "the",
  "a",
  "an",
  "in",
  "on",
  "of",
  "to",
  "mens",
  "men",
  "womens",
  "women",
  "kids",
  "kid",
  "size",
  "new",
  "sale",
]);

function envFlag(name: string, defaultTrue: boolean): boolean {
  const v = String(process.env[name] ?? "").toLowerCase().trim();
  if (!v) return defaultTrue;
  if (v === "0" || v === "false" || v === "off" || v === "no") return false;
  if (v === "1" || v === "true" || v === "on" || v === "yes") return true;
  return defaultTrue;
}

/** When false, off-domain queries still run full search (legacy). */
export function searchDomainGateEnabled(): boolean {
  return envFlag("SEARCH_DOMAIN_GATE", true);
}

function searchKnnTextInMust(): boolean {
  const v = String(process.env.SEARCH_KNN_TEXT_IN_MUST ?? "").toLowerCase();
  return v === "1" || v === "true";
}

function astSoftColorConfidenceThreshold(): number {
  const raw = Number(process.env.SEARCH_AST_SOFT_COLOR_CONFIDENCE ?? "0.62");
  return Number.isFinite(raw) ? Math.min(0.95, Math.max(0.3, raw)) : 0.62;
}

function expansionMaxTerms(): number {
  const n = Number(process.env.SEARCH_EXPANSION_MAX_TERMS ?? "5");
  return Number.isFinite(n) ? Math.min(24, Math.max(3, Math.floor(n))) : 5;
}

function expansionMaxSynonyms(): number {
  const n = Number(process.env.SEARCH_EXPANSION_MAX_SYNONYMS ?? "5");
  return Number.isFinite(n) ? Math.min(8, Math.max(1, Math.floor(n))) : 5;
}

function expansionMaxCategory(): number {
  const n = Number(process.env.SEARCH_EXPANSION_MAX_CATEGORY ?? "3");
  return Number.isFinite(n) ? Math.min(8, Math.max(1, Math.floor(n))) : 3;
}

function expansionMaxTranslit(): number {
  const n = Number(process.env.SEARCH_EXPANSION_MAX_TRANSLIT ?? "3");
  return Number.isFinite(n) ? Math.min(6, Math.max(1, Math.floor(n))) : 3;
}

function astExpansionConfidenceCutoff(): number {
  const n = Number(process.env.SEARCH_AST_EXPANSION_CONFIDENCE_MIN ?? "0.54");
  return Number.isFinite(n) ? Math.min(0.9, Math.max(0.35, n)) : 0.54;
}

/** CLIP text vs fashion prototype below this ⇒ off-domain when no AST anchors (config.search.domainEmbeddingRejectBelow). */
function domainEmbeddingRejectBelow(): number {
  const n = Number(process.env.SEARCH_DOMAIN_EMBEDDING_REJECT_BELOW ?? "0.3");
  return Number.isFinite(n) ? Math.min(0.55, Math.max(0.15, n)) : 0.3;
}

function hasFashionAnchor(ast: QueryAST): boolean {
  const e = ast.entities;
  if ((e.productTypes?.length ?? 0) > 0) return true;
  if ((e.categories?.length ?? 0) > 0) return true;
  if ((e.brands?.length ?? 0) > 0) return true;
  if ((e.materials?.length ?? 0) > 0) return true;
  if ((e.patterns?.length ?? 0) > 0) return true;
  return false;
}

function computeDomainConfidence(ast: QueryAST, rawQuery: string): number {
  let score = 0.35;
  if (hasFashionAnchor(ast)) score += 0.35;
  if ((ast.entities.colors?.length ?? 0) > 0) score += 0.12;
  if (ast.intent?.type === "search" && ast.intent.confidence > 0.55) score += 0.1;
  score += Math.min(0.15, ast.confidence * 0.15);
  const q = rawQuery.trim().toLowerCase();
  if (q.length >= 2 && q.length <= 64) {
    const tokens = q.split(/\s+/).filter((t) => t && !FASHION_STOPWORDS.has(t));
    const offHits = tokens.filter((t) => OFF_DOMAIN_LEXICON.has(t)).length;
    if (tokens.length > 0 && offHits === tokens.length && !hasFashionAnchor(ast)) {
      return Math.min(score, 0.12);
    }
    if (offHits > 0 && !hasFashionAnchor(ast)) {
      score -= 0.08 * offHits;
    }
  }
  return Math.max(0, Math.min(1, score));
}

function isOffDomain(ast: QueryAST, rawQuery: string, domainConfidence: number): boolean {
  if (hasFashionAnchor(ast)) return false;
  const q = rawQuery.trim().toLowerCase();
  if (!q) return false;
  const tokens = q.split(/\s+/).filter((t) => t && !FASHION_STOPWORDS.has(t));
  if (tokens.length === 0) return false;
  const allOff = tokens.every((t) => OFF_DOMAIN_LEXICON.has(t));
  if (allOff) return true;
  if (tokens.length === 1 && OFF_DOMAIN_LEXICON.has(tokens[0])) return true;
  return false;
}

function dedupeCap(arr: string[], max: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of arr) {
    const t = String(x || "")
      .trim()
      .toLowerCase();
    if (!t || t.length > 48 || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

export interface BuildQueryUnderstandingOpts {
  callerPinnedColor?: boolean;
  /** 0..1 CLIP text vs fashion prototype; from `computeEmbeddingFashionScore`. */
  embeddingFashion01?: number | null;
}

/**
 * Derive orchestration hints from QueryAST + raw query + caller context.
 */
export function buildQueryUnderstanding(
  ast: QueryAST,
  rawQuery: string,
  opts?: BuildQueryUnderstandingOpts,
): QueryUnderstanding {
  const reasons: string[] = [];
  let domainConfidence = computeDomainConfidence(ast, rawQuery);
  const emb = opts?.embeddingFashion01;
  if (typeof emb === "number" && Number.isFinite(emb)) {
    domainConfidence = Math.max(0, Math.min(1, domainConfidence * 0.5 + emb * 0.5));
    reasons.push("domain_blend_clip_text");
  }

  let offDomain = isOffDomain(ast, rawQuery, domainConfidence);
  const embReject = domainEmbeddingRejectBelow();
  if (!offDomain && !hasFashionAnchor(ast) && typeof emb === "number" && emb < embReject) {
    offDomain = true;
    reasons.push("off_domain_clip_low");
  }
  if (offDomain) reasons.push("off_domain");

  const borderlineFashion =
    !offDomain &&
    !hasFashionAnchor(ast) &&
    domainConfidence < 0.44 &&
    (typeof emb !== "number" || emb < 0.48);
  if (borderlineFashion) reasons.push("borderline_fashion_strict_retrieval");

  const expCut = astExpansionConfidenceCutoff();
  const dropCategoryExpansions =
    borderlineFashion || ast.confidence < expCut || domainConfidence < 0.44;
  if (dropCategoryExpansions) reasons.push("drop_category_expansions_low_confidence");

  const dropSynonymExpansions =
    borderlineFashion || ast.confidence < expCut - 0.08 || domainConfidence < 0.36;
  if (dropSynonymExpansions) reasons.push("drop_synonym_expansions_very_low_confidence");

  const maxTerms = expansionMaxTerms();
  const synCap = Math.min(expansionMaxSynonyms(), maxTerms);
  const catCap = Math.min(expansionMaxCategory(), maxTerms);
  const trCap = Math.min(expansionMaxTranslit(), maxTerms);

  let filteredSynonyms = dropSynonymExpansions ? [] : dedupeCap(ast.expansions.synonyms, synCap);
  let filteredCategoryExpansions = dropCategoryExpansions
    ? []
    : dedupeCap(ast.expansions.categoryExpansions, catCap);
  let filteredTransliterations = borderlineFashion
    ? []
    : dedupeCap(ast.expansions.transliterations, trCap);

  const allowExp = (t: string) => isExpansionTermAllowed(t);
  filteredSynonyms = filteredSynonyms.filter(allowExp);
  filteredCategoryExpansions = filteredCategoryExpansions.filter(allowExp);
  filteredTransliterations = filteredTransliterations.filter(allowExp);

  const used =
    filteredSynonyms.length + filteredCategoryExpansions.length + filteredTransliterations.length;
  if (used > maxTerms) {
    filteredSynonyms = filteredSynonyms.slice(0, Math.max(1, Math.floor(maxTerms / 3)));
    filteredCategoryExpansions = filteredCategoryExpansions.slice(
      0,
      Math.max(1, Math.floor(maxTerms / 3)),
    );
    filteredTransliterations = filteredTransliterations.slice(0, Math.max(1, Math.floor(maxTerms / 4)));
    reasons.push("expansion_round_robin_cap");
  }

  const th = astSoftColorConfidenceThreshold();
  const softColorFromAst =
    !opts?.callerPinnedColor &&
    (ast.entities.colors?.length ?? 0) > 0 &&
    ast.confidence < th;
  if (softColorFromAst) reasons.push("soft_color_ast_low_confidence");

  const knnTextBoostOnly = !searchKnnTextInMust();
  if (knnTextBoostOnly) reasons.push("knn_text_boost_only_default");

  return {
    domainConfidence,
    offDomain,
    borderlineFashion,
    dropCategoryExpansions,
    dropSynonymExpansions,
    maxExpansionTerms: maxTerms,
    softColorFromAst,
    knnTextBoostOnly,
    filteredSynonyms,
    filteredCategoryExpansions,
    filteredTransliterations,
    reasons,
  };
}
