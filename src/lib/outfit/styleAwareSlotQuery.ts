/**
 * Style-Aware Slot Query Generator
 *
 * Maps (aesthetic + occasion + slot) to specific product search terms so
 * OpenSearch retrieval candidates are aesthetically appropriate rather than
 * generic category matches.
 *
 * Example: bohemian dress + shoes → ["strappy sandals","espadrilles","woven sandals"]
 *          streetwear hoodie + shoes → ["chunky sneakers","skate shoes","high top sneakers"]
 *          classic blazer + shoes   → ["loafers","kitten heels","pointed toe flats"]
 */

export type FashionAesthetic =
  | "classic"
  | "modern"
  | "bohemian"
  | "minimalist"
  | "streetwear"
  | "romantic"
  | "edgy"
  | "sporty"
  | null;

export type OutfitOccasion =
  | "formal"
  | "semi-formal"
  | "casual"
  | "active"
  | "party"
  | "beach";

export type WeatherContext = "hot" | "warm" | "cool" | "cold";

export interface StyleSlotQuery {
  /** High-value search terms — boosted should clauses in OpenSearch */
  primaryTerms: string[];
  /** Secondary terms — lower boost */
  boostTerms: string[];
  /** Aesthetically wrong combinations — used for soft scoring penalty */
  avoidTerms: string[];
}

type OccasionSpec = StyleSlotQuery;
type AestheticSlotMap = Partial<Record<string, OccasionSpec>>;

// ============================================================================
// Core lookup: slot → aesthetic → occasion/default → terms
// ============================================================================

const SLOT_AESTHETIC_TERMS: Record<string, Partial<Record<string, AestheticSlotMap>>> = {
  shoes: {
    streetwear: {
      casual: {
        primaryTerms: ["chunky sneakers", "skate shoes", "canvas sneakers", "high top sneakers", "platform sneakers"],
        boostTerms: ["low top sneakers", "dad shoes", "basketball shoes", "slip-on sneakers"],
        avoidTerms: ["heels", "pumps", "loafers", "dress shoes", "kitten heel"],
      },
      active: {
        primaryTerms: ["running shoes", "athletic trainers", "gym shoes", "performance sneakers"],
        boostTerms: ["trail shoes", "cross trainers"],
        avoidTerms: ["heels", "sandals", "loafers"],
      },
      party: {
        primaryTerms: ["platform sneakers", "white sneakers", "chunky sneakers"],
        boostTerms: ["slip-on sneakers"],
        avoidTerms: [],
      },
      default: {
        primaryTerms: ["sneakers", "canvas shoes", "athletic shoes"],
        boostTerms: [],
        avoidTerms: ["heels", "pumps", "dress shoes"],
      },
    },
    bohemian: {
      casual: {
        primaryTerms: ["strappy sandals", "espadrilles", "woven sandals", "braided sandals", "ankle strap sandals"],
        boostTerms: ["platform sandals", "mules", "wedge sandals", "flat sandals"],
        avoidTerms: ["sneakers", "heels", "chunky boots"],
      },
      beach: {
        primaryTerms: ["strappy sandals", "flat sandals", "espadrilles", "slide sandals"],
        boostTerms: ["flip flops", "woven sandals"],
        avoidTerms: ["boots", "sneakers", "heels"],
      },
      "semi-formal": {
        primaryTerms: ["wedge sandals", "strappy heels", "ankle strap heels"],
        boostTerms: ["mules", "block heels"],
        avoidTerms: ["sneakers", "chunky boots"],
      },
      default: {
        primaryTerms: ["sandals", "espadrilles", "ankle strap sandals"],
        boostTerms: ["mules", "flat sandals"],
        avoidTerms: [],
      },
    },
    classic: {
      formal: {
        primaryTerms: ["pointed toe heels", "stiletto heels", "court shoes", "pumps", "kitten heels"],
        boostTerms: ["strappy heels", "block heels"],
        avoidTerms: ["sneakers", "flat sandals", "chunky boots"],
      },
      "semi-formal": {
        primaryTerms: ["loafers", "kitten heels", "pointed flats", "oxford shoes", "ballet flats"],
        boostTerms: ["block heels", "court shoes", "mules"],
        avoidTerms: ["chunky sneakers", "platform shoes"],
      },
      casual: {
        primaryTerms: ["loafers", "ballet flats", "white sneakers", "leather sneakers"],
        boostTerms: ["mules", "pointed flats"],
        avoidTerms: ["chunky sneakers", "platform shoes"],
      },
      party: {
        primaryTerms: ["strappy heels", "mules", "pointed toe heels", "heels"],
        boostTerms: ["kitten heels", "block heels"],
        avoidTerms: ["sneakers"],
      },
      default: {
        primaryTerms: ["loafers", "heels", "ballet flats"],
        boostTerms: ["pointed toe flats", "mules"],
        avoidTerms: [],
      },
    },
    minimalist: {
      casual: {
        primaryTerms: ["white sneakers", "clean sneakers", "leather sneakers", "slip-on shoes"],
        boostTerms: ["simple flats", "loafers"],
        avoidTerms: ["embellished shoes", "platform shoes"],
      },
      "semi-formal": {
        primaryTerms: ["pointed flats", "simple heels", "minimalist loafers", "clean pumps"],
        boostTerms: ["mules", "ankle strap flats"],
        avoidTerms: ["embellished", "platform", "chunky"],
      },
      default: {
        primaryTerms: ["clean sneakers", "simple flats", "minimalist shoes"],
        boostTerms: [],
        avoidTerms: ["embellished", "platform"],
      },
    },
    romantic: {
      casual: {
        primaryTerms: ["ballet flats", "strappy sandals", "kitten heels", "mary jane shoes"],
        boostTerms: ["ankle strap flats", "delicate heels"],
        avoidTerms: ["chunky boots", "platform sneakers"],
      },
      "semi-formal": {
        primaryTerms: ["strappy heels", "kitten heels", "mary jane heels", "ankle strap heels"],
        boostTerms: ["block heels", "lace-up heels"],
        avoidTerms: ["sneakers", "chunky shoes"],
      },
      party: {
        primaryTerms: ["strappy heels", "satin heels", "embellished heels", "lace heels"],
        boostTerms: ["bow heels", "sparkle heels"],
        avoidTerms: ["sneakers", "flat shoes"],
      },
      default: {
        primaryTerms: ["delicate heels", "strappy sandals", "ballet flats"],
        boostTerms: [],
        avoidTerms: [],
      },
    },
    edgy: {
      casual: {
        primaryTerms: ["combat boots", "platform boots", "chunky ankle boots", "lug sole boots"],
        boostTerms: ["moto boots", "chelsea boots", "chunky sneakers"],
        avoidTerms: ["ballet flats", "kitten heels"],
      },
      party: {
        primaryTerms: ["platform heels", "chunky heels", "ankle boots", "block heel boots"],
        boostTerms: ["knee high boots", "strappy platform"],
        avoidTerms: ["ballet flats", "simple flats"],
      },
      default: {
        primaryTerms: ["combat boots", "ankle boots", "platform boots"],
        boostTerms: ["chunky shoes"],
        avoidTerms: ["ballet flats", "simple heels"],
      },
    },
    sporty: {
      active: {
        primaryTerms: ["running shoes", "athletic trainers", "cross trainers", "gym shoes", "performance sneakers"],
        boostTerms: ["trail running shoes", "workout shoes"],
        avoidTerms: ["heels", "sandals", "loafers"],
      },
      casual: {
        primaryTerms: ["athletic sneakers", "trainers", "sports shoes", "low top sneakers"],
        boostTerms: ["canvas shoes", "athletic shoes"],
        avoidTerms: ["heels", "loafers"],
      },
      default: {
        primaryTerms: ["trainers", "athletic shoes", "sneakers"],
        boostTerms: [],
        avoidTerms: ["heels", "dress shoes"],
      },
    },
    modern: {
      casual: {
        primaryTerms: ["white sneakers", "mules", "loafers", "minimalist sneakers"],
        boostTerms: ["slip-on shoes", "leather sneakers"],
        avoidTerms: [],
      },
      "semi-formal": {
        primaryTerms: ["pointed heels", "mules", "loafers", "ankle boots"],
        boostTerms: ["block heels", "kitten heels"],
        avoidTerms: [],
      },
      default: {
        primaryTerms: ["white sneakers", "mules", "loafers"],
        boostTerms: [],
        avoidTerms: [],
      },
    },
  },

  bags: {
    streetwear: {
      casual: {
        primaryTerms: ["backpack", "mini backpack", "crossbody bag", "tote bag"],
        boostTerms: ["shoulder bag", "fanny pack", "belt bag"],
        avoidTerms: ["clutch", "evening bag", "formal handbag"],
      },
      default: {
        primaryTerms: ["backpack", "crossbody", "tote"],
        boostTerms: ["fanny pack"],
        avoidTerms: ["clutch", "evening bag"],
      },
    },
    bohemian: {
      casual: {
        primaryTerms: ["woven bag", "straw bag", "fringe bag", "basket bag"],
        boostTerms: ["shoulder bag", "tote bag"],
        avoidTerms: ["formal clutch", "structured handbag"],
      },
      beach: {
        primaryTerms: ["straw tote", "woven beach bag", "basket bag", "canvas tote"],
        boostTerms: ["shoulder tote", "straw bag"],
        avoidTerms: ["formal handbag", "clutch"],
      },
      default: {
        primaryTerms: ["straw bag", "woven bag", "shoulder bag"],
        boostTerms: [],
        avoidTerms: [],
      },
    },
    classic: {
      formal: {
        primaryTerms: ["top handle bag", "structured handbag", "leather clutch", "evening bag", "satchel"],
        boostTerms: ["mini bag", "chain bag"],
        avoidTerms: ["backpack", "canvas tote", "fanny pack"],
      },
      "semi-formal": {
        primaryTerms: ["structured handbag", "leather tote", "satchel", "top handle bag"],
        boostTerms: ["shoulder bag", "crossbody"],
        avoidTerms: ["backpack", "fanny pack"],
      },
      casual: {
        primaryTerms: ["leather tote", "structured crossbody", "leather shoulder bag"],
        boostTerms: ["mini bag", "satchel"],
        avoidTerms: ["backpack"],
      },
      party: {
        primaryTerms: ["leather clutch", "chain bag", "mini bag", "evening bag"],
        boostTerms: ["satin bag", "structured clutch"],
        avoidTerms: ["backpack", "canvas tote"],
      },
      default: {
        primaryTerms: ["structured handbag", "leather tote", "satchel"],
        boostTerms: [],
        avoidTerms: [],
      },
    },
    minimalist: {
      casual: {
        primaryTerms: ["minimalist tote", "clean crossbody", "simple shoulder bag", "canvas tote"],
        boostTerms: ["leather tote", "plain bag"],
        avoidTerms: ["embellished bag", "fringe bag"],
      },
      default: {
        primaryTerms: ["simple tote", "plain bag", "minimalist bag"],
        boostTerms: [],
        avoidTerms: ["embellished"],
      },
    },
    romantic: {
      casual: {
        primaryTerms: ["quilted bag", "floral bag", "mini bag", "pastel bag"],
        boostTerms: ["chain strap bag", "square bag"],
        avoidTerms: ["backpack", "sporty bag"],
      },
      party: {
        primaryTerms: ["satin clutch", "embellished bag", "pearl bag", "sparkle bag"],
        boostTerms: ["chain bag", "beaded bag"],
        avoidTerms: ["backpack", "tote"],
      },
      default: {
        primaryTerms: ["quilted bag", "chain bag", "feminine bag"],
        boostTerms: [],
        avoidTerms: [],
      },
    },
    edgy: {
      casual: {
        primaryTerms: ["chain bag", "studded bag", "leather crossbody", "moto bag"],
        boostTerms: ["mini bag", "bucket bag"],
        avoidTerms: ["straw bag", "canvas tote"],
      },
      default: {
        primaryTerms: ["studded bag", "chain bag", "leather bag"],
        boostTerms: [],
        avoidTerms: ["straw bag"],
      },
    },
    sporty: {
      active: {
        primaryTerms: ["gym bag", "sports bag", "drawstring bag", "athletic backpack"],
        boostTerms: ["waist bag", "fanny pack"],
        avoidTerms: ["clutch", "formal handbag"],
      },
      casual: {
        primaryTerms: ["backpack", "sports backpack", "tote bag"],
        boostTerms: ["crossbody", "shoulder bag"],
        avoidTerms: ["clutch", "formal bag"],
      },
      default: {
        primaryTerms: ["backpack", "sports bag", "gym bag"],
        boostTerms: [],
        avoidTerms: ["clutch"],
      },
    },
  },

  accessories: {
    streetwear: {
      casual: {
        primaryTerms: ["cap", "baseball cap", "bucket hat", "beanie", "sunglasses"],
        boostTerms: ["snapback", "chain necklace"],
        avoidTerms: ["pearl jewelry", "dainty necklace", "fine jewelry"],
      },
      default: {
        primaryTerms: ["cap", "beanie", "sunglasses"],
        boostTerms: [],
        avoidTerms: ["pearl jewelry", "fine jewelry"],
      },
    },
    bohemian: {
      casual: {
        primaryTerms: ["layered necklace", "statement earrings", "beaded bracelet", "boho jewelry", "fringe earrings"],
        boostTerms: ["anklet", "floral headband", "woven belt"],
        avoidTerms: ["minimal jewelry", "structured belt"],
      },
      default: {
        primaryTerms: ["layered necklace", "statement earrings", "boho jewelry"],
        boostTerms: [],
        avoidTerms: [],
      },
    },
    classic: {
      formal: {
        primaryTerms: ["pearl earrings", "gold earrings", "diamond earrings", "pearl necklace", "gold necklace"],
        boostTerms: ["pearl bracelet", "gold watch", "fine jewelry"],
        avoidTerms: ["chunky jewelry", "oversized accessories"],
      },
      "semi-formal": {
        primaryTerms: ["gold earrings", "dainty necklace", "gold watch", "simple bracelet"],
        boostTerms: ["pearl jewelry", "minimalist jewelry"],
        avoidTerms: ["chunky accessories"],
      },
      default: {
        primaryTerms: ["pearl jewelry", "gold earrings", "dainty jewelry"],
        boostTerms: [],
        avoidTerms: [],
      },
    },
    minimalist: {
      casual: {
        primaryTerms: ["minimalist earrings", "simple ring", "plain watch", "thin necklace"],
        boostTerms: ["stud earrings", "delicate bracelet"],
        avoidTerms: ["chunky jewelry", "statement accessories"],
      },
      default: {
        primaryTerms: ["minimalist jewelry", "simple earrings", "thin necklace"],
        boostTerms: [],
        avoidTerms: ["chunky", "statement"],
      },
    },
    romantic: {
      casual: {
        primaryTerms: ["floral earrings", "dainty necklace", "pearl earrings", "rose gold jewelry"],
        boostTerms: ["bow earrings", "delicate bracelet"],
        avoidTerms: ["chunky chain", "sporty accessories"],
      },
      party: {
        primaryTerms: ["chandelier earrings", "crystal earrings", "statement necklace", "sparkle accessories"],
        boostTerms: ["hair clip", "embellished headband"],
        avoidTerms: ["sporty accessories"],
      },
      default: {
        primaryTerms: ["floral earrings", "pearl jewelry", "delicate necklace"],
        boostTerms: [],
        avoidTerms: [],
      },
    },
    edgy: {
      casual: {
        primaryTerms: ["chunky chain", "studded earrings", "ring set", "leather cuff", "ear cuff"],
        boostTerms: ["spike earrings", "layered chain"],
        avoidTerms: ["dainty jewelry", "pearl earrings", "floral accessories"],
      },
      default: {
        primaryTerms: ["chunky jewelry", "studded accessories", "chain necklace"],
        boostTerms: [],
        avoidTerms: ["dainty jewelry", "pearl"],
      },
    },
    sporty: {
      active: {
        primaryTerms: ["sport watch", "fitness tracker", "athletic sunglasses", "sports headband"],
        boostTerms: ["running cap"],
        avoidTerms: ["formal jewelry"],
      },
      casual: {
        primaryTerms: ["sport watch", "cap", "sunglasses", "minimalist watch"],
        boostTerms: ["bracelet", "snapback"],
        avoidTerms: ["formal jewelry"],
      },
      default: {
        primaryTerms: ["sport watch", "cap", "sunglasses"],
        boostTerms: [],
        avoidTerms: [],
      },
    },
  },

  outerwear: {
    streetwear: {
      casual: {
        primaryTerms: ["oversized jacket", "bomber jacket", "track jacket", "puffer jacket", "parka"],
        boostTerms: ["windbreaker", "fleece jacket"],
        avoidTerms: ["blazer", "formal coat", "trench coat"],
      },
      default: {
        primaryTerms: ["bomber jacket", "puffer jacket", "track jacket"],
        boostTerms: [],
        avoidTerms: ["blazer"],
      },
    },
    bohemian: {
      casual: {
        primaryTerms: ["kimono jacket", "denim jacket", "oversized cardigan", "suede jacket"],
        boostTerms: ["wrap jacket", "floral jacket"],
        avoidTerms: ["blazer", "puffer jacket"],
      },
      default: {
        primaryTerms: ["kimono", "denim jacket", "oversized cardigan"],
        boostTerms: [],
        avoidTerms: [],
      },
    },
    classic: {
      "semi-formal": {
        primaryTerms: ["trench coat", "wool coat", "blazer", "tailored jacket"],
        boostTerms: ["camel coat", "double breasted coat"],
        avoidTerms: ["hoodie", "puffer jacket"],
      },
      casual: {
        primaryTerms: ["trench coat", "denim jacket", "blazer", "knit cardigan"],
        boostTerms: ["wool coat", "camel coat"],
        avoidTerms: ["puffer jacket", "track jacket"],
      },
      formal: {
        primaryTerms: ["tailored coat", "wool blazer", "double breasted coat"],
        boostTerms: ["structured jacket"],
        avoidTerms: ["puffer", "hoodie"],
      },
      default: {
        primaryTerms: ["trench coat", "blazer", "tailored coat"],
        boostTerms: [],
        avoidTerms: [],
      },
    },
    minimalist: {
      default: {
        primaryTerms: ["clean coat", "minimalist blazer", "simple jacket", "monochrome coat"],
        boostTerms: ["trench coat", "wrap coat"],
        avoidTerms: ["embellished jacket", "sequin jacket"],
      },
    },
    edgy: {
      default: {
        primaryTerms: ["leather jacket", "moto jacket", "biker jacket", "faux leather jacket"],
        boostTerms: ["oversized jacket", "distressed jacket"],
        avoidTerms: ["formal coat", "preppy blazer"],
      },
    },
    sporty: {
      default: {
        primaryTerms: ["sports jacket", "windbreaker", "athletic jacket", "fleece jacket"],
        boostTerms: ["track jacket", "running jacket"],
        avoidTerms: ["blazer", "formal coat"],
      },
    },
    romantic: {
      default: {
        primaryTerms: ["lace cardigan", "feminine jacket", "floral jacket", "velvet blazer"],
        boostTerms: ["wrap cardigan", "ruffled jacket"],
        avoidTerms: ["puffer jacket", "track jacket"],
      },
    },
  },

  tops: {
    streetwear: {
      default: {
        primaryTerms: ["graphic tee", "oversized tshirt", "printed tee", "band tee", "streetwear top"],
        boostTerms: ["logo tshirt", "crop tee"],
        avoidTerms: ["formal blouse", "silk top"],
      },
    },
    bohemian: {
      default: {
        primaryTerms: ["flowy blouse", "peasant top", "embroidered blouse", "linen top", "crochet top"],
        boostTerms: ["wrap top", "smocked top", "off shoulder top"],
        avoidTerms: ["formal blouse", "structured shirt"],
      },
    },
    classic: {
      "semi-formal": {
        primaryTerms: ["silk blouse", "button down shirt", "tailored blouse", "crisp shirt"],
        boostTerms: ["oxford shirt", "classic white shirt"],
        avoidTerms: ["graphic tee", "oversized tshirt"],
      },
      casual: {
        primaryTerms: ["classic shirt", "simple tshirt", "polo shirt", "clean top"],
        boostTerms: ["striped shirt", "plain top"],
        avoidTerms: ["graphic tee"],
      },
      default: {
        primaryTerms: ["classic shirt", "tailored blouse", "simple top"],
        boostTerms: [],
        avoidTerms: [],
      },
    },
    minimalist: {
      default: {
        primaryTerms: ["simple tshirt", "plain top", "minimalist blouse", "basic top", "white shirt"],
        boostTerms: ["neutral top", "clean top"],
        avoidTerms: ["graphic tee", "embellished", "printed"],
      },
    },
    romantic: {
      default: {
        primaryTerms: ["lace top", "floral blouse", "ruffle blouse", "satin top", "feminine top"],
        boostTerms: ["bow top", "puff sleeve top"],
        avoidTerms: ["graphic tee", "sporty top"],
      },
    },
    edgy: {
      default: {
        primaryTerms: ["mesh top", "graphic tee", "crop top", "asymmetric top", "cutout top"],
        boostTerms: ["band tee", "chain detail top"],
        avoidTerms: ["feminine blouse", "floral top"],
      },
    },
    sporty: {
      default: {
        primaryTerms: ["athletic top", "sports tshirt", "performance top", "workout top"],
        boostTerms: ["moisture wicking top", "polo shirt"],
        avoidTerms: ["formal blouse", "silk top"],
      },
    },
  },

  bottoms: {
    streetwear: {
      default: {
        primaryTerms: ["cargo pants", "joggers", "baggy jeans", "wide leg jeans", "track pants"],
        boostTerms: ["ripped jeans", "barrel jeans"],
        avoidTerms: ["formal trousers", "pencil skirt"],
      },
    },
    bohemian: {
      default: {
        primaryTerms: ["flowy skirt", "maxi skirt", "linen pants", "wide leg pants", "floral skirt"],
        boostTerms: ["midi skirt", "wrap skirt", "palazzo pants"],
        avoidTerms: ["skinny jeans", "formal trousers"],
      },
    },
    classic: {
      "semi-formal": {
        primaryTerms: ["tailored trousers", "straight leg pants", "pencil skirt", "midi skirt"],
        boostTerms: ["wide leg trousers", "pleated trousers"],
        avoidTerms: ["ripped jeans", "cargo pants", "track pants"],
      },
      casual: {
        primaryTerms: ["straight leg jeans", "chinos", "simple trousers"],
        boostTerms: ["wide leg pants", "midi skirt"],
        avoidTerms: ["ripped jeans", "cargo pants"],
      },
      default: {
        primaryTerms: ["tailored trousers", "straight jeans", "pencil skirt"],
        boostTerms: [],
        avoidTerms: [],
      },
    },
    minimalist: {
      default: {
        primaryTerms: ["simple trousers", "straight leg pants", "wide leg pants", "neutral jeans"],
        boostTerms: ["clean cut pants"],
        avoidTerms: ["ripped jeans", "embellished", "printed"],
      },
    },
    romantic: {
      default: {
        primaryTerms: ["floral skirt", "midi skirt", "A-line skirt", "pleated skirt"],
        boostTerms: ["ruffle skirt", "flowy pants", "lace skirt"],
        avoidTerms: ["cargo pants", "track pants", "ripped jeans"],
      },
    },
    edgy: {
      default: {
        primaryTerms: ["leather pants", "ripped jeans", "cargo pants", "black jeans", "vinyl pants"],
        boostTerms: ["wide leg jeans", "distressed jeans"],
        avoidTerms: ["floral skirt", "lace skirt"],
      },
    },
    sporty: {
      default: {
        primaryTerms: ["joggers", "athletic shorts", "track pants", "leggings", "sports shorts"],
        boostTerms: ["performance pants", "sweatpants"],
        avoidTerms: ["formal trousers", "pencil skirt"],
      },
    },
  },
};

// ============================================================================
// Weather overrides
// ============================================================================

const WEATHER_SLOT_OVERRIDES: Partial<Record<WeatherContext, Partial<Record<string, string[]>>>> = {
  hot: {
    shoes: ["sandals", "open toe shoes", "slides"],
    bags: ["straw bag", "canvas tote", "woven bag"],
    accessories: ["sunglasses", "sun hat", "cap", "lightweight jewelry"],
    outerwear: [], // empty → suppress outerwear in hot weather
  },
  warm: {
    shoes: ["sandals", "sneakers", "loafers", "mules"],
    accessories: ["sunglasses", "cap", "hat", "lightweight jewelry"],
  },
  cool: {
    shoes: ["closed toe shoes", "boots", "loafers"],
    outerwear: ["light jacket", "denim jacket", "cardigan", "trench coat"],
  },
  cold: {
    shoes: ["boots", "ankle boots", "knee high boots"],
    outerwear: ["coat", "puffer jacket", "heavy coat", "winter coat", "wool coat"],
  },
};

// ============================================================================
// Public API
// ============================================================================

/**
 * Returns aesthetically-specific product search terms for a given outfit slot.
 * Returns empty arrays when no match exists (caller falls back to generic query).
 */
export function getStyleAwareSlotTerms(params: {
  aesthetic: FashionAesthetic;
  occasion: OutfitOccasion;
  sourceCategory: string;
  targetSlot: string;
  weather?: WeatherContext;
}): StyleSlotQuery {
  const { aesthetic, occasion, targetSlot, weather } = params;

  const empty: StyleSlotQuery = { primaryTerms: [], boostTerms: [], avoidTerms: [] };
  if (!aesthetic) return empty;

  const slotMap = SLOT_AESTHETIC_TERMS[targetSlot];
  if (!slotMap) return empty;

  const aestheticMap = slotMap[aesthetic];
  if (!aestheticMap) return empty;

  const spec = (aestheticMap[occasion] ?? aestheticMap["default"]) as OccasionSpec | undefined;
  if (!spec) return empty;

  const result: StyleSlotQuery = {
    primaryTerms: [...spec.primaryTerms],
    boostTerms: [...spec.boostTerms],
    avoidTerms: [...spec.avoidTerms],
  };

  // Apply weather overrides (merge or suppress)
  if (weather) {
    const overrides = WEATHER_SLOT_OVERRIDES[weather];
    if (overrides) {
      const slotOverride = overrides[targetSlot];
      if (Array.isArray(slotOverride)) {
        if (slotOverride.length === 0) {
          // Suppress slot entirely for this weather (e.g. no outerwear in hot)
          result.primaryTerms = [];
          result.boostTerms = [];
        } else {
          // Prepend weather terms so they rank highest
          result.primaryTerms = [...new Set([...slotOverride, ...result.primaryTerms])];
        }
      }
    }
  }

  return result;
}

/**
 * Converts temperature + season into a coarse WeatherContext bucket.
 */
export function resolveWeatherContext(temperatureC?: number, season?: string): WeatherContext | undefined {
  if (temperatureC != null) {
    if (temperatureC > 25) return "hot";
    if (temperatureC > 18) return "warm";
    if (temperatureC > 10) return "cool";
    return "cold";
  }
  if (season === "summer") return "hot";
  if (season === "winter") return "cold";
  if (season === "fall") return "cool";
  if (season === "spring") return "warm";
  return undefined;
}
