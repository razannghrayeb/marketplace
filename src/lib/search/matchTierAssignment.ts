/**
 * Match Tier Assignment System
 *
 * Assigns products to tiers (exact, strong, related, weak, fallback, blocked)
 * based on normalized metadata, contract tier, and FashionIntent alignment.
 *
 * Tier Ranges (min–max score cap):
 *  exact:    0.86–0.96 (tier cap: 0.94) — same family, type, and compatible color
 *  strong:   0.76–0.86 (tier cap: 0.78) — same family + type but subtype/color mismatch
 *  related:  0.62–0.76 (tier cap: 0.74) — same family but different type
 *  weak:     0.45–0.62 (tier cap: 0.55) — same family but significantly different
 *  fallback: 0.30–0.45 (tier cap: 0.40) — uncertain metadata or weak visual match
 *  blocked:  0.00 — known wrong family, hard dropped
 *
 * Canonical rule: Less similar exact item beats more similar wrong/related item.
 * Sorting is by (tier, then finalRelevance01 within tier, then visualSimilarity).
 */

export type MatchTier = "exact" | "strong" | "related" | "weak" | "fallback" | "blocked";

import type { FashionIntent } from "./fashionIntent";
import { defaultConfidence, type ImageMode } from "./fashionIntent";
import { colorCompatibility } from "./colorCompatibilityMatrix";
import { config } from "../../config";

/**
 * Bottoms type equivalence mapping for jeans, pants, trousers, chinos.
 * Used to prevent jeans from being marked as "type mismatch" when intent is pants.
 */
const BOTTOMS_TYPE_EQUIVALENCE: Record<string, Set<string>> = {
  pants: new Set(["pants", "trousers", "pant", "trouser", "jeans", "jean", "denim", "chinos", "chino", "cargo", "cargo pants"]),
  trousers: new Set(["trousers", "pants", "trouser", "pant", "jeans", "jean", "denim", "chinos", "chino", "cargo", "cargo pants"]),
  jeans: new Set(["jeans", "jean", "denim", "pants", "pant", "trousers", "trouser", "chinos", "chino"]),
  denim: new Set(["denim", "jeans", "jean", "pants", "pant", "trousers", "trouser"]),
  chinos: new Set(["chinos", "chino", "pants", "pant", "trousers", "trouser"]),
  chino: new Set(["chino", "chinos", "pants", "pant", "trousers", "trouser"]),
};

/**
 * Check if two bottoms types are equivalent
 * Returns 1.0 for exact match, 0.95 for jeans/denim with pants intent, 0 otherwise
 */
function bottomsTypeEquivalence(intentType: string, productType: string): number {
  const intent = intentType.toLowerCase().trim();
  const product = productType.toLowerCase().trim();
  
  if (intent === product) return 1.0;
  
  const equivalents = BOTTOMS_TYPE_EQUIVALENCE[intent];
  if (!equivalents) return 0;
  
  if (equivalents.has(product)) {
    // Jeans/denim with pants/trousers intent: 0.95 score (very high)
    if ((product === "jeans" || product === "jean" || product === "denim") &&
        (intent === "pants" || intent === "pant" || intent === "trousers" || intent === "trouser")) {
      return 0.95;
    }
    // Other equivalences: 0.90 score
    return 0.90;
  }
  
  return 0;
}

function topTypeEquivalence(intentType: string, productType: string): number {
  const intent = intentType.toLowerCase().trim();
  const product = productType.toLowerCase().trim();

  if (intent === product) return 1.0;
  if (intent !== "tshirt_or_shirt") return 0;
  if (["tshirt", "tee", "t-shirt", "shirt", "short sleeve top"].includes(product)) return 1.0;
  if (["polo", "polo shirt", "blouse", "button down", "button-down", "button down shirt"].includes(product)) return 0.9;
  return 0;
}

/**
 * Suit type equivalence for formal wear matching
 * Suit, suit jacket, blazer, dress jacket are all acceptable for suit intent
 * Returns 1.0 for exact match, 0.95 for suit jacket/blazer variants, 0 otherwise
 */
function suitTypeEquivalence(intentType: string, productType: string): number {
  const intent = intentType.toLowerCase().trim();
  const product = productType.toLowerCase().trim();

  if (intent === product) return 1.0;

  const isSuitIntent = /\b(suit|suits|tuxedo|tuxedos)\b/.test(intent);
  if (!isSuitIntent) return 0;

  const isFormalWear = /\b(suit|suits|tuxedo|tuxedos|suit jacket|dress jacket|blazer|blazers|sport coat|sportcoat|formal jacket|waistcoat|vest)\b/.test(product);

  if (!isFormalWear) return 0;

  if (intent.includes("tuxedo") && product.includes("tuxedo")) return 1.0;
  if ((intent.includes("suit") && product.includes("suit")) || (intent.includes("suit") && (product.includes("jacket") || product.includes("blazer")))) {
    return 1.0;
  }

  if (/\b(suit|suits)\b/.test(intent) && /\b(suit jacket|blazer|dress jacket|formal jacket)\b/.test(product)) {
    return 0.98;
  }

  return 0;
}

/**
 * Footwear type equivalence — groups sneakers, boots, sandals, formal shoes, heels
 */
function footwearTypeEquivalence(intentType: string, productType: string): number {
  const intent = intentType.toLowerCase().trim();
  const product = productType.toLowerCase().trim();

  if (intent === product) return 1.0;

  const sneakerFamily = new Set(["sneaker", "sneakers", "trainer", "trainers", "athletic shoe", "athletic shoes", "running shoe", "running shoes", "sport shoe", "sport shoes", "tennis shoe", "tennis shoes", "gym shoe", "gym shoes", "low top", "high top"]);
  const bootFamily = new Set(["boot", "boots", "ankle boot", "ankle boots", "chelsea boot", "chelsea boots", "combat boot", "combat boots", "knee-high boot", "knee high boot", "knee boot", "knee boots", "booties", "bootie", "western boot", "western boots", "riding boot", "riding boots"]);
  const sandalFamily = new Set(["sandal", "sandals", "slide", "slides", "flip flop", "flip flops", "flip-flop", "flip-flops", "thong sandal", "thong sandals", "mule", "mules", "slingback", "slingbacks"]);
  const formalFamily = new Set(["oxford", "oxfords", "loafer", "loafers", "dress shoe", "dress shoes", "derby", "derbies", "brogue", "brogues", "moccasin", "moccasins", "monk strap", "monk straps", "boat shoe", "boat shoes"]);
  const heelFamily = new Set(["heel", "heels", "pump", "pumps", "stiletto", "stilettos", "block heel", "block heels", "wedge", "wedges", "kitten heel", "kitten heels", "platform heel", "platform heels"]);
  const genericShoe = new Set(["shoe", "shoes", "footwear"]);

  // Same sub-family: exact equivalence
  if (sneakerFamily.has(intent) && sneakerFamily.has(product)) return 1.0;
  if (bootFamily.has(intent) && bootFamily.has(product)) return 1.0;
  if (sandalFamily.has(intent) && sandalFamily.has(product)) return 1.0;
  if (formalFamily.has(intent) && formalFamily.has(product)) return 1.0;
  if (heelFamily.has(intent) && heelFamily.has(product)) return 1.0;

  // Generic "shoe/footwear" intent accepts any specific type
  if (genericShoe.has(intent)) return 0.9;
  // Generic product under specific intent: still very acceptable
  if (genericShoe.has(product)) return 0.9;

  // Cross sub-family (e.g. sneaker vs boot): both are footwear, lower equivalence
  const allFootwear = new Set([...sneakerFamily, ...bootFamily, ...sandalFamily, ...formalFamily, ...heelFamily]);
  if (allFootwear.has(intent) && allFootwear.has(product)) return 0.7;

  return 0;
}

/**
 * Outerwear type equivalence — jackets, coats, blazers, hoodies, parkas
 */
function outerwearTypeEquivalence(intentType: string, productType: string): number {
  const intent = intentType.toLowerCase().trim();
  const product = productType.toLowerCase().trim();

  if (intent === product) return 1.0;

  const jacketFamily = new Set(["jacket", "jackets", "bomber jacket", "bomber", "denim jacket", "leather jacket", "utility jacket", "trucker jacket", "field jacket"]);
  const coatFamily = new Set(["coat", "coats", "overcoat", "trench coat", "trench", "wool coat", "pea coat", "peacoat", "duffle coat", "wrap coat", "top coat"]);
  const blazerFamily = new Set(["blazer", "blazers", "sport coat", "sportcoat", "tailored jacket"]);
  const hoodieFamily = new Set(["hoodie", "hoodies", "sweatshirt", "sweatshirts", "zip hoodie", "pullover hoodie", "zip-up hoodie"]);
  const parkaFamily = new Set(["parka", "parkas", "puffer", "puffer jacket", "down jacket", "quilted jacket", "anorak", "padded jacket", "puffer coat"]);
  const windFamily = new Set(["windbreaker", "windbreakers", "rain jacket", "shell jacket", "waterproof jacket", "softshell", "softshell jacket"]);
  const genericOuter = new Set(["outerwear", "outer", "layering piece", "shacket"]);

  if (jacketFamily.has(intent) && jacketFamily.has(product)) return 1.0;
  if (coatFamily.has(intent) && coatFamily.has(product)) return 1.0;
  if (blazerFamily.has(intent) && blazerFamily.has(product)) return 1.0;
  if (hoodieFamily.has(intent) && hoodieFamily.has(product)) return 1.0;
  if (parkaFamily.has(intent) && parkaFamily.has(product)) return 1.0;
  if (windFamily.has(intent) && windFamily.has(product)) return 1.0;

  // Jacket ↔ coat: very close
  if ((jacketFamily.has(intent) || coatFamily.has(intent)) && (jacketFamily.has(product) || coatFamily.has(product))) return 0.88;

  // Generic outerwear accepts any type
  if (genericOuter.has(intent) || genericOuter.has(product)) return 0.9;

  // Other cross-type outerwear
  const allOuter = new Set([...jacketFamily, ...coatFamily, ...blazerFamily, ...hoodieFamily, ...parkaFamily, ...windFamily]);
  if (allOuter.has(intent) && allOuter.has(product)) return 0.75;

  return 0;
}

/**
 * Dress type equivalence — length variants, style variants, and dress-adjacent pieces
 */
function dressTypeEquivalence(intentType: string, productType: string): number {
  const intent = intentType.toLowerCase().trim();
  const product = productType.toLowerCase().trim();

  if (intent === product) return 1.0;

  const genericDress = new Set(["dress", "dresses"]);

  // Generic "dress" intent accepts all dress variants
  if (genericDress.has(intent) || genericDress.has(product)) return 0.95;

  const miniFamily = new Set(["mini dress", "minidress", "short dress"]);
  const midiFamily = new Set(["midi dress", "mididress", "knee length dress", "knee-length dress", "tea length dress"]);
  const maxiFamily = new Set(["maxi dress", "maxidress", "floor length dress", "long dress", "gown"]);
  const wrapFamily = new Set(["wrap dress", "wrap"]);
  const bodyconFamily = new Set(["bodycon dress", "bodycon", "bandage dress", "fitted dress"]);
  const shirtDressFamily = new Set(["shirt dress", "shirtdress"]);
  const slipFamily = new Set(["slip dress", "slipdress"]);
  const jumpsuitFamily = new Set(["jumpsuit", "romper", "playsuit", "one piece", "one-piece"]);

  // Length variants — all treat as equivalent dresses
  const allLengths = new Set([...miniFamily, ...midiFamily, ...maxiFamily]);
  if (allLengths.has(intent) && allLengths.has(product)) return 0.9;

  if (wrapFamily.has(intent) && wrapFamily.has(product)) return 1.0;
  if (bodyconFamily.has(intent) && bodyconFamily.has(product)) return 1.0;
  if (shirtDressFamily.has(intent) && shirtDressFamily.has(product)) return 1.0;
  if (slipFamily.has(intent) && slipFamily.has(product)) return 1.0;

  // Jumpsuit/romper are dress-adjacent (separate silhouette but same occasion)
  if (jumpsuitFamily.has(intent) && jumpsuitFamily.has(product)) return 1.0;
  if (jumpsuitFamily.has(intent) || jumpsuitFamily.has(product)) return 0.75;

  return 0;
}

/**
 * Bag type equivalence — crossbody, tote, backpack, clutch, satchel
 */
function bagTypeEquivalence(intentType: string, productType: string): number {
  const intent = intentType.toLowerCase().trim();
  const product = productType.toLowerCase().trim();

  if (intent === product) return 1.0;

  const genericBag = new Set(["bag", "bags", "handbag", "purse"]);
  if (genericBag.has(intent) || genericBag.has(product)) return 0.9;

  const crossbodyFamily = new Set(["crossbody", "crossbody bag", "cross body bag", "shoulder bag", "shoulder purse"]);
  const toteFamily = new Set(["tote", "tote bag", "shopper", "shopper bag", "shopping bag"]);
  const backpackFamily = new Set(["backpack", "rucksack", "daypack", "knapsack"]);
  const clutchFamily = new Set(["clutch", "clutch bag", "evening bag", "minaudiere", "wristlet"]);
  const satchelFamily = new Set(["satchel", "satchel bag", "structured bag", "doctor bag", "top handle bag"]);
  const beltBagFamily = new Set(["belt bag", "fanny pack", "waist bag", "bum bag"]);

  if (crossbodyFamily.has(intent) && crossbodyFamily.has(product)) return 1.0;
  if (toteFamily.has(intent) && toteFamily.has(product)) return 1.0;
  if (backpackFamily.has(intent) && backpackFamily.has(product)) return 1.0;
  if (clutchFamily.has(intent) && clutchFamily.has(product)) return 1.0;
  if (satchelFamily.has(intent) && satchelFamily.has(product)) return 1.0;
  if (beltBagFamily.has(intent) && beltBagFamily.has(product)) return 1.0;

  return 0;
}

/**
 * Central dispatcher: routes to the family-specific equivalence function.
 * Uses the intent's family (falls back to product's family) as the routing key.
 */
function getTypeEquivalenceScore(family: string, intentType: string, productType: string): number {
  const fam = String(family ?? "").toLowerCase().trim();
  switch (fam) {
    case "tops":      return topTypeEquivalence(intentType, productType);
    case "bottoms":   return bottomsTypeEquivalence(intentType, productType);
    case "footwear":  return footwearTypeEquivalence(intentType, productType);
    case "outerwear": return outerwearTypeEquivalence(intentType, productType);
    case "dresses":   return dressTypeEquivalence(intentType, productType);
    case "bags":      return bagTypeEquivalence(intentType, productType);
    case "suits":     return suitTypeEquivalence(intentType, productType);
    default:          return 0;
  }
}

export interface TierAssignmentResult {
  tier: MatchTier;
  reason: string;
  tierCap: number;
}

/**
 * Contract tier from buildSemanticContract (represents how the product entered recall)
 */
export type ContractTier = "exact" | "related" | "weak" | "bad" | "blocked";

/**
 * Normalized product metadata post-hydration
 */
export interface NormalizedProduct {
  normalizedFamily?: string | null;
  normalizedType?: string | null;
  normalizedSubtype?: string | null;
  normalizedColor?: string | null;
  normalizedAudience?: "men" | "women" | "unisex" | "unknown";
  normalizedMaterial?: string | null;
  normalizedStyle?: string | null;
  normalizedOccasion?: string | null;
  normalizedSilhouette?: string | null;
  /** For bottoms: detected material score (0-1). 1.0 = denim, 0.5 = unknown/generic, 0 = non-denim */
  materialScore?: number;
}

/**
 * Build a FashionIntent from simple search intent properties
 * Used during interim phase while detection pipeline is being refactored
 */
export function buildFashionIntentFromSearch(props: {
  imageMode?: ImageMode | null;
  family?: string | null;
  type?: string | null;
  subtype?: string | null;
  color?: string | null;
  audience?: "men" | "women" | "unisex" | "unknown";
  style?: string | null;
  material?: string | null;
  /** Confidence that the family was detected (0-1) */
  familyConfidence?: number;
  /** Confidence that the type was detected (0-1) */
  typeConfidence?: number;
  /** Confidence that the color was extracted (0-1) */
  colorConfidence?: number;
  /** Confidence that the audience was inferred (0-1) */
  audienceConfidence?: number;
}): FashionIntent {
  const conf = defaultConfidence();
  
  // Set confidence scores based on inputs or defaults
  if (props.familyConfidence !== undefined) conf.family = Math.max(0, Math.min(1, props.familyConfidence));
  else if (props.family) conf.family = 0.8; // Default family confidence when family provided
  
  if (props.typeConfidence !== undefined) conf.type = Math.max(0, Math.min(1, props.typeConfidence));
  else if (props.type) conf.type = 0.75; // Default type confidence when type provided
  
  if (props.colorConfidence !== undefined) conf.color = Math.max(0, Math.min(1, props.colorConfidence));
  else if (props.color) conf.color = 0.7; // Default color confidence when color provided
  
  if (props.audienceConfidence !== undefined) conf.audience = Math.max(0, Math.min(1, props.audienceConfidence));
  else if (props.audience) conf.audience = 0.7; // Default audience confidence when audience provided
  
  if (props.style) conf.style = 0.6;
  if (props.material) conf.material = 0.6;
  
  return {
    imageMode: props.imageMode ?? "worn_outfit",
    family: (props.family as any) || "unknown",
    type: props.type || "",
    subtype: props.subtype || undefined,
    color: props.color || undefined,
    audience: props.audience || "unknown",
    material: props.material || undefined,
    style: props.style || undefined,
    confidence: conf,
  };
}

/**
 * Assign match tier based on contract tier and normalized metadata alignment with FashionIntent.
 *
 * @param contractTier Tier from buildSemanticContract (exact | related | weak | bad | blocked)
 * @param product Hydrated product with normalized metadata
 * @param intent FashionIntent (structured detection result)
 * @returns Tier assignment with reason and cap
 */
export function assignMatchTier(
  contractTier: ContractTier,
  product: NormalizedProduct,
  intent: FashionIntent
): TierAssignmentResult {
  // Blocked contract tier → blocked
  if (contractTier === "blocked") {
    return {
      tier: "blocked",
      reason: "Blocked by contract (known wrong family or hard-blocked term)",
      tierCap: 0.0,
    };
  }

  // Bad contract tier → weak (product entered via fallback)
  if (contractTier === "bad") {
    const reason = buildTierReason(product, intent, "weak");
    return {
      tier: "weak" as const,
      reason: reason || "Entered via fallback (bad contract tier)",
      tierCap: 0.55,
    };
  }

  // Compute match strength: exact, strong, related, or weak
  const strength = computeMatchStrength(product, intent);

  // Map strength + contract tier to final tier
  if (contractTier === "exact") {
    if (strength === "exact") {
      return {
        tier: "exact",
        reason: buildTierReason(product, intent, "exact") || "Exact family & type match",
        tierCap: 0.94,
      };
    } else if (strength === "strong") {
      return {
        tier: "strong",
        reason: buildTierReason(product, intent, "strong") || "Strong metadata alignment",
        tierCap: 0.78,
      };
    } else if (strength === "related") {
      return {
        tier: "related",
        reason: buildTierReason(product, intent, "related") || "Related type match",
        tierCap: 0.74,
      };
    } else {
      return {
        tier: "weak",
        reason: buildTierReason(product, intent, "weak") || "Weak alignment",
        tierCap: 0.55,
      };
    }
  }

  if (contractTier === "related") {
    if (strength === "exact") {
      return {
        tier: "strong",
        reason: buildTierReason(product, intent, "strong") || "Exact match but related contract tier",
        tierCap: 0.78,
      };
    } else if (strength === "strong") {
      return {
        tier: "related",
        reason: buildTierReason(product, intent, "related") || "Related family & strong match",
        tierCap: 0.74,
      };
    } else if (strength === "related") {
      return {
        tier: "weak",
        reason: buildTierReason(product, intent, "weak") || "Related contract with related strength",
        tierCap: 0.55,
      };
    } else {
      return {
        tier: "fallback",
        reason: buildTierReason(product, intent, "fallback") || "Weak strength on related contract",
        tierCap: 0.40,
      };
    }
  }

  // contractTier === "weak"
  if (strength === "exact") {
    return {
      tier: "related",
      reason: buildTierReason(product, intent, "related") || "Exact match on weak contract",
      tierCap: 0.74,
    };
  } else if (strength === "strong") {
    return {
      tier: "weak",
      reason: buildTierReason(product, intent, "weak") || "Strong match on weak contract",
      tierCap: 0.55,
    };
  } else if (strength === "related") {
    return {
      tier: "fallback",
      reason: buildTierReason(product, intent, "fallback") || "Related match on weak contract",
      tierCap: 0.40,
    };
  } else {
    return {
      tier: "fallback",
      reason: buildTierReason(product, intent, "fallback") || "Weak match on weak contract",
      tierCap: 0.40,
    };
  }
}

/**
 * Compute match strength based on normalized metadata vs FashionIntent
 */
function computeMatchStrength(product: NormalizedProduct, intent: FashionIntent): MatchTier {
  const familyMatch = product.normalizedFamily && intent.family
    ? canonicalEq(product.normalizedFamily, intent.family)
    : false;

  // Type matching: dispatch to the family-specific equivalence function
  let typeMatch = false;
  let typeEquivalenceScore = 0;
  if (product.normalizedType && intent.type) {
    if (canonicalEq(product.normalizedType, intent.type)) {
      typeMatch = true;
      typeEquivalenceScore = 1.0;
    } else {
      const dispatchFamily = intent.family || product.normalizedFamily || "";
      typeEquivalenceScore = getTypeEquivalenceScore(dispatchFamily, intent.type, product.normalizedType);
      typeMatch = typeEquivalenceScore >= 0.85;
    }
  }

  const subtypeMatch = product.normalizedSubtype && intent.subtype
    ? canonicalEq(product.normalizedSubtype, intent.subtype)
    : false;

  const colorCompatScore = colorCompatibility(intent.color, product.normalizedColor);
  const colorMatch = colorCompatScore >= 0.8; // Exact or same-family color

  // Strict audience handling: honor `SEARCH_GENDER_UNISEX_OR` toggle from config.
  // If both product and intent specify a non-unisex audience and they differ,
  // treat as a hard mismatch (fallback) to enforce strict cross-gender restrictions.
  const genderUnisexOr = Boolean(config.search?.genderUnisexOr);
  const productAudience = product.normalizedAudience;
  const intentAudience = intent.audience;

  if (productAudience && intentAudience && productAudience !== intentAudience) {
    const productIsUnisex = productAudience === "unisex";
    const intentIsUnisex = intentAudience === "unisex";
    const unisexAccept = genderUnisexOr && (productIsUnisex || intentIsUnisex);
    if (!unisexAccept) {
      // Enforce strict audience mismatch → hard block (exclude from results)
      return "blocked";
    }
  }

  const audienceMatch = productAudience && intentAudience
    ? productAudience === intentAudience || (genderUnisexOr && (productAudience === "unisex" || intentAudience === "unisex"))
    : false;

  // Exact: family + type + (subtype or color match)
  if (familyMatch && typeMatch && (subtypeMatch || colorMatch)) {
    return "exact";
  }

  // Strong: family + type + acceptable color
  if (familyMatch && typeMatch && colorCompatScore >= 0.55) {
    return "strong";
  }

  // Strong: family + type (even if color unclear)
  if (familyMatch && typeMatch) {
    return "strong";
  }

  // Strong: bottoms with high equivalence score and good color match
  if (familyMatch && typeEquivalenceScore >= 0.85 && (subtypeMatch || colorCompatScore >= 0.55)) {
    return "strong";
  }

  // Strong: bottoms with high equivalence score (jeans for pants intent)
  if (familyMatch && typeEquivalenceScore >= 0.90) {
    return "strong";
  }

  // Related: family (or type for fallback families like "top fallback")
  if (familyMatch) {
    return "related";
  }

  // Weak: audience + style or material hint
  if (audienceMatch && (intent.style || intent.material)) {
    if (
      (product.normalizedStyle && intent.style && canonicalEq(product.normalizedStyle, intent.style)) ||
      (product.normalizedMaterial && intent.material && canonicalEq(product.normalizedMaterial, intent.material))
    ) {
      return "weak";
    }
  }

  // No match
  return "fallback";
}

/**
 * Canonical comparison: lowercase + trim
 */
function canonicalEq(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.toLowerCase().trim() === b.toLowerCase().trim();
}

/**
 * Build human-readable tier reason string
 */
function buildTierReason(product: NormalizedProduct, intent: FashionIntent, targetTier: MatchTier): string {
  const parts: string[] = [];

  if (product.normalizedFamily && intent.family && canonicalEq(product.normalizedFamily, intent.family)) {
    parts.push(`family match (${product.normalizedFamily})`);
  }

  if (product.normalizedType && intent.type) {
    if (canonicalEq(product.normalizedType, intent.type)) {
      parts.push(`type match (${product.normalizedType})`);
    } else {
      const dispatchFamily = intent.family || product.normalizedFamily || "";
      const equiv = getTypeEquivalenceScore(dispatchFamily, intent.type, product.normalizedType);
      if (equiv >= 0.85) {
        parts.push(`type equivalent (${intent.type} ≈ ${product.normalizedType})`);
      } else {
        parts.push(`type mismatch (expected ${intent.type}, got ${product.normalizedType})`);
      }
    }
  }

  if (product.normalizedSubtype && intent.subtype && canonicalEq(product.normalizedSubtype, intent.subtype)) {
    parts.push(`subtype match (${product.normalizedSubtype})`);
  }

  if (product.normalizedColor && intent.color) {
    const colorScore = colorCompatibility(intent.color, product.normalizedColor);
    if (colorScore >= 0.8) {
      parts.push(`color match (${product.normalizedColor})`);
    } else if (colorScore >= 0.55) {
      parts.push(`color compatible (${product.normalizedColor})`);
    } else {
      parts.push(`color mismatch (expected ${intent.color}, got ${product.normalizedColor})`);
    }
  } else if (intent.color) {
    parts.push(`no product color (intent: ${intent.color})`);
  }

  if (product.normalizedAudience && intent.audience) {
    if (product.normalizedAudience === intent.audience) {
      parts.push(`audience match (${product.normalizedAudience})`);
    } else if (product.normalizedAudience !== "unisex" && intent.audience !== "unisex") {
      parts.push(`audience mismatch (expected ${intent.audience}, got ${product.normalizedAudience})`);
    }
  }

  return parts.join("; ") || `Tier: ${targetTier}`;
}

/**
 * Get tier cap value (used for final score computation)
 */
export function getTierCap(tier: MatchTier): number {
  const caps: Record<MatchTier, number> = {
    exact: 0.94,
    strong: 0.78,
    related: 0.74,
    weak: 0.55,
    fallback: 0.40,
    blocked: 0.0,
  };
  return caps[tier] ?? 0.0;
}

/**
 * Get tier min threshold (used for score bucketing within tier)
 */
export function getTierMin(tier: MatchTier): number {
  const mins: Record<MatchTier, number> = {
    exact: 0.86,
    strong: 0.76,
    related: 0.62,
    weak: 0.45,
    fallback: 0.30,
    blocked: 0.0,
  };
  return mins[tier] ?? 0.0;
}

/**
 * Compute tier-based score: bounds final relevance by tier constraints
 * 
 * Tier-based scoring replaces flat relevance with tier-aware ranking:
 * - Each tier has a min/max range and a hard cap
 * - Score is clamped to [tierMin, tierCap]
 * - Within-tier sorting uses final score, then visual similarity
 * 
 * @param tier Assigned tier (exact, strong, related, weak, fallback, blocked)
 * @param visualSimilarity Base visual similarity [0,1]
 * @param typeMatch Product type matches search intent (0-1)
 * @param colorMatch Product color matches intent (0-1) 
 * @param audienceMatch Product audience matches intent (0-1)
 * @returns Score bounded to [tierMin, tierCap]
 */
export function computeTierBasedScore(params: {
  tier: MatchTier;
  visualSimilarity: number;
  typeMatch: number;
  colorMatch: number;
  audienceMatch: number;
}): number {
  if (params.tier === "blocked") {
    return 0.0;
  }

  const tierCap = getTierCap(params.tier);
  const tierMin = getTierMin(params.tier);

  // Base score is visual similarity, boosted by metadata alignment
  const baseScore = Math.max(0, Math.min(1, params.visualSimilarity));
  
  // Apply metadata boosts (up to +0.15 for perfect alignment)
  const typeBoost = Math.max(0, Math.min(1, params.typeMatch)) * 0.08;
  const colorBoost = Math.max(0, Math.min(1, params.colorMatch)) * 0.05;
  const audienceBoost = Math.max(0, Math.min(1, params.audienceMatch)) * 0.02;
  
  const rawScore = baseScore + typeBoost + colorBoost + audienceBoost;

  // Clamp to tier range [tierMin, tierCap]
  const tierBoundedScore = Math.max(tierMin, Math.min(tierCap, rawScore));
  
  return Math.max(0, Math.min(1, tierBoundedScore));
}

// Canonical normalized family names as returned by normalizeFamily() in familyGuard.ts
const CANONICAL_EXACT_FAMILIES = new Set([
  "footwear", "bags", "dresses",
]);
const CANONICAL_RELATED_FAMILIES = new Set([
  "tops", "bottoms", "outerwear", "suits", "swimwear", "activewear", "accessories", "jewellery",
]);
// Legacy singular/alternate names for backward compatibility
const LEGACY_KNOWN_FAMILIES = new Set([
  "top", "bottom", "dress", "gown", "shoe", "boot", "coat", "jacket", "blazer",
  "cardigan", "shirt", "sweater", "trouser", "pant", "sock", "jeans", "blouse",
  "bag", "suit", "tuxedo", "swimsuit",
]);

/**
 * Infer contract tier from product metadata (for kNN products without explicit _recallChannel).
 * Uses canonical normalized plural family names that normalizeFamily() in familyGuard.ts produces.
 */
export function inferContractTierFromProduct(
  normalizedFamily: string | null | undefined,
  normalizedType: string | null | undefined,
  _detectionCategory: string | null | undefined
): ContractTier {
  if (!normalizedFamily && !normalizedType) {
    return "weak";
  }

  const fam = String(normalizedFamily ?? "").toLowerCase().trim();

  if (fam) {
    // Exact tier: families with reliable type metadata (footwear, bags, dresses have clear type taxonomy)
    if (normalizedType && CANONICAL_EXACT_FAMILIES.has(fam)) {
      return "exact";
    }
    // Related tier: canonical apparel families (plural normalized forms)
    if (CANONICAL_RELATED_FAMILIES.has(fam)) {
      return "related";
    }
    // Related tier: legacy singular/alternate forms
    if (LEGACY_KNOWN_FAMILIES.has(fam)) {
      return "related";
    }
  }

  return "weak";
}
