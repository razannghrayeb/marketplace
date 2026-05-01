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
    "t-shirts",
    "tee",
    "tank top",
    "tank-top",
    "tank-tops",
    "polo",
    "henley",
    "tunic",
    "crop top",
    "camisole",
    "sweater",
    "sweaters",
    "pullover",
    "hoodie",
    "hoodies",
    "sweatshirt",
    "sweatshirts",
    "cardigan",
    "cardigans",
    "knitwear",
    "overshirt",
    "overshirts",
    "bodysuit",
    "bodysuits",
    "jersey",
    "loungewear",
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
  dresses: [
    "dresses",
    "dress",
    "midi-dresses",
    "midi-dress",
    "midi dress",
    "maxi-dresses",
    "maxi-dress",
    "maxi dress",
    "mini-dresses",
    "mini-dress",
    "mini dress",
    "gown",
    "gowns",
    "frock",
    "sundress",
    "jumpsuit",
    "jumpsuits",
    "romper",
    "rompers",
    "abaya",
    "abayas",
    "kaftan",
    "kaftans",
    "jalabiya",
    "thobe",
  ],
  outerwear: [
    "outerwear",
    "jacket",
    "jackets",
    "coat",
    "coats",
    "blazer",
    "blazers",
    "sport coat",
    "sport coats",
    "sportcoat",
    "suit jacket",
    "suit jackets",
    "dress jacket",
    "dress jackets",
    "suit",
    "suits",
    "tuxedo",
    "tuxedos",
    "cardigan",
    "cardigans",
    "parka",
    "parkas",
    "windbreaker",
    "windbreakers",
    "vest",
    "vests",
    "gilet",
    "gilets",
    "waistcoat",
    "waistcoats",
    "bomber",
    "bombers",
    "anorak",
    "anoraks",
    "poncho",
    "ponchos",
    "cape",
    "capes",
    "trench",
    "trenches",
    "overcoat",
    "overcoats",
    "shacket",
    "shackets",
    "shirt jacket",
    "shirt jackets",
  ],
  footwear: [
    "footwear",
    "shoes",
    "shoe",
    "sneakers",
    "sneaker",
    "trainers",
    "trainer",
    "running shoes",
    "running shoe",
    "athletic shoes",
    "athletic shoe",
    "tennis shoes",
    "tennis shoe",
    "boots",
    "boot",
    "ankle boots",
    "ankle boot",
    "chelsea boots",
    "chelsea boot",
    "sandals",
    "sandal",
    "heels",
    "heel",
    "pumps",
    "pump",
    "stilettos",
    "stiletto",
    "loafers",
    "loafer",
    "moccasins",
    "moccasin",
    "flats",
    "flat",
    "mules",
    "mule",
    "slides",
    "slide",
    "slippers",
    "slipper",
    "oxfords",
    "oxford",
    "derbies",
    "derby",
    "brogues",
    "brogue",
    "clogs",
    "clog",
    "espadrilles",
    "espadrille",
    "dress shoes",
    "dress shoe",
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
  bags: [
    "bags",
    "bag",
    "handbag",
    "handbags",
    "wallet",
    "wallets",
    "purse",
    "purses",
    "tote",
    "totes",
    "backpack",
    "backpacks",
    "crossbody",
    "satchel",
    "satchels",
    "clutch",
    "clutches",
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
  /** Skincare / color cosmetics — not apparel; blocks spurious high CLIP scores vs dress/shoe queries */
  beauty: [
    "beauty",
    "makeup",
    "cosmetics",
    "cosmetic",
    "concealer",
    "concealers",
    "foundation",
    "lipstick",
    "lipsticks",
    "mascara",
    "eyeliner",
    "eyeshadow",
    "blush",
    "bronzer",
    "primer",
    "highlighter",
    "skincare",
    "serum",
    "moisturizer",
    "cleanser",
    "toner",
    "sunscreen",
    "perfume",
    "fragrance",
    "cologne",
    "nail polish",
    "nail care",
    "nails",
    "bath & body",
    "body care",
  ],
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

function filterHardMinAstConfidence(): number {
  const n = Number(process.env.SEARCH_FILTER_HARD_MIN_CONFIDENCE ?? "0.55");
  return Number.isFinite(n) ? Math.min(0.95, Math.max(0.35, n)) : 0.55;
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
 *
 * When `SEARCH_STRICT_CATEGORY_DEFAULT=1`, any merged AST category becomes a hard filter
 * (unless caller pinned category or a product-type constraint blocks it) — not only
 * category-dominant queries. Prefer leaving the env off unless you want that behavior.
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
  if (!isCategoryDominantQuery(ast, rawQuery)) return false;
  return ast.confidence >= filterHardMinAstConfidence();
}

/**
 * Map vendor listing category + title hints to a canonical aisle label for filtering.
 */
/**
 * True when indexed `category` / `category_canonical` indicates beauty (makeup/skincare/fragrance),
 * so ranking can penalize vs garment/footwear image intent even when `product_types` is empty.
 */
export function isBeautyRetailListingFromFields(
  category: unknown,
  categoryCanonical: unknown,
): boolean {
  const cc = categoryCanonical != null ? String(categoryCanonical).toLowerCase().trim() : "";
  if (cc === "beauty") return true;
  const beautyAliases = getCategorySearchTerms("beauty").map((t) => t.toLowerCase());
  if (cc && beautyAliases.includes(cc)) return true;

  const cat = category != null ? String(category).toLowerCase().trim() : "";
  if (!cat) return false;
  if (beautyAliases.includes(cat)) return true;
  return /\b(concealer|foundation|lipstick|mascara|cosmetic|makeup|skincare|serum|perfume|fragrance|moisturizer|cleanser|bronzer|blush|eyeshadow|primer|highlighter|eyeliner|sunscreen|nail\s*polish)\b/i.test(
    cat,
  );
}

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
    // Resolve high-signal garment classes first to avoid ambiguous alias collisions
    // like "short jacket" being mapped to bottoms due the token "short".
    if (/\b(jacket|jackets|coat|coats|blazer|blazers|suit|suits|tuxedo|tuxedos|cardigan|cardigans|parka|parkas|windbreaker|windbreakers|vest|vests|gilet|gilets|waistcoat|waistcoats|trench|trenches|overcoat|overcoats|bomber|bombers|anorak|anoraks|poncho|ponchos|cape|capes|shacket|shackets|shirt\s+jackets?|overshirt|overshirts)\b/.test(norm)) {
      return "outerwear";
    }
    if (/\b(dress|dresses|gown|frock|maxi dress|mini dress|midi dress|sundress|jumpsuit|romper|abaya|kaftan|jalabiya|thobe)\b/.test(norm)) {
      return "dresses";
    }
    if (/\b(shoes?|sneakers?|boots?|sandals?|heels?|loafers?|flats?|mules?|slides?|slippers?|pumps?|oxfords?|trainers?|derbies|derby|brogues?|clogs?|espadrilles?|stilettos?|moccasins?)\b/.test(norm)) {
      return "footwear";
    }
    if (/\b(shorts|bermuda|bermudas|cargo shorts|denim shorts|jeans|trousers|pants|chinos|leggings|skirt|skirts|culottes|sweatpants)\b/.test(norm)) {
      return "bottoms";
    }
    const hasTopAccessoryPhrase = /\btop(?:\s|-)+(handle|zip|zipper|stitch|stitching|coat|bag|satchel|clutch|pouch|wallet|case|cover|closure)\b/.test(norm);
    if (!hasTopAccessoryPhrase && /\b(top|tops|shirt|shirts|blouse|blouses|tshirt|t-shirt|tee|tank top|polo|henley|tunic|crop top|camisole|sweater|pullover|hoodie|sweatshirt)\b/.test(norm)) {
      return "tops";
    }

    const tokens = new Set(norm.split(/\s+/));
    for (const [key, aliases] of Object.entries(CATEGORY_ALIASES)) {
      for (const a of aliases) {
        // Ambiguous single token; do not classify bottoms by "short" alone.
        if (a === "short") continue;
        if (a.length > 2 && tokens.has(a)) return key;
        if (a.length > 3 && norm.includes(a)) return key;
      }
    }
  }
  return cat || null;
}
