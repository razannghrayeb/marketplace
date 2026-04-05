/**
 * Heuristic extraction of audience + color hints from BLIP (or any) image caption text.
 * Shared by shop-the-look analysis and catalog backfill on product image upload.
 */

/** Used to require apparel/product context before writing gender or a long-form description. */
const CATALOG_PRODUCT_CONTEXT_RE =
  /\b(dress|dresses|shirt|shirts|shoe|shoes|sneaker|sneakers|boot|boots|jean|jeans|pant|pants|trouser|trousers|jacket|jackets|coat|coats|blazer|blazers|sweater|sweaters|top|tops|skirt|skirts|bag|bags|handbag|handbags|watch|watches|hat|hats|suit|suits|gown|gowns|tee|tees|t-shirt|tshirt|shorts|vest|vests|hoodie|hoodies|chain|necklace|necklaces|bracelet|bracelets|ring|rings|earring|earrings|sunglasses|belt|belts|wallet|wallets|scarf|scarves|tie|ties|cardigan|cardigans|tunic|tunics|blouse|blouses|bodysuit|romper|rompers|jumpsuit|jumpsuits|legging|leggings|outfit|outfits|apparel|clothing|footwear|sandal|sandals|loafer|loafers|heel|heels|knitwear|sock|socks|glove|gloves|wear)\b/i;

const CATALOG_COLOR_WORDS_RE =
  /\b(black|navy|blue|denim|grey|gray|white|ivory|cream|off[- ]white|tan|camel|brown|green|olive|red|burgundy|pink|maroon|beige|charcoal|gold|silver|multicolor|multi[- ]colored|colorful)\b/gi;

const CATALOG_AUDIENCE_WORDS_RE =
  /\b(unisex|universal|men|mens|men's|male|man|ladies|women|womens|women's|female|woman|boy|boys|boy's|girl|girls|girl's|kid|kids|child|children|toddler|baby|teen|youth)\b/gi;

export function inferAudienceFromCaption(caption: string): { gender?: string; ageGroup?: string } {
  const s = String(caption || "").toLowerCase();
  const hasUnisex = /\b(unisex|universal)\b/.test(s);
  const hasMen = /\b(men|mens|male|man)\b/.test(s);

  const gender = hasUnisex
    ? "unisex"
    : /\b(girl|girls|girl's)\b/.test(s)
      ? "girls"
      : /\b(boy|boys|boy's)\b/.test(s)
        ? "boys"
        : /\b(ladies|women|womens|female|woman)\b/.test(s)
          ? "women"
          : hasMen
            ? "men"
            : undefined;

  let ageGroup: string | undefined;
  if (/\b(baby|infant|newborn)\b/.test(s)) ageGroup = "baby";
  else if (/\b(toddler)\b/.test(s)) ageGroup = "kids";
  else if (/\b(teen|youth|teenager)\b/.test(s)) ageGroup = "teen";
  else if (/\b(kid|kids|child|children|boys|girls|toddler)\b/.test(s)) ageGroup = "kids";

  return { gender, ageGroup };
}

export function inferColorFromCaption(caption: string): {
  topColor?: string | null;
  jeansColor?: string | null;
  garmentColor?: string | null;
} {
  const s = String(caption || "").toLowerCase();

  const mapColorWord = (w: string): string | null => {
    const x = w.toLowerCase().trim();
    if (!x) return null;
    if (x === "navy" || x === "dark-blue" || x === "dark blue" || x === "midnight-blue" || x === "midnight blue")
      return "navy";
    if (x === "blue" || x === "denim") return "blue";
    if (x === "black") return "black";
    if (x === "grey" || x === "gray") return "gray";
    if (x === "white" || x === "ivory" || x === "cream" || x === "off-white" || x === "off white") return "off-white";
    if (x === "tan" || x === "camel" || x === "brown") return "tan";
    if (x === "green" || x === "olive") return "green";
    if (x === "red" || x === "burgundy") return "red";
    if (x === "pink") return "pink";
    return null;
  };

  const colorTokens =
    "black|navy|blue|denim|grey|gray|white|ivory|cream|off[- ]white|tan|camel|brown|green|olive|red|pink";

  let topColor: string | null = null;
  const topMatch = s.match(
    new RegExp(`\\b(${colorTokens})\\b[^.]{0,40}\\b(top|shirt|blouse|tee|t-shirt|t shirt|tunic)\\b`),
  );
  if (topMatch?.[1]) topColor = mapColorWord(topMatch[1]);

  let jeansColor: string | null = null;
  const jeansMatch = s.match(/\b(black|navy|blue|denim|grey|gray)\b[^.]{0,20}\bjeans\b/);
  if (jeansMatch?.[1]) jeansColor = mapColorWord(jeansMatch[1]);

  let garmentColor: string | null = null;
  const garmentMatch = s.match(
    new RegExp(
      `\\b(${colorTokens})\\b[^.]{0,40}\\b(dress|dresses|skirt|skirts|jacket|coat|blazer|sweater|gown)\\b`,
    ),
  );
  if (garmentMatch?.[1]) garmentColor = mapColorWord(garmentMatch[1]);

  return { topColor, jeansColor, garmentColor };
}

/** Single best color token for catalog backfill when category slot is unknown. */
export function primaryColorHintFromCaption(caption: string): string | null {
  const { topColor, jeansColor, garmentColor } = inferColorFromCaption(caption);
  return garmentColor ?? topColor ?? jeansColor ?? null;
}

/**
 * Text for `products.description` only: normalized sentence, never raw attribute dumps.
 * Returns null when the caption is too short or looks like color/audience only (those belong in other columns).
 */
export function productDescriptionFromCaption(caption: string): string | null {
  let s = String(caption || "").replace(/\s+/g, " ").trim();
  if (s.length < 12) return null;
  if (s.length > 500) s = `${s.slice(0, 497).trimEnd()}...`;

  const hasProduct = CATALOG_PRODUCT_CONTEXT_RE.test(s);
  const residue = s
    .replace(CATALOG_COLOR_WORDS_RE, " ")
    .replace(CATALOG_AUDIENCE_WORDS_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
  const residueWordCount = residue.split(/\s+/).filter(Boolean).length;

  if (!hasProduct && residueWordCount < 4) return null;
  if (!hasProduct && s.length < 32) return null;

  const c0 = s.charAt(0).toUpperCase() + s.slice(1);
  const t = c0.trimEnd();
  if (/[.!?…]"?$/.test(t)) return t;
  return `${t.replace(/\.+$/, "").trimEnd()}.`;
}

const GENDER_ENUM = new Set(["men", "women", "unisex", "boys", "girls"]);

function inferCatalogGenderFromCombinedText(combined: string): string | null {
  if (!combined) return null;

  const { gender } = inferAudienceFromCaption(combined);
  if (!gender || !GENDER_ENUM.has(gender)) return null;

  const s = combined.toLowerCase();
  const apparelContext =
    CATALOG_PRODUCT_CONTEXT_RE.test(combined) ||
    primaryColorHintFromCaption(combined) != null ||
    /\b(wearing|dressed|outfit|fashion|style|clothes|clothing|apparel|garment)\b/.test(s);
  /** Titles like "Men's Cologne" / "Women's Watch" provide explicit retail audience context. */
  const explicitRetailGender =
    /\b(men's|mens\b|women's|womens\b|ladies'|boys'|girls'|boy's|girl's|unisex|for men\b|for women\b|for boys\b|for girls\b)\b/i.test(
      combined,
    );
  if (!apparelContext && !explicitRetailGender) return null;
  return gender;
}

/**
 * Detect catalog gender from product text fields (title/description/details).
 * Returns normalized values: men | women | unisex | boys | girls.
 */
export function catalogGenderFromProductText(...texts: Array<string | null | undefined>): string | null {
  const combined = texts
    .map((t) => String(t || "").trim())
    .filter(Boolean)
    .join(" ");
  return inferCatalogGenderFromCombinedText(combined);
}

/**
 * Value for `products.gender` only. Uses caption + optional product title (titles often
 * carry "Men's / Women's / Kids'" signals when the image caption does not).
 * Still requires apparel/product context so random scene captions do not set gender alone.
 */
export function catalogGenderFromCaption(caption: string, productTitle?: string | null): string | null {
  return catalogGenderFromProductText(productTitle, caption);
}
