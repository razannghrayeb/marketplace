/**
 * Product Gender Inference
 *
 * When the catalog has no `attr_gender` / `audience_gender` / `gender` field
 * populated, we still need a defensible gender signal to enforce cross-gender
 * filtering at rerank time. This module produces an inferred gender label with
 * a confidence score, using cascading evidence:
 *
 *   1. Explicit gender words in title (highest confidence)
 *   2. URL path (/mens/, /women/, etc.)
 *   3. Category / category_canonical text
 *   4. Description text
 *   5. Garment type → gender prior (dress→women, tuxedo→men, etc.)
 *   6. Style cues (lace/frilly→women, tactical/carpenter→men)
 *   7. Size system (Petite, Plus Size → women)
 *
 * Signals are scored multiplicatively — each rule contributes evidence to
 * either men/women/unisex. The final gender is the strongest, with confidence
 * derived from total evidence weight.
 *
 * Important: when no signals apply at all, returns `unknown` with 0
 * confidence. The caller should treat unknown as "do not filter, do not score"
 * — i.e. let the candidate pass downstream gates rather than blocking it
 * silently. This avoids false negatives from catalogs with sparse metadata.
 */

export type ProductGender = "men" | "women" | "unisex" | "unknown";
export type CatalogGender = Exclude<ProductGender, "unknown">;

export const DEFAULT_CATALOG_GENDER_MIN_CONFIDENCE = 0.45;

export interface InferredGenderResult {
  gender: ProductGender;
  confidence: number; // 0..1
  source: "explicit_field" | "brand" | "title" | "url" | "category" | "description" | "garment_type" | "style_cue" | "size_system" | "combined" | "none";
  evidence: { men: number; women: number; unisex: number };
  signals: string[]; // human-readable trace for debugging
}

export interface ProductGenderInput {
  title?: unknown;
  category?: unknown;
  category_canonical?: unknown;
  description?: unknown;
  brand?: unknown;
  product_url?: unknown;
  parent_product_url?: unknown;
  product_types?: unknown;
  attr_style?: unknown;
  attr_gender?: unknown;
  audience_gender?: unknown;
  gender?: unknown;
  attr_size?: unknown;
  size?: unknown;
}

function lower(v: unknown): string {
  return String(v ?? "").toLowerCase();
}

function normalizedUrlText(v: unknown): string {
  let s = lower(v).trim();
  if (!s) return "";
  try {
    s = decodeURIComponent(s);
  } catch {
    // Keep the raw value when a vendor URL contains malformed escapes.
  }
  return s
    .replace(/https?:\/\//g, " ")
    .replace(/['\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ────────────────────────────────────────────────────────────────────────────
// Direct gender word matchers
// ────────────────────────────────────────────────────────────────────────────

const MEN_DIRECT_RE = /\b(men|mens|men's|male|gentleman|gentlemen|gent|gents|boy|boys|boy's|menswear|men[-\s]wear)\b/;
const WOMEN_DIRECT_RE = /\b(women|womens|women's|female|lady|ladies|ladies'|girl|girls|girl's|womenswear|women[-\s]wear|woman)\b/;
const UNISEX_DIRECT_RE = /\b(unisex|gender[-\s]neutral|all[-\s]gender|both[-\s]genders|for[-\s]everyone)\b/;

// URL path gender (high signal: explicitly placed by retailer). We normalize
// URL separators first so `/men-s/`, `/collections/women-shoes`, query slugs,
// and canonical parent URLs all become token-safe text.
const MEN_URL_TOKEN_RE = /\b(men|mens|menswear|man|male|gentleman|gentlemen|gent|gents|boy|boys)\b/;
const WOMEN_URL_TOKEN_RE = /\b(women|womens|womenswear|woman|female|lady|ladies|girl|girls)\b/;
const UNISEX_URL_TOKEN_RE = /\b(unisex|gender\s*neutral|all\s*gender|all\s*genders)\b/;

function detectGenderFromUrl(value: unknown): CatalogGender | null {
  const text = normalizedUrlText(value);
  if (!text) return null;

  const hasMen = MEN_URL_TOKEN_RE.test(text);
  const hasWomen = WOMEN_URL_TOKEN_RE.test(text);
  const hasUnisex = UNISEX_URL_TOKEN_RE.test(text);

  if (hasMen && !hasWomen) return "men";
  if (hasWomen && !hasMen) return "women";
  if (hasUnisex && !hasMen && !hasWomen) return "unisex";
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// Garment-type priors. These are 90%+ one gender in retail catalogs.
// ────────────────────────────────────────────────────────────────────────────

// Strong women-only garments + modern women's silhouette / fit terms.
// Includes both classic women's pieces (dress, blouse, leggings) AND modern
// women's-coded cuts that retailers use to identify women's bottoms (barrel,
// mom, boyfriend, flare, jegging, etc.). These cut terms are 90%+ women's
// across major catalogs even when the listing has no explicit gender field.
const WOMEN_GARMENT_RE = /\b(dress|dresses|gown|gowns|sundress|midi\s*dress|maxi\s*dress|mini\s*dress|cocktail\s*dress|evening\s*dress|wedding\s*dress|bodycon|babydoll|frock|blouse|blouses|camisole|camisoles|cami|camis|skirt|skirts|maxi\s*skirt|midi\s*skirt|mini\s*skirt|pencil\s*skirt|skater\s*skirt|a[-\s]line\s*skirt|wrap\s*skirt|leggings?|jeggings?|tights|pantyhose|hosiery|stockings|bra|bras|brassiere|panty|panties|thong|thongs|lingerie|nightgown|nightie|nighty|negligee|teddy|bustier|corset|peignoir|babydoll|chemise|kaftan|caftan|abaya|kimono|sari|saree|lehenga|kurta\s*kurti|kurti|kameez|salwar|jumpsuit|romper|playsuit|sundress|halter\s*top|crop\s*top|tube\s*top|tank\s*top\s*woman)\b/;

// Modern women's-coded jean / pant silhouettes (Everlane "barrel", "way-high",
// "cheeky", "curvy"; mom/boyfriend/girlfriend/flare/bootcut/skinny/jegging cuts).
// Separated from the main garment regex so we can give it slightly different
// scoring weight in the cascade.
const WOMEN_SILHOUETTE_RE = /\b(barrel\s*(jean|jeans|pant|pants|leg)|wide[-\s]?barrel|mom\s*(jean|jeans|fit|pant|pants)|boyfriend\s*(jean|jeans|fit)|girlfriend\s*(jean|jeans|fit)|high[-\s]?rise|high[-\s]?waist(ed)?|way[-\s]?high|flare\s*(jean|jeans|pant|pants)|flared\s*(jean|jeans|pant|pants)|kick\s*flare|bootcut|boot[-\s]cut|cropped\s*(jean|jeans|pant|pants)|ankle\s*(jean|jeans|pant|pants)|skinny\s*(jean|jeans|pant|pants)|super\s*skinny|ultra\s*skinny|jegging|jeggings|wide[-\s]?leg\s*(jean|jeans|pant|pants)|pencil\s*pant|cheeky\s*(jean|jeans)|curvy\s*(jean|jeans|fit)|paperbag\s*(pant|pants|waist)|wrap\s*(pant|pants|skirt)|maxi\s*(skirt|dress)|midi\s*(skirt|dress))\b/;

// Strong men-only garments + modern men's-coded fits.
const MEN_GARMENT_RE = /\b(tuxedo|tuxedos|necktie|neckties|bow[-\s]?tie|bowtie|bowties|pocket\s*square|cufflink|cufflinks|men'?s?\s*suit|three[-\s]piece\s*suit|two[-\s]piece\s*suit|boxer\s*brief|boxer\s*briefs|boxers|jockstrap|tighty[-\s]?whities|men'?s?\s*briefs|cummerbund|men'?s?\s*formal|trench\s*coat\s*men)\b/;

// Modern men's-coded fit terms. These are weaker signals than WOMEN_SILHOUETTE_RE
// because retailers do use "athletic fit" / "slim straight" for women's lines too,
// but in combination with bottoms they're reliably men's-leaning.
const MEN_SILHOUETTE_RE = /\b(athletic\s*fit|slim\s*straight\s*fit|slim\s*straight|relaxed\s*fit\s*(jean|jeans|pant|pants)|loose\s*fit\s*(jean|jeans|pant|pants)|carpenter\s*(jean|jeans|pant|pants)|workwear\s*(pant|pants|jean|jeans)|five[-\s]pocket|big\s*and\s*tall)\b/;

// ────────────────────────────────────────────────────────────────────────────
// Style cues (medium confidence)
// ────────────────────────────────────────────────────────────────────────────

const WOMEN_STYLE_CUES_RE = /\b(lace|lacy|frilly|frill|ruffled|ruffle|off[-\s]shoulder|sweetheart\s*neck|peplum|babydoll|puff\s*sleeve|puffy\s*sleeve|bishop\s*sleeve|leg[-\s]of[-\s]mutton|fit[-\s]and[-\s]flare|empire\s*waist|sweetheart|sequin|sequined|sequinned|beaded|embellished|floral\s*lace)\b/;
const MEN_STYLE_CUES_RE = /\b(rugged|tactical|carpenter|workwear|utility[-\s]pant|cargo[-\s]work|barn[-\s]coat|chore\s*coat|dungaree|coverall|overall\s*for\s*men|men'?s?\s*workshirt|gent'?s?\s*style|distinguished[-\s]gentleman|bespoke[-\s]men)\b/;

// ────────────────────────────────────────────────────────────────────────────
// Size system signals
// ────────────────────────────────────────────────────────────────────────────

// Women size cues
const WOMEN_SIZE_RE = /\b(petite|plus[-\s]size|size\s+(0|2|4|6|8|10|12|14)\b|xs\s*-\s*xl\s*women|womens?\s*size)\b/;
// Men waist sizes (28-44 even numbers, in inches)
const MEN_SIZE_RE = /\b(\d{2}\s*x\s*\d{2}\b|waist\s*(28|29|30|31|32|33|34|36|38|40|42|44)|men'?s?\s*size|big\s*and\s*tall)\b/;

// ────────────────────────────────────────────────────────────────────────────
// Anti-signals — words that should NOT count as gender evidence
// ("man" inside "manage", "manufactured", "woman" inside "womanizing" etc.)
// Using \b boundaries above is mostly sufficient; these are extras for safety.
// ────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// Main inference
// ────────────────────────────────────────────────────────────────────────────

export function inferProductGender(input: ProductGenderInput): InferredGenderResult {
  const signals: string[] = [];
  let menScore = 0;
  let womenScore = 0;
  let unisexScore = 0;

  // ── Layer 1: explicit field (authoritative when present and well-formed) ──
  const explicit = lower(input.attr_gender ?? input.audience_gender ?? input.gender).trim();
  if (explicit) {
    if (/^(men|mens|male|man|m)$/.test(explicit) || MEN_DIRECT_RE.test(explicit)) {
      return {
        gender: "men",
        confidence: 1.0,
        source: "explicit_field",
        evidence: { men: 1, women: 0, unisex: 0 },
        signals: ["explicit_field=men"],
      };
    }
    if (/^(women|womens|female|woman|w|f)$/.test(explicit) || WOMEN_DIRECT_RE.test(explicit)) {
      return {
        gender: "women",
        confidence: 1.0,
        source: "explicit_field",
        evidence: { men: 0, women: 1, unisex: 0 },
        signals: ["explicit_field=women"],
      };
    }
    if (/^unisex$/.test(explicit) || UNISEX_DIRECT_RE.test(explicit)) {
      return {
        gender: "unisex",
        confidence: 1.0,
        source: "explicit_field",
        evidence: { men: 0, women: 0, unisex: 1 },
        signals: ["explicit_field=unisex"],
      };
    }
  }

  // ── Layer 2: URL path (high confidence — retailer chose this URL) ──
  const productUrlGender = detectGenderFromUrl(input.product_url);
  const parentUrlGender = detectGenderFromUrl(input.parent_product_url);
  for (const [label, gender] of [
    ["url", productUrlGender],
    ["parent_url", parentUrlGender],
  ] as const) {
    if (gender === "men") {
      menScore += 3.0;
      signals.push(`${label}=men`);
    } else if (gender === "women") {
      womenScore += 3.0;
      signals.push(`${label}=women`);
    } else if (gender === "unisex") {
      unisexScore += 2.0;
      signals.push(`${label}=unisex`);
    }
  }

  // ── Layer 3: title (high confidence when explicit gender word present) ──
  const brandNorm = lower(input.brand);
  if (MEN_DIRECT_RE.test(brandNorm)) {
    menScore += 5.0;
    signals.push("brand=men_word");
  }
  if (WOMEN_DIRECT_RE.test(brandNorm)) {
    womenScore += 5.0;
    signals.push("brand=women_word");
  }
  if (UNISEX_DIRECT_RE.test(brandNorm)) {
    unisexScore += 3.0;
    signals.push("brand=unisex_word");
  }

  const titleNorm = lower(input.title);
  if (MEN_DIRECT_RE.test(titleNorm)) {
    menScore += 3.0;
    signals.push("title=men_word");
  }
  if (WOMEN_DIRECT_RE.test(titleNorm)) {
    womenScore += 3.0;
    signals.push("title=women_word");
  }
  if (UNISEX_DIRECT_RE.test(titleNorm)) {
    unisexScore += 2.5;
    signals.push("title=unisex_word");
  }

  // ── Layer 4: category text (high confidence) ──
  const categoryBlob = `${lower(input.category)} ${lower(input.category_canonical)}`;
  if (MEN_DIRECT_RE.test(categoryBlob)) {
    menScore += 2.5;
    signals.push("category=men_word");
  }
  if (WOMEN_DIRECT_RE.test(categoryBlob)) {
    womenScore += 2.5;
    signals.push("category=women_word");
  }
  if (UNISEX_DIRECT_RE.test(categoryBlob)) {
    unisexScore += 2.0;
    signals.push("category=unisex_word");
  }

  // ── Layer 5: description (medium confidence — may have unrelated mentions) ──
  // Only check first 300 chars to reduce noise from generic e-commerce boilerplate.
  const descSnippet = lower(input.description).slice(0, 300);
  if (MEN_DIRECT_RE.test(descSnippet)) {
    menScore += 1.0;
    signals.push("desc=men_word");
  }
  if (WOMEN_DIRECT_RE.test(descSnippet)) {
    womenScore += 1.0;
    signals.push("desc=women_word");
  }

  // ── Layer 6: garment-type prior ──
  // These are 90%+ one gender across catalogs. Combine with title + category.
  const garmentBlob = [
    titleNorm,
    categoryBlob,
    Array.isArray(input.product_types) ? lower(input.product_types.join(" ")) : lower(input.product_types),
  ].join(" ");

  if (WOMEN_GARMENT_RE.test(garmentBlob)) {
    womenScore += 2.0;
    signals.push("garment=women");
  }
  if (MEN_GARMENT_RE.test(garmentBlob)) {
    menScore += 2.0;
    signals.push("garment=men");
  }
  // Modern silhouette / cut signals — these catch women's-coded jean cuts
  // (barrel, mom, flare, skinny, jegging, way-high, cheeky, curvy) and men's
  // workwear / fit terms (athletic fit, carpenter, slim straight) that don't
  // appear in the classic garment-type lists.
  if (WOMEN_SILHOUETTE_RE.test(garmentBlob)) {
    womenScore += 1.8;
    signals.push("silhouette=women");
  }
  if (MEN_SILHOUETTE_RE.test(garmentBlob)) {
    menScore += 1.5;
    signals.push("silhouette=men");
  }

  // ── Layer 7: style cues (medium confidence) ──
  const styleBlob = `${titleNorm} ${descSnippet} ${lower(input.attr_style)}`;
  if (WOMEN_STYLE_CUES_RE.test(styleBlob)) {
    womenScore += 1.0;
    signals.push("style=women");
  }
  if (MEN_STYLE_CUES_RE.test(styleBlob)) {
    menScore += 1.0;
    signals.push("style=men");
  }

  // ── Layer 8: size system ──
  const sizeBlob = `${lower(input.attr_size)} ${lower(input.size)} ${descSnippet}`;
  if (WOMEN_SIZE_RE.test(sizeBlob)) {
    womenScore += 1.5;
    signals.push("size=women");
  }
  if (MEN_SIZE_RE.test(sizeBlob)) {
    menScore += 1.5;
    signals.push("size=men");
  }

  // ── Resolve final gender ──
  const totalEvidence = menScore + womenScore + unisexScore;
  if (totalEvidence === 0) {
    // No signals at all. Return unknown with 0 confidence so downstream
    // gates know to treat this as "no information" rather than blocking.
    return {
      gender: "unknown",
      confidence: 0,
      source: "none",
      evidence: { men: 0, women: 0, unisex: 0 },
      signals: [],
    };
  }

  // If both men and women score significantly, treat as conflicting → unisex/unknown.
  // Threshold: both must score >= 1.0 AND ratio between them < 2x to call it conflicting.
  const conflicting =
    menScore >= 1.0 &&
    womenScore >= 1.0 &&
    Math.max(menScore, womenScore) / Math.min(menScore, womenScore) < 2.0;
  if (conflicting) {
    return {
      gender: "unisex",
      confidence: 0.4,
      source: "combined",
      evidence: { men: menScore, women: womenScore, unisex: unisexScore },
      signals,
    };
  }

  // Pick the dominant gender. Confidence scales with absolute evidence weight,
  // capped at 0.95 (only explicit_field gets 1.0).
  const winner =
    menScore > womenScore && menScore > unisexScore
      ? "men"
      : womenScore > menScore && womenScore > unisexScore
        ? "women"
        : "unisex";

  const winnerScore =
    winner === "men" ? menScore : winner === "women" ? womenScore : unisexScore;
  // Confidence: 1 signal worth ~1pt → ~0.50 confidence; 3+ signals → 0.85+; max 0.95.
  const confidence = Math.min(0.95, Math.max(0.30, 0.30 + winnerScore * 0.18));

  // Pick representative source (the strongest signal type that contributed).
  const source: InferredGenderResult["source"] =
    signals.find((s) => s.startsWith("url") || s.startsWith("parent_url"))
      ? "url"
      : signals.find((s) => s.startsWith("brand"))
        ? "brand"
      : signals.find((s) => s.startsWith("title"))
        ? "title"
        : signals.find((s) => s.startsWith("category"))
          ? "category"
          : signals.find((s) => s.startsWith("garment"))
            ? "garment_type"
            : signals.find((s) => s.startsWith("style"))
              ? "style_cue"
              : signals.find((s) => s.startsWith("size"))
                ? "size_system"
                : signals.find((s) => s.startsWith("desc"))
                  ? "description"
                  : "combined";

  return {
    gender: winner,
    confidence,
    source,
    evidence: { men: menScore, women: womenScore, unisex: unisexScore },
    signals,
  };
}

export function inferCatalogGenderValue(
  input: ProductGenderInput,
  minConfidence = DEFAULT_CATALOG_GENDER_MIN_CONFIDENCE,
): CatalogGender | null {
  const inferred = inferProductGender(input);
  if (inferred.gender === "unknown") return null;
  if (inferred.confidence < minConfidence) return null;
  return inferred.gender;
}

/**
 * Compliance score [0..1] — does this product match the query gender?
 *
 * Replaces the brittle scoreAudienceCompliance regex chain when the catalog
 * has null gender. Uses inferred gender + confidence to produce a score the
 * audience hard gate / cap stage can act on.
 *
 * Scoring:
 *   - inferred matches query → 1.0
 *   - inferred is unisex → 0.85 (acceptable — unisex products serve both genders)
 *   - inferred is unknown (no signals) → 0.65 (neutral — don't penalize sparse metadata)
 *   - inferred is opposite of query → score scales with confidence:
 *     - high confidence (≥0.80) → 0.05 (hard contradiction)
 *     - medium (0.50-0.80) → 0.20 (soft contradiction)
 *     - low (<0.50) → 0.40 (uncertain)
 */
export function scoreProductGenderCompliance(
  product: ProductGenderInput,
  queryGender: ProductGender,
): { score: number; inferred: InferredGenderResult } {
  const inferred = inferProductGender(product);

  // No query gender → can't score; return neutral.
  if (queryGender === "unknown" || queryGender === "unisex") {
    return { score: 1.0, inferred };
  }

  if (inferred.gender === queryGender) {
    return { score: 1.0, inferred };
  }

  if (inferred.gender === "unisex") {
    // Unisex products are acceptable for any gender query.
    return { score: 0.85, inferred };
  }

  if (inferred.gender === "unknown") {
    // No signals at all. Don't penalize — the catalog simply has sparse metadata.
    // The audience hard gate (< 0.30) won't trigger; the cap stage uses score
    // as-is so the candidate competes on visual + type alone.
    return { score: 0.65, inferred };
  }

  // Opposite-gender inference. Confidence-scaled penalty.
  if (inferred.confidence >= 0.80) {
    return { score: 0.05, inferred };
  }
  if (inferred.confidence >= 0.50) {
    return { score: 0.20, inferred };
  }
  return { score: 0.40, inferred };
}

/** Public helper for callers that already have an inferred result and just want compliance. */
export function complianceFromInferredGender(
  inferred: InferredGenderResult,
  queryGender: ProductGender,
): number {
  if (queryGender === "unknown" || queryGender === "unisex") return 1.0;
  if (inferred.gender === queryGender) return 1.0;
  if (inferred.gender === "unisex") return 0.85;
  if (inferred.gender === "unknown") return 0.65;
  if (inferred.confidence >= 0.80) return 0.05;
  if (inferred.confidence >= 0.50) return 0.20;
  return 0.40;
}
