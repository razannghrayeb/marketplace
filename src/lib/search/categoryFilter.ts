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
    "basic top",
    "lefon top",
    "penti top",
    "women top",
    "shirts",
    "shirt",
    "shirt-cl",
    "shirt-ln",
    "shirt-ni",
    "shirt-ox",
    "shirt-sp",
    "shirts & tops",
    "shirts men",
    "shirt men",
    "shirting",
    "woven shirts",
    "woven tops",
    "sw.shirt",
    "trendeyol shirt",
    "trendyol shirt",
    "women shirt",
    "men shirt",
    "blouse",
    "blouses",
    "trendeyol blouse",
    "trendyol blouse",
    "women blouse",
    "tshirt",
    "t-shirt",
    "t- shirt",
    "t-shirts",
    "t-shirt-bos",
    "tee shirt",
    "tee",
    "trendeyol t",
    "trendyol t",
    "tank top",
    "tank-top",
    "tank-tops",
    "tank",
    "tanks",
    "polo",
    "polos",
    "polo shirt",
    "polo shirts",
    "polo long sleeve",
    "polo short sleeve",
    "men polo",
    "henley",
    "tunic",
    "crop top",
    "camisole",
    "sweater",
    "sweaters",
    "men sweater",
    "women sweater",
    "pullover",
    "pullovers",
    "men pullover",
    "men pulover",
    "women pullover",
    "women pulover",
    "hoodie",
    "hoodies",
    "hoody",
    "men hoodie",
    "sweatshirt",
    "sweatshirts",
    "cardigan",
    "cardigans",
    "women cardigan",
    "knitwear",
    "knit tops",
    "knit top",
    "overshirt",
    "overshirts",
    "bodysuit",
    "bodysuits",
    "bodies",
    "body suit",
    "body",
    "baselayer",
    "long sleeve",
    "sleeveless",
    "track top",
    "jersey",
    "loungewear",
    "rugby shirts",
  ],
  bottoms: [
    "bottoms",
    "bottom",
    "bottom-sw",
    "pants",
    "pant",
    "3/4 pant",
    "pant-cl",
    "pant-ln",
    "pant-sp",
    "lefon pant",
    "men pant",
    "women pant",
    "trendeyol pant",
    "trendyol pant",
    "trousers",
    "tracksuits & track trousers",
    "jeans",
    "jean",
    "denim",
    "men jeans",
    "chinos",
    "chino",
    "leggings",
    "legging",
    "3/4 tight",
    "7/8 tight",
    "tight",
    "tights",
    "penti legging",
    "trendeyol legging",
    "trendyol legging",
    "shorts",
    "short",
    "bermudas",
    "trendeyol short",
    "trendyol short",
    "skirt",
    "skirts",
    "skort",
    "skorts",
    "women skirt",
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
    "jilbab",
    "kimono",
    "kaftan",
    "kaftans",
    "jalabiya",
    "thobe",
    "babydoll",
    "dress/top",
    "trendeyol dress",
    "trendyol dress",
    "women dress",
    "jumpplaysuits",
    "playsuits",
  ],
  outerwear: [
    "outerwear",
    "outwear",
    "outerwear & jackets",
    "jacket",
    "jackets",
    "jacket-sp",
    "sw.jacket",
    "denim jacket",
    "men jacket",
    "women jacket",
    "coat",
    "coats",
    "coats & jackets",
    "men coat",
    "women coat",
    "blazer",
    "blazers",
    "lefon blazer",
    "men blazer",
    "women blazer",
    "sport coat",
    "sport coats",
    "sportcoat",
    "tuxedo",
    "tuxedos",
    "cardigan",
    "cardigans",
    "parka",
    "parkas",
    "parkas & blousons",
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
  tailored: [
    "tailored",
    "suit",
    "suits",
    "tuxedo",
    "tuxedos",
    "suit jacket",
    "suit jackets",
    "dress jacket",
    "dress jackets",
    "waistcoat",
    "waistcoats",
    "vest",
    "vests",
    "gilet",
    "gilets",
    "structured jacket",
    "structured jackets",
    "tailored jacket",
    "tailored jackets",
  ],
  footwear: [
    "footwear",
    "shoes",
    "shoe",
    "aqua shoes",
    "boat shoes",
    "dress shoes",
    "snow shoes",
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
    "after ski boot",
    "ski boots",
    "snowboard boots",
    "men boots",
    "women boot",
    "ankle boots",
    "ankle boot",
    "chelsea boots",
    "chelsea boot",
    "sandals",
    "sandal",
    "flat sandals",
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
    "flats + other",
    "ballerina",
    "ballerinas",
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
    "hikers",
    "dress shoes",
    "dress shoe",
    "shoes-cl",
    "shoes-sp",
    "women shoes",
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
    "baby bags",
    "bag accessories",
    "bags cases and luggage",
    "bags women",
    "women bags",
    "handbag",
    "handbags",
    "hand bags",
    "top handle bags",
    "shoulder bags",
    "crossover bags",
    "crossbody bags",
    "messenger bag",
    "reporter bags",
    "shopping bags",
    "phone bags",
    "laptop bags",
    "computer bags",
    "toiletry bags",
    "toilet kits",
    "lunch bags",
    "gym bags",
    "travel bags",
    "garment bag",
    "duffle bags",
    "beach totes",
    "tote bags",
    "foldable bags",
    "bucket bags",
    "waist bags",
    "bumbag",
    "vanity pouches",
    "wallet",
    "wallets",
    "purse",
    "purses",
    "tote",
    "totes",
    "backpack",
    "backpacks",
    "crossbody",
    "crossbody bag",
    "satchel",
    "satchels",
    "clutch",
    "clutches",
    "pouches",
    "briefcases",
    "cabin suitcases",
    "cabin trolley cases",
    "trolley cases",
    "trolley school bags",
    "large luggages",
    "medium luggages",
    "x-large luggage",
    "luggage",
    "carry on",
    "weekender",
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
    "swim short",
    "swim tight",
    "swimming set",
    "bikini set",
    "monokini",
    "rashguard",
    "bottom-sw",
  ],
  underwear: [
    "underwear",
    "lingerie",
    "undergarments",
    "innerwear",
    "boxers",
    "boxer-2p",
    "briefs",
    "bra",
    "bras",
    "women's bra",
    "underwear bra",
    "minimizer bra",
    "bustier",
    "panties",
    "thong",
    "thong-3p",
    "hipster",
    "hipster-3lu",
    "hipster-3p",
    "brazilian",
    "string",
    "strings",
    "footsie",
    "footcover-4lu",
    "undershirt",
  ],
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
    "blushes",
    "bronzers",
    "bronzing powder",
    "brow gel",
    "brow pencils",
    "brows",
    "brushes",
    "clear brow gel",
    "concealers",
    "contour",
    "fixing powders",
    "loose powder",
    "powders",
    "highlighters",
    "mists",
    "micellar water",
    "mousse",
    "pre-shampoos",
    "roll-on",
    "shower milk",
    "spray",
    "steampod",
    "wipes",
    "wax",
    "gel",
    "coloration",
  ],
};

const CATEGORY_INFERENCE_ORDER = [
  "bags",
  "footwear",
  "dresses",
  "outerwear",
  "tailored",
  "bottoms",
  "tops",
  "swimwear",
  "underwear",
  "beauty",
  "activewear",
  "accessories",
];

function categoryAliasEntriesForInference(): Array<[string, string[]]> {
  const seen = new Set<string>();
  const ordered: Array<[string, string[]]> = [];
  for (const key of CATEGORY_INFERENCE_ORDER) {
    const aliases = CATEGORY_ALIASES[key];
    if (!aliases) continue;
    ordered.push([key, aliases]);
    seen.add(key);
  }
  for (const entry of Object.entries(CATEGORY_ALIASES)) {
    if (!seen.has(entry[0])) ordered.push(entry);
  }
  return ordered;
}

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
  for (const [key, aliases] of categoryAliasEntriesForInference()) {
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
    if (/\b(vest\s*top|sleeveless\s*top|tank\s*top|camisole|cami)\b/.test(norm)) {
      return "tops";
    }
    if (/\b(suit|suits|tuxedo|tuxedos|suit\s+jacket|suit\s+jackets|dress\s+jacket|dress\s+jackets|waistcoat|waistcoats|vest|vests|gilet|gilets|tailored\s+jacket|tailored\s+jackets|structured\s+jacket|structured\s+jackets)\b/.test(norm)) {
      return "tailored";
    }
    if (/\b(jacket|jackets|coat|coats|blazer|blazers|cardigan|cardigans|parka|parkas|windbreaker|windbreakers|trench|trenches|overcoat|overcoats|bomber|bombers|anorak|anoraks|poncho|ponchos|cape|capes|shacket|shackets|shirt\s+jackets?|overshirt|overshirts)\b/.test(norm)) {
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
    for (const [key, aliases] of categoryAliasEntriesForInference()) {
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
