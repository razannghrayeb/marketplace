/**
 * Query Processor – Single-path pipeline
 *
 * Every text query flows through ONE function: `processQuery`.
 * It always returns a `QueryAST`.
 *
 * Pipeline:
 *   1. Cache check
 *   2. Normalize text
 *   3. Detect script  (en / ar / arabizi / mixed)
 *   4. Tokenize
 *   5. Corrections    (arabizi → english, brand aliases, spell-check)
 *   6. LLM rewrite    (async path only, skipped in sync mode)
 *   7. Extract entities & filters
 *   8. Build rewritten search query
 *   9. Classify intent (rules; ML fallback when confidence is low)
 *  10. Generate expansions
 *  11. Cache & return QueryAST
 */

import type {
  QueryAST,
  QueryIntent,
  QueryExpansions,
  QueryEntities,
  QueryFilters,
  QueryTokens,
  ScriptAnalysis,
  Correction,
  ExtractedFilters,
} from "./types";

import {
  detectScript,
  arabiziToArabic,
  normalizeArabic,
  getTransliterationVariants,
  expandFashionTerm,
  hasArabiziPattern,
} from "./arabizi";

import { correctQuery, confidenceToLevel } from "./spellCorrector";

import {
  getDictionaries,
  findBrand,
  findCategory,
  getAllBrandNames,
  getAllCategoryNames,
  getAllGenders,
} from "./dictionary";

import { rewriteWithLLM, shouldUseLLM } from "./llmRewriter";

import {
  getCachedQueryAST,
  cacheQueryAST,
  getCachedEmbedding,
  cacheEmbedding,
} from "./cache";
import {
  getQueryAstFromRedis,
  isQueryAstRedisCacheEnabled,
  setQueryAstInRedis,
} from "./queryAstRedisCache";
import { config } from "../../config";

import { parseParameters } from "./parameterParser";

import {
  classifyQueryIntent,
  classifyQueryIntentHybrid,
  getConfidenceScore,
} from "./intent";

import { getTextEmbedding, isClipAvailable, isTextSearchAvailable } from "../image";
import { extractAttributesSync } from "../search/attributeExtractor";

// ─── Configuration ───────────────────────────────────────────────────────────

const THRESHOLDS = {
  autoApply: 0.85,
  suggest: 0.65,
  reject: 0.40,
  llm: 0.70,
} as const;

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at",
  "to", "for", "of", "with", "by", "from",
]);

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Full async pipeline (includes optional LLM rewrite + ML intent).
 * This is THE recommended entry-point for search routes.
 */
export async function processQuery(raw: string): Promise<QueryAST> {
  return runPipeline(raw, { useLLM: true, useMLIntent: true });
}

/**
 * Fast pipeline (no LLM, no ML model).
 * Use for autocomplete / typeahead / high-throughput paths.
 */
export async function processQueryFast(raw: string): Promise<QueryAST> {
  return runPipeline(raw, { useLLM: false, useMLIntent: false });
}

/**
 * Get (or compute & cache) a CLIP text embedding for a search query.
 *
 * CLIP was trained on (image, caption) pairs.  Product embeddings in the
 * index are image embeddings, so a raw text query like "blue jeans" sits
 * in a different region of the latent space than a product photo of blue
 * jeans.  We use prompt ensembling (averaging multiple templates) from
 * the original CLIP paper to bridge this modality gap.
 */
export async function getQueryEmbedding(query: string): Promise<number[] | null> {
  const cached = getCachedEmbedding(query);
  if (cached) return cached;

  if (!isTextSearchAvailable()) {
    console.warn("[queryProcessor] text embedding skipped — text model not loaded");
    return null;
  }

  try {
    const embedding = await buildEnsembledEmbedding(query);
    cacheEmbedding(query, embedding);
    return embedding;
  } catch (err) {
    console.warn("[queryProcessor] embedding failed:", err);
    return null;
  }
}

/**
 * Fashion-domain prompt templates aligned with CLIP's training
 * distribution (image-caption pairs).  Each template emphasizes a
 * slightly different framing, and the averaged embedding is more
 * robust than any single template — this is the "prompt ensembling"
 * technique from the original CLIP paper (Section 3.1.4).
 */
const PROMPT_TEMPLATES = [
  (q: string) => `a photo of ${q}, fashion product`,
  (q: string) => `a fashion product photo of ${q}`,
  (q: string) => `a product photo of ${q}, high quality`,
  (q: string) => `${q}, fashion item, studio photography`,
  (q: string) => `a close-up photo of ${q}`,
];

/**
 * For longer queries (>= 4 words) that already carry enough semantic
 * signal, fewer templates avoid diluting the specificity.
 */
const LONG_QUERY_TEMPLATES = [
  (q: string) => `a fashion product photo of ${q}`,
  (q: string) => `a photo of ${q}, fashion product`,
];

/**
 * Generate an ensembled embedding by averaging across multiple prompt
 * templates.  The averaged vector sits closer to the centroid of the
 * "fashion product" region in CLIP space, making it more likely to
 * match product image embeddings regardless of caption phrasing.
 */
async function buildEnsembledEmbedding(query: string): Promise<number[]> {
  const q = query.trim().toLowerCase();
  const templates = q.split(/\s+/).length >= 4
    ? LONG_QUERY_TEMPLATES
    : PROMPT_TEMPLATES;

  const embeddings = await Promise.all(
    templates.map(tpl => getTextEmbedding(tpl(q)))
  );

  // Element-wise average + L2 normalize
  const dim = embeddings[0].length;
  const avg = new Array(dim).fill(0);
  for (const emb of embeddings) {
    for (let i = 0; i < dim; i++) {
      avg[i] += emb[i];
    }
  }
  const n = embeddings.length;
  for (let i = 0; i < dim; i++) {
    avg[i] /= n;
  }

  const norm = Math.sqrt(avg.reduce((s, v) => s + v * v, 0));
  if (norm < 1e-8) return avg;
  return avg.map(v => v / norm);
}

// ─── Re-exports (convenience) ────────────────────────────────────────────────

export { detectScript, normalizeArabic, getTransliterationVariants };
export { parseParameters } from "./parameterParser";
export type { ParsedParams } from "./parameterParser";

export type {
  QueryAST,
  QueryIntent,
  QueryExpansions,
  QueryEntities,
  QueryFilters,
  QueryTokens,
  ScriptAnalysis,
  Correction,
  ExtractedFilters,
} from "./types";

// ─── Pipeline Implementation (single path) ──────────────────────────────────

interface PipelineOpts {
  useLLM: boolean;
  useMLIntent: boolean;
}

async function runPipeline(raw: string, opts: PipelineOpts): Promise<QueryAST> {
  const t0 = performance.now();

  // Stage 0: Parameter extraction — strip control params, output searchText only
  const { searchText: pipelineInput, controlParams: controlParamsExtracted } = parseParameters(raw);

  // Stage 1: Cache (memory, then optional Redis — keys include LLM / ML-intent variant)
  const cached = getCachedQueryAST(raw, opts);
  if (cached) return { ...cached, cacheHit: true };

  if (isQueryAstRedisCacheEnabled()) {
    const fromRedis = await getQueryAstFromRedis(raw, opts, config.search.queryAstCacheLocale);
    if (fromRedis) {
      cacheQueryAST(raw, fromRedis, opts);
      return { ...fromRedis, cacheHit: true };
    }
  }

  // Stage 2: Normalize — protected spans (numbers, sizes) preserved
  const normalized = normalizeQuery(pipelineInput);

  // Stage 3: Script detection
  const script = detectScript(normalized);

  // Stage 4: Tokenize — input: pipelineInput + normalized
  const tokens = tokenize(pipelineInput, normalized);

  // Stage 5: Corrections — spell/arabizi/brand; numeric tokens skipped in spellCorrector
  const corrections = collectCorrections(normalized, script);

  // Stage 6: LLM rewrite (optional) — gated by shouldUseLLM, semantic validation
  let llmUsed = false;
  if (opts.useLLM) {
    const llmResult = await tryLLMRewrite(normalized, script, corrections);
    if (llmResult) {
      corrections.push(llmResult);
      llmUsed = true;
    }
  }

  // Stage 7: Build search query — only autoApply corrections affect retrieval
  const { searchQuery, appliedCorrections, suggestedCorrections } = buildSearchQuery(normalized, corrections);

  // Stage 8: Extract entities & filters — from corrected searchQuery only
  const extracted = extractFilters(searchQuery);
  mergeColorPhrasesFromAttributeRules(searchQuery, extracted);
  applyLLMEntities(corrections, extracted);
  const entities = toEntities(extracted);
  const filters  = toFilters(extracted);

  // Stage 9: Classify intent
  const intent = opts.useMLIntent
    ? await classifyIntentHybrid(normalized, entities)
    : classifyIntentRules(normalized, entities);

  // Stage 10: Expansions
  const expansions = generateExpansions(normalized, script, entities, corrections);

  // Stage 11: Confidence
  const confidence = corrections.length > 0
    ? corrections.reduce((s, c) => s + c.confidence, 0) / corrections.length
    : 1.0;

  const ast: QueryAST = {
    original: raw,
    normalized,
    tokens,
    entities,
    filters,
    intent,
    expansions,
    script,
    corrections,
    suggestedCorrections: suggestedCorrections.length > 0 ? suggestedCorrections : undefined,
    appliedCorrections: appliedCorrections.length > 0 ? appliedCorrections : undefined,
    controlParamsExtracted: Object.keys(controlParamsExtracted).length > 0 ? controlParamsExtracted : undefined,
    processingTimeMs: performance.now() - t0,
    llmUsed,
    cacheHit: false,
    confidence,
    searchQuery,
  };

  cacheQueryAST(raw, ast, opts);
  if (isQueryAstRedisCacheEnabled()) {
    void setQueryAstInRedis(
      raw,
      ast,
      opts,
      config.search.queryAstCacheLocale,
      config.search.queryAstRedisTtlSec,
    );
  }
  return ast;
}

// ─── Step helpers ────────────────────────────────────────────────────────────

/** Protected span patterns: numbers, sizes, percentages — do not corrupt during normalization */
const PROTECTED_PATTERNS = [
  /\d+(?:\.\d+)?%?/g,                    // 100, 10.5, 100%
  /size\s*[=:]?\s*\d+/gi,                // size 10, size=10
  /\d+\s*(?:us|uk|eu)\b/gi,              // 10 us, 42 uk
];

const PLACEHOLDER_PREFIX = "\uE000"; // Private-use char for placeholder
const PLACEHOLDER_SUFFIX = "\uE001";

/** Extract protected spans, replace with placeholders, normalize, then restore */
export function normalizeQuery(query: string): string {
  const preserved: string[] = [];
  let n = query;

  for (const re of PROTECTED_PATTERNS) {
    re.lastIndex = 0;
    n = n.replace(re, (m) => {
      preserved.push(m.toLowerCase());
      return `${PLACEHOLDER_PREFIX}${preserved.length - 1}${PLACEHOLDER_SUFFIX}`;
    });
  }

  n = n
    .toLowerCase()
    .trim()
    .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[^\w\s\u0600-\u06FF\u0750-\u077F'-]/g, " ")
    .replace(/(.)\1{2,}/g, "$1$1")
    .trim();

  if (/[\u0600-\u06FF]/.test(n)) n = normalizeArabic(n);

  for (let i = 0; i < preserved.length; i++) {
    n = n.replace(`${PLACEHOLDER_PREFIX}${i}${PLACEHOLDER_SUFFIX}`, preserved[i]);
  }

  return n.replace(/\s+/g, " ").trim();
}

/** Tokenize into several useful views */
function tokenize(raw: string, normalized: string): QueryTokens {
  const original   = raw.trim().split(/\s+/);
  const norm       = normalized.split(/\s+/);
  const important  = norm.filter(t => !STOPWORDS.has(t) && t.length > 2);
  const stops      = norm.filter(t => STOPWORDS.has(t));

  return { original, normalized: norm, stemmed: norm, important, stopwords: stops };
}

function tokenHasArabicScript(word: string): boolean {
  return /[\u0600-\u06FF\u0750-\u077F]/.test(word);
}

/** Gather all rule-based corrections (arabizi → eng, brand aliases, spell) */
function collectCorrections(normalized: string, script: ScriptAnalysis): Correction[] {
  const out: Correction[] = [];

  // Arabizi: run on Latin tokens. For mixed-script queries (e.g. "jeans" + Arabic),
  // still process Latin fragments that use Arabizi numerals or dictionary hits — not
  // only when the whole query is labeled arabizi (fixes ordering/gating gaps).
  const useArabiziOnLatinTokens =
    script.hasArabizi ||
    script.primary === "arabizi" ||
    script.primary === "mixed";

  if (useArabiziOnLatinTokens) {
    for (const word of normalized.split(/\s+/)) {
      if (!word || tokenHasArabicScript(word)) continue;
      const lw = word.toLowerCase();
      if (!/[a-z0-9]/i.test(lw)) continue;

      const fashion = expandFashionTerm(lw);
      if (fashion?.english && fashion.english !== lw) {
        out.push({
          original: word, corrected: fashion.english,
          source: "arabizi", confidence: 0.95, confidenceLevel: "high",
          alternatives: fashion.arabic ? [fashion.arabic] : undefined,
        });
        continue;
      }

      const tryDigitArabizi =
        script.primary === "arabizi" ||
        script.hasArabizi ||
        hasArabiziPattern(word) ||
        /[a-z]+[2-9]+[a-z]*/i.test(word) ||
        /[2-9]+[a-z]+/i.test(word);

      if (tryDigitArabizi) {
        const arabic = arabiziToArabic(lw);
        if (arabic !== lw) {
          out.push({
            original: word, corrected: arabic,
            source: "arabizi", confidence: 0.75, confidenceLevel: "medium",
          });
        }
      }
    }
  }

  // Brand aliases
  const dict = getDictionaries();
  for (const word of normalized.split(/\s+/)) {
    const entry = dict.brands.get(word.toLowerCase());
    if (entry && entry.term.toLowerCase() !== word.toLowerCase()) {
      out.push({
        original: word, corrected: entry.term,
        source: "brand_alias", confidence: 0.95, confidenceLevel: "high",
      });
    }
  }

  // Try multi-word common query match before per-word spell check
  // e.g. "whit pant" is close to "white pants" → correct both words
  const commonQueryHit = dict.commonQueries.get(normalized);
  if (commonQueryHit && commonQueryHit.term.toLowerCase() !== normalized) {
    out.push({
      original: normalized, corrected: commonQueryHit.term,
      source: "common_query", confidence: 0.92, confidenceLevel: "high",
    });
  }

  // Spell-check individual words (skip duplicates)
  const spellHits = correctQuery(normalized, {
    brands: dict.brands, categories: dict.categories,
    attributes: dict.attributes, commonQueries: dict.commonQueries,
  });
  const seen = new Set(out.map(c => c.original.toLowerCase()));
  for (const c of spellHits) {
    if (!seen.has(c.original.toLowerCase())) out.push(c);
  }

  return out;
}

const SEMANTIC_SIMILARITY_THRESHOLD = 0.75;

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom < 1e-10 ? 0 : dot / denom;
}

/** Attempt LLM rewrite; returns a Correction or null */
async function tryLLMRewrite(
  normalized: string,
  script: ScriptAnalysis,
  corrections: Correction[],
): Promise<Correction | null> {
  const avg = corrections.length > 0
    ? corrections.reduce((s, c) => s + c.confidence, 0) / corrections.length
    : 1.0;

  if (!shouldUseLLM(normalized, script, corrections.length > 0, avg)) return null;

  const result = await rewriteWithLLM({
    originalQuery: normalized,
    normalizedQuery: normalized,
    script,
    allowedBrands: getAllBrandNames(),
    allowedCategories: getAllCategoryNames(),
    allowedGenders: getAllGenders(),
  });

  if (!result || result.confidence < THRESHOLDS.llm) return null;

  // Optional semantic validation: reject if rewritten query drifts too far from original
  const embOriginal = await getQueryEmbedding(normalized);
  const embRewritten = await getQueryEmbedding(result.rewrittenQuery);
  if (embOriginal && embRewritten) {
    const sim = cosineSimilarity(embOriginal, embRewritten);
    if (sim < SEMANTIC_SIMILARITY_THRESHOLD) return null;
  }

  return {
    original: normalized,
    corrected: result.rewrittenQuery,
    source: "llm",
    confidence: result.confidence,
    confidenceLevel: confidenceToLevel(result.confidence),
    alternatives: [
      result.extractedBrand,
      result.extractedCategory,
      result.extractedGender,
    ].filter(Boolean) as string[],
  };
}

/**
 * Merge multi-word / hyphenated fashion colors from the same rule list as product titles
 * (e.g. "off-white dress", "navy blue jacket") into filters — complements per-token extractFilters.
 */
function mergeColorPhrasesFromAttributeRules(searchQuery: string, extracted: ExtractedFilters): void {
  const { attributes } = extractAttributesSync(searchQuery);
  const fromRules = attributes.colors?.length
    ? attributes.colors.map((c) => String(c).toLowerCase())
    : attributes.color
      ? [String(attributes.color).toLowerCase()]
      : [];
  if (fromRules.length === 0) return;
  if (!extracted.colors) extracted.colors = [];
  for (const c of fromRules) {
    if (!extracted.colors.includes(c)) extracted.colors.push(c);
  }
  if (!extracted.color) extracted.color = extracted.colors[0];
}

/** Extract gender / color / brand / category from the normalized text */
function extractFilters(query: string): ExtractedFilters {
  const f: ExtractedFilters = {};
  const dict = getDictionaries();
  const words = query.split(/\s+/);

  // Age group first so "girls dress" → kids, not women.
  if (/\b(baby|infant|newborn)\b/gi.test(query)) f.ageGroup = "baby";
  else if (/\b(toddler)\b/gi.test(query)) f.ageGroup = "kids";
  else if (/\b(teen|youth)\b/gi.test(query)) f.ageGroup = "teen";
  else if (/\b(kids?|children|child|boys?|girls?)\b/gi.test(query)) f.ageGroup = "kids";
  else if (/\b(أطفال|للأطفال)\b/g.test(query)) f.ageGroup = "kids";

  // Adult / unisex gender (do not map boys/girls to men/women — those are age signals)
  const genderRules: Array<{ pattern: RegExp; gender: string }> = [
    { pattern: /\b(mens?|male|men)\b/gi, gender: "men" },
    { pattern: /\b(womens?|female|ladies|lady|women)\b/gi, gender: "women" },
    { pattern: /\b(unisex|gender\s*neutral)\b/gi, gender: "unisex" },
    { pattern: /\b(رجالي|للرجال)\b/g, gender: "men" },
    { pattern: /\b(نسائي|للنساء|حريمي)\b/g, gender: "women" },
    { pattern: /\b(rijali|rejali)\b/gi, gender: "men" },
    { pattern: /\b(nisa2i|nisai|nisaei|7arimi)\b/gi, gender: "women" },
  ];
  for (const { pattern, gender } of genderRules) {
    if (pattern.test(query)) {
      f.gender = gender;
      break;
    }
  }

  // Color — try exact match first, then fuzzy match for typos
  const COLORS = new Set(["black","white","red","blue","green","yellow","pink","purple","orange","brown","gray","grey","beige","navy"]);
  const COLOR_TYPO_MAP: Record<string, string> = {
    blck: "black", blak: "black", balck: "black",
    whit: "white", wite: "white", whte: "white", whtie: "white",
    rd: "red", redd: "red",
    bleu: "blue", blu: "blue", bule: "blue",
    gren: "green", grean: "green", geen: "green",
    yelow: "yellow", yello: "yellow", yellw: "yellow",
    pnk: "pink", pnik: "pink",
    purpl: "purple", pruple: "purple",
    orenge: "orange", orang: "orange",
    brwn: "brown", brow: "brown",
    gry: "gray", grey: "gray", gery: "gray",
    bege: "beige", biege: "beige",
    navy: "navy", nawy: "navy",
    cream: "cream", creme: "cream",
    maroon: "maroon", maron: "maroon",
    teal: "teal",
    coral: "coral",
    ivory: "ivory",
    khaki: "khaki",
    burgundy: "burgundy",
  };

  const colorsFound: string[] = [];
  const addColor = (c: string) => {
    if (!colorsFound.includes(c)) colorsFound.push(c);
  };

  for (const word of words) {
    const lw = word.toLowerCase();
    if (COLORS.has(lw)) addColor(lw);
    else if (COLOR_TYPO_MAP[lw]) addColor(COLOR_TYPO_MAP[lw]);
  }

  // If no exact/typo match, check dictionary attributes
  if (colorsFound.length === 0) {
    for (const [, entry] of dict.attributes) {
      if (!entry.normalizedTerm || !COLORS.has(entry.normalizedTerm)) continue;

      for (const word of words) {
        const lw = word.toLowerCase();
        if (lw === entry.normalizedTerm) addColor(entry.term);
        else if (entry.aliases?.some(a => a.toLowerCase() === lw)) addColor(entry.term);
      }
    }
  }

  // Determine color conjunction mode for multi-color queries
  // - `or` => any color
  // - `and`/`+`/`with`/comma => all colors
  const hasOrConnector = /\bor\b/i.test(query);
  const hasAndConnector = /\band\b/i.test(query) || /\bwith\b/i.test(query) || query.includes("+");
  const hasCommaConnector = query.includes(",");
  if (colorsFound.length > 0) {
    f.colors = colorsFound;
    f.color = colorsFound[0]; // backward compat

    if (hasOrConnector) f.colorMode = "any";
    else if (colorsFound.length > 1 && (hasAndConnector || hasCommaConnector)) f.colorMode = "all";
    else if (colorsFound.length > 1) f.colorMode = "any";
  }

  // Product-type detection (specific garment tokens)
  // This is used later for strict filtering (Phase 2).
  const PRODUCT_TYPE_SINGLE: Record<string, string> = {
    // Common typos
    hoodi: "hoodie",
    joggin: "joggers",

    hoodie: "hoodie",
    hoodies: "hoodie",
    sweatshirts: "hoodie",
    sweatshirt: "hoodie",
    "hooded": "hoodie",

    jogger: "joggers",
    joggers: "joggers",
    jogging: "joggers",
    "track": "joggers", // fallback for "track pants"

    jeans: "jeans",
    jean: "jeans",
    denim: "jeans",
    denims: "jeans",

    tshirt: "tshirt",
    "t-shirt": "tshirt",
    tee: "tshirt",
    tees: "tshirt",

    pants: "pants",
    pant: "pants",
    trouser: "pants",
    trousers: "pants",

    leggings: "leggings",
    legging: "leggings",

    shorts: "shorts",
    short: "shorts",

    blazer: "blazer",
    blazers: "blazer",
    sweater: "sweater",
    sweaters: "sweater",
    top: "top",
    tops: "tops",
    shirt: "tshirt",
    shirts: "tshirt",
    blouse: "tshirt",
    blouses: "tshirt",
    camisole: "tshirt",
    tunic: "tshirt",

    abaya: "abaya",
    abayas: "abaya",
    kaftan: "kaftan",
    kaftans: "kaftan",
    caftan: "kaftan",
    caftans: "kaftan",
    jalabiya: "abaya",
    thobe: "abaya",
    thobes: "abaya",
    dishdasha: "abaya",
    bisht: "abaya",
  };

  const PRODUCT_TYPE_MULTI: Record<string, string> = {
    "hooded sweatshirt": "hoodie",
    "pullover hoodie": "hoodie",
    "jogging pants": "joggers",
    "track pants": "joggers",
    "sweat pants": "joggers",
    "sweatpants": "joggers",
    "maxi abaya": "abaya",
    "open abaya": "abaya",
  };

  const productTypesFound: string[] = [];
  const addProductType = (t: string) => {
    if (!productTypesFound.includes(t)) productTypesFound.push(t);
  };

  for (const word of words) {
    const lw = word.toLowerCase();
    const mapped = PRODUCT_TYPE_SINGLE[lw];
    if (mapped) addProductType(mapped);
  }

  // Multi-word tokens (bigrams) like "jogging pants", "hooded sweatshirt"
  for (let i = 0; i < words.length - 1; i++) {
    const twoWord = `${words[i]} ${words[i + 1]}`.toLowerCase();
    const mapped = PRODUCT_TYPE_MULTI[twoWord];
    if (mapped) addProductType(mapped);
  }

  if (productTypesFound.length > 0) f.productTypes = productTypesFound;

  // Brand — check single words and also multi-word combinations
  for (const word of words) {
    const brand = findBrand(word);
    if (brand) { f.brand = brand.term; break; }
  }
  if (!f.brand && words.length >= 2) {
    for (let i = 0; i < words.length - 1; i++) {
      const twoWord = `${words[i]} ${words[i + 1]}`;
      const brand = findBrand(twoWord);
      if (brand) { f.brand = brand.term; break; }
    }
  }

  // Category — check single words, then two-word combos
  for (const word of words) {
    const cat = findCategory(word);
    if (cat) { f.category = cat.term; break; }
  }
  if (!f.category && words.length >= 2) {
    for (let i = 0; i < words.length - 1; i++) {
      const twoWord = `${words[i]} ${words[i + 1]}`;
      const cat = findCategory(twoWord);
      if (cat) { f.category = cat.term; break; }
    }
  }

  // Fallback: try matching words to common product types even if not in dictionary
  if (!f.category) {
    const PRODUCT_TYPE_TO_CATEGORY: Record<string, string> = {
      pant: "bottoms", pants: "bottoms", trouser: "bottoms", trousers: "bottoms",
      jean: "bottoms", jeans: "bottoms", chino: "bottoms", chinos: "bottoms",
      jogger: "joggers", joggers: "joggers", jogging: "joggers",
      legging: "bottoms", leggings: "bottoms",
      short: "bottoms", shorts: "bottoms", skirt: "bottoms", skirts: "bottoms",
      shirt: "tops", shirts: "tops", tee: "tops", tshirt: "tops", blouse: "tops",
      top: "tops", tops: "tops", polo: "tops", sweater: "tops", hoodie: "tops",
      sweatshirt: "tops", tank: "tops", tunic: "tops", pullover: "tops",
      dress: "dresses", dresses: "dresses", gown: "dresses", frock: "dresses",
      jumpsuit: "dresses", romper: "dresses",
      abaya: "dresses", abayas: "dresses", kaftan: "dresses", kaftans: "dresses",
      caftan: "dresses", jalabiya: "dresses", thobe: "dresses", thobes: "dresses",
      dishdasha: "dresses", bisht: "dresses",
      jacket: "outerwear", jackets: "outerwear", coat: "outerwear", coats: "outerwear",
      cardigan: "outerwear",
      parka: "outerwear", windbreaker: "outerwear",
      shoe: "footwear", shoes: "footwear", sneaker: "footwear", sneakers: "footwear",
      boot: "footwear", boots: "footwear", sandal: "footwear", sandals: "footwear",
      heel: "footwear", heels: "footwear", loafer: "footwear", loafers: "footwear",
      trainer: "footwear", trainers: "footwear",
      bag: "accessories", bags: "accessories", belt: "accessories", belts: "accessories",
      hat: "accessories", hats: "accessories", cap: "accessories",
      watch: "accessories", watches: "accessories", wallet: "accessories",
      scarf: "accessories", sunglasses: "accessories",
    };
    for (const word of words) {
      const cat = PRODUCT_TYPE_TO_CATEGORY[word.toLowerCase()];
      if (cat) { f.category = cat; break; }
    }
  }

  return f;
}

/** If the LLM correction carried extracted entities, merge them into filters */
function applyLLMEntities(corrections: Correction[], filters: ExtractedFilters): void {
  const llm = corrections.find(c => c.source === "llm");
  if (!llm?.alternatives?.length) return;

  const [brand, category, gender] = llm.alternatives;
  if (brand)    filters.brand    = brand;
  if (category) filters.category = category;
  if (gender)   filters.gender   = gender;
}

/** Convert flat ExtractedFilters → structured QueryEntities */
function toEntities(f: ExtractedFilters): QueryEntities {
  return {
    brands:     f.brand    ? [f.brand]    : [],
    categories: f.category ? [f.category] : [],
    colors:     f.colors && f.colors.length > 0 ? f.colors : (f.color ? [f.color] : []),
    productTypes: f.productTypes ? [...f.productTypes] : [],
    materials:  f.material ? [f.material] : [],
    patterns:   [],
    sizes:      [],
    gender:     f.gender,
    ageGroup:   f.ageGroup,
  };
}

/** Convert flat ExtractedFilters → structured QueryFilters */
function toFilters(f: ExtractedFilters): QueryFilters {
  return {
    priceRange: f.priceRange,
    brand:      f.brand    ? [f.brand]    : undefined,
    category:   f.category ? [f.category] : undefined,
    color:      f.colors && f.colors.length > 0 ? [...f.colors] : (f.color ? [f.color] : undefined),
    colorMode:  f.colorMode,
    material:   f.material ? [f.material] : undefined,
    gender:     f.gender,
    ageGroup:   f.ageGroup,
  };
}

export interface BuildSearchQueryResult {
  searchQuery: string;
  appliedCorrections: Correction[];
  suggestedCorrections: Correction[];
}

/** Apply only high-confidence corrections; medium confidence → suggest only. */
function buildSearchQuery(normalized: string, corrections: Correction[]): BuildSearchQueryResult {
  const applied: Correction[] = [];
  const suggested: Correction[] = [];

  for (const c of corrections) {
    if (c.confidence >= THRESHOLDS.autoApply) {
      applied.push(c);
    } else if (c.confidence >= THRESHOLDS.suggest) {
      suggested.push(c);
    }
    // confidence < suggest: reject, do not apply or suggest
  }

  let q = normalized;

  // LLM: only apply when confidence >= autoApply
  const llm = applied.find(c => c.source === "llm");
  if (llm) {
    const result = llm.corrected.replace(/\s+/g, " ").trim();
    return {
      searchQuery: result || normalized,
      appliedCorrections: [llm],
      suggestedCorrections: suggested.filter(c => c !== llm),
    };
  }

  for (const c of applied) {
    if (c.source !== "llm") {
      q = q.replace(new RegExp(`\\b${escapeRegex(c.original)}\\b`, "gi"), c.corrected);
    }
  }

  // If corrections rewrote all words and lost meaning, fall back to normalized
  const result = q.replace(/\s+/g, " ").trim();
  return {
    searchQuery: result || normalized,
    appliedCorrections: applied,
    suggestedCorrections: suggested,
  };
}

// ─── Intent mapping ──────────────────────────────────────────────────────────

function mapIntentResult(
  raw: { type: string; confidence: "high" | "medium" | "low"; source?: string },
  entities: QueryEntities,
): QueryIntent {
  let type: QueryIntent["type"];
  let desc: string;

  switch (raw.type) {
    case "price_search":      type = "filter";      desc = "Price-constrained search";   break;
    case "comparison":        type = "comparison";   desc = "Product / brand comparison"; break;
    case "brand_search":      type = "exploration";  desc = "Brand exploration";          break;
    case "outfit_completion": type = "completion";   desc = "Outfit completion";          break;
    case "trending_search":   type = "exploration";  desc = "Trending / popular items";   break;
    case "product_search":
      if (entities.gender || entities.ageGroup || entities.colors.length || entities.categories.length) {
        type = "filter"; desc = "Filtered product search";
      } else {
        type = "search"; desc = "General product search";
      }
      break;
    default:
      type = "search"; desc = "Standard search";
  }

  return {
    type,
    confidence: getConfidenceScore(raw.confidence),
    description: `${desc} (${raw.source ?? "rules"})`,
  };
}

function classifyIntentRules(query: string, entities: QueryEntities): QueryIntent {
  const result = classifyQueryIntent(query, getAllBrandNames());
  return mapIntentResult(result, entities);
}

async function classifyIntentHybrid(query: string, entities: QueryEntities): Promise<QueryIntent> {
  const result = await classifyQueryIntentHybrid(query, getAllBrandNames(), true);
  return mapIntentResult(result, entities);
}

// ─── Expansions ──────────────────────────────────────────────────────────────

const CATEGORY_SYNONYMS: Record<string, string[]> = {
  shirt: ["top", "blouse", "tee", "t-shirt", "polo", "henley"],
  dress: ["gown", "frock", "outfit", "maxi", "midi", "sundress"],
  pants: ["trousers", "jeans", "bottoms", "chinos", "slacks"],
  pant: ["pants", "trousers", "bottoms", "jeans"],
  trouser: ["pants", "trousers", "slacks", "bottoms"],
  trousers: ["pants", "trouser", "slacks", "bottoms"],
  jeans: ["denim", "denims", "pants", "bottoms"],
  jean: ["jeans", "denim", "pants"],
  joggers: ["jogging pants", "track pants", "jogging", "sweatpants"],
  jogger: ["joggers", "jogging pants", "track pants"],
  jogging: ["joggers", "jogging pants", "track pants", "sweatpants"],
  shorts: ["short pants", "bermudas", "board shorts"],
  skirt: ["mini skirt", "maxi skirt", "pencil skirt"],
  shoes: ["footwear", "sneakers", "boots", "trainers"],
  shoe: ["shoes", "footwear", "sneakers"],
  sneakers: ["trainers", "athletic shoes", "kicks", "shoes"],
  sneaker: ["sneakers", "trainers", "shoes"],
  boots: ["boot", "ankle boots", "knee boots", "combat boots"],
  bag: ["handbag", "purse", "tote", "backpack", "clutch"],
  jacket: ["coat", "outerwear", "bomber"],
  coat: ["jacket", "outerwear", "parka", "trench"],
  hoodie: ["hooded sweatshirt", "pullover hoodie", "sweatshirt"],
  sweater: ["pullover", "jumper", "knitwear", "cardigan"],
  top: ["shirt", "blouse", "tee", "tank top"],
  tops: ["shirts", "blouses", "tees", "t-shirts"],
  bottoms: ["pants", "trousers", "jeans", "skirts", "shorts"],
  leggings: ["tights", "yoga pants", "stretch pants"],
  sandals: ["slides", "flip flops", "open-toe"],
  heels: ["pumps", "stilettos", "high heels"],
};

function generateExpansions(
  query: string, script: ScriptAnalysis,
  entities: QueryEntities, corrections: Correction[],
): QueryExpansions {
  const exp: QueryExpansions = {
    synonyms: [],
    transliterations: (script.hasArabic || script.hasArabizi) ? getTransliterationVariants(query) : [],
    brandAliases: [],
    categoryExpansions: [],
    corrections: corrections.map(c => c.corrected),
  };

  const dict = getDictionaries();
  for (const brand of entities.brands) {
    const entry = dict.brands.get(brand.toLowerCase());
    if (entry?.aliases) exp.brandAliases.push(...entry.aliases);
  }

  for (const cat of entities.categories) {
    const syns = CATEGORY_SYNONYMS[cat.toLowerCase()];
    if (syns) exp.categoryExpansions.push(...syns);
  }

  // Also expand individual query words through CATEGORY_SYNONYMS
  // This catches product-type words that weren't extracted as entities
  const words = query.split(/\s+/).filter(w => !STOPWORDS.has(w));
  for (const word of words) {
    const syns = CATEGORY_SYNONYMS[word.toLowerCase()];
    if (syns) {
      for (const s of syns) {
        if (!exp.categoryExpansions.includes(s) && !exp.synonyms.includes(s)) {
          exp.synonyms.push(s);
        }
      }
    }
  }

  return exp;
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

