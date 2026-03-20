/**
 * Category taxonomy aliases + vocabulary-backed OpenSearch filters.
 */
import type { QueryAST } from "../queryProcessor/types";
import { pg } from "../core";

/** Canonical aisle → search terms (aligned with queryProcessor dictionary). */
const CATEGORY_ALIASES: Record<string, string[]> = {
  tops: [
    "tops",
    "top",
    "shirts",
    "shirt",
    "blouse",
    "blouses",
    "tshirt",
    "t-shirt",
    "tee",
    "tank top",
    "polo",
    "henley",
    "tunic",
    "crop top",
    "camisole",
    "sweater",
    "pullover",
    "hoodie",
    "sweatshirt",
  ],
  bottoms: [
    "bottoms",
    "bottom",
    "pants",
    "pant",
    "trousers",
    "jeans",
    "jean",
    "chinos",
    "leggings",
    "shorts",
    "short",
    "skirt",
    "skirts",
    "culottes",
    "cargo pants",
    "sweatpants",
  ],
  joggers: ["joggers", "jogger", "jogging", "jogging pants", "track pants", "trackpants", "jogging bottoms"],
  dresses: ["dresses", "dress", "gown", "frock", "maxi dress", "mini dress", "midi dress", "sundress", "jumpsuit", "romper"],
  outerwear: [
    "outerwear",
    "jacket",
    "jackets",
    "coat",
    "coats",
    "blazer",
    "blazers",
    "cardigan",
    "cardigans",
    "parka",
    "windbreaker",
    "vest",
    "gilet",
    "poncho",
    "cape",
    "trench",
  ],
  footwear: [
    "footwear",
    "shoes",
    "shoe",
    "sneakers",
    "sneaker",
    "boots",
    "boot",
    "sandals",
    "sandal",
    "heels",
    "heel",
    "loafers",
    "loafer",
    "flats",
    "flat",
    "mules",
    "slides",
    "slippers",
    "pumps",
    "oxfords",
    "trainers",
  ],
  accessories: [
    "accessories",
    "accessory",
    "bag",
    "bags",
    "belt",
    "belts",
    "hat",
    "hats",
    "cap",
    "watch",
    "watches",
    "scarf",
    "scarves",
    "sunglasses",
    "jewelry",
    "bracelet",
    "necklace",
    "earrings",
    "wallet",
    "purse",
    "handbag",
    "tote",
    "backpack",
    "clutch",
  ],
  activewear: [
    "activewear",
    "sportswear",
    "athletic",
    "gym",
    "workout",
    "running",
    "yoga",
    "training",
    "sports bra",
    "track pants",
    "performance",
  ],
  swimwear: [
    "swimwear",
    "swim",
    "swimming",
    "bikini",
    "swimsuit",
    "swim trunks",
    "one piece",
    "two piece",
    "beach wear",
    "board shorts",
  ],
  underwear: ["underwear", "lingerie", "undergarments", "innerwear", "boxers", "briefs", "bra", "panties", "thong", "undershirt"],
};

/**
 * All search terms for a category (canonical name + aliases).
 */
export function getCategorySearchTerms(category: string): string[] {
  const key = category.toLowerCase();
  if (CATEGORY_ALIASES[key]) return [...CATEGORY_ALIASES[key]];

  for (const [cat, aliases] of Object.entries(CATEGORY_ALIASES)) {
    if (aliases.includes(key)) return [...CATEGORY_ALIASES[cat]];
  }

  return [key];
}

let vocabCache: { at: number; set: Set<string> } | null = null;
const VOCAB_TTL_MS = 5 * 60 * 1000;

/** Distinct lowercased categories from DB (refresh every 5m). */
export async function loadCategoryVocabulary(): Promise<Set<string>> {
  if (vocabCache && Date.now() - vocabCache.at < VOCAB_TTL_MS) {
    return vocabCache.set;
  }
  const r = await pg.query(
    `SELECT DISTINCT LOWER(TRIM(category)) AS c FROM products WHERE category IS NOT NULL AND TRIM(category) <> ''`,
  );
  const set = new Set<string>();
  for (const row of r.rows) {
    if (row.c) set.add(String(row.c));
  }
  vocabCache = { at: Date.now(), set };
  return set;
}

/**
 * Terms to use in OpenSearch `terms` filter: prefer labels that exist in the catalog.
 */
export function resolveCategoryTermsForOpensearch(canonicalCategory: string, vocab: Set<string>): string[] {
  const aliases = getCategorySearchTerms(canonicalCategory).map((t) => t.toLowerCase());
  const inVocab = aliases.filter((a) => vocab.has(a));
  return inVocab.length > 0 ? inVocab : aliases;
}

function strictCategoryEnv(): boolean {
  const v = String(process.env.SEARCH_STRICT_CATEGORY_DEFAULT ?? "").toLowerCase();
  return v === "1" || v === "true";
}

/** True when the query is primarily an aisle / category browse (precision filter). */
export function isCategoryDominantQuery(ast: QueryAST, rawQuery: string): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return false;
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length > 2) return false;
  if (ast.entities.brands.length > 0) return false;
  if (ast.entities.categories.length === 0) return false;
  if (ast.entities.productTypes && ast.entities.productTypes.length > 0) return false;

  const primaryCat = ast.entities.categories[0];
  if (!primaryCat) return false;
  const aliasSet = new Set(getCategorySearchTerms(primaryCat).map((t) => t.toLowerCase()));

  for (const w of words) {
    if (aliasSet.has(w)) return true;
  }
  if (words.length === 1 && words[0] === primaryCat.toLowerCase()) return true;
  return false;
}

/**
 * Short, product-type-focused queries (e.g. "jeans", "hoodie", "white sneakers") where the
 * intent is lexical/type browse. Hybrid search must NOT require CLIP agreement in `must`:
 * image embeddings and text embeddings for "jeans" are poorly aligned for many valid products,
 * which collapses recall vs BM25 + DB category matches.
 */
export function isProductTypeDominantQuery(ast: QueryAST, rawQuery: string): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return false;
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length > 2) return false;
  if (ast.entities.brands.length > 0) return false;
  const pts = ast.entities.productTypes;
  if (!pts || pts.length === 0) return false;
  return true;
}

/**
 * Use hard category filter (AST) when caller did not pin category and either env strict mode
 * or heuristics say the query is category-dominant.
 */
export function shouldHardFilterAstCategory(
  ast: QueryAST,
  rawQuery: string,
  callerCategory: string | undefined,
  mergedCategory: string | undefined,
  hasProductTypeConstraint: boolean,
): boolean {
  if (callerCategory || !mergedCategory) return false;
  if (hasProductTypeConstraint) return false;
  if (strictCategoryEnv()) return true;
  return isCategoryDominantQuery(ast, rawQuery);
}

/**
 * Map vendor listing category + title hints to a canonical aisle label for filtering.
 */
export function inferCategoryCanonical(rawCategory: string | null | undefined, title: string): string | null {
  const cat = rawCategory ? String(rawCategory).toLowerCase().trim() : "";
  for (const [key, aliases] of Object.entries(CATEGORY_ALIASES)) {
    if (cat === key) return key;
    if (cat && aliases.some((a) => a === cat)) return key;
  }
  const norm = (title || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (norm) {
    for (const [key, aliases] of Object.entries(CATEGORY_ALIASES)) {
      for (const a of aliases) {
        if (a.length > 2 && norm.split(/\s+/).includes(a)) return key;
        if (a.length > 3 && norm.includes(a)) return key;
      }
    }
  }
  return cat || null;
}
