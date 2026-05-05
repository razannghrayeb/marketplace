import { getCategorySearchTerms } from "./categoryFilter";

export interface ProductRecallContract {
  exactTypes: string[];
  relatedTypes: string[];
  weakTypes: string[];
  badTypes: string[];
  blockedFamilies: string[];
}

function uniq(values: string[]): string[] {
  return [...new Set(values.map((v) => String(v).toLowerCase().trim()).filter(Boolean))];
}

function canonType(t: string): string {
  return String(t)
    .toLowerCase()
    .replace(/[\s_-]+/g, "")
    .replace(/tshirts?/g, "tshirt")
    .replace(/tees?/g, "tshirt")
    .replace(/shirts?/g, "shirt")
    .replace(/pants?/g, "pant")
    .replace(/trousers?/g, "trouser")
    .replace(/dresses?/g, "dress")
    .replace(/sneakers?/g, "sneaker")
    .replace(/shoes?/g, "shoe")
    .trim();
}

function containsEquivalent(term: string, list: string[]): boolean {
  const x = canonType(term);
  return list.some((item) => {
    const y = canonType(item);
    if ((x.endsWith("pant") || x.endsWith("trouser")) && y === "dress") return false;
    if ((y.endsWith("pant") || y.endsWith("trouser")) && x === "dress") return false;
    return x === y || x.includes(y) || y.includes(x);
  });
}

function includesAny(blob: string, re: RegExp): boolean {
  return re.test(blob);
}

function strictBottomsContract(): ProductRecallContract {
  return {
    exactTypes: [
      "trousers",
      "tailored trouser",
      "wide leg trouser",
      "dress pant",
      "straight pant",
      "pleated trouser",
      "pant",
      "pants",
      "jean",
      "jeans",
      "denim",
      "legging",
      "leggings",
      "tight",
      "tights",
      "short",
      "shorts",
      "bermudas",
      "skirt",
      "skirts",
      "skort",
      "skorts",
      "culottes",
      "cargo pants",
      "joggers",
      "jogging bottoms",
      "tracksuits & track trousers",
      "chino",
      "chinos",
      "3/4 pant",
      "3/4 tight",
      "7/8 tight",
    ],
    relatedTypes: ["loose pant", "utility pants", "sweatpants", "track pants"],
    weakTypes: ["tight", "tights", "skort", "culottes", "bermuda"],
    badTypes: ["shorts", "skirt", "dress", "shirt", "shoe"],
    blockedFamilies: ["tops", "dresses", "footwear", "bags", "accessories", "outerwear"],
  };
}

function strictButtonUpShirtContract(): ProductRecallContract {
  return {
    exactTypes: [
      "button up shirt",
      "button down shirt",
      "collared shirt",
      "shirt",
      "short sleeve top",
      "blouse",
      "top",
      "tee",
      "tshirt",
      "t shirt",
      "polo",
      "polo shirt",
      "tunic",
      "tank top",
      "camisole",
      "baselayer",
      "bodysuit",
    ],
    relatedTypes: ["overshirt", "long sleeve top", "short sleeve top", "sleeveless top", "crop top", "woven shirts", "woven tops"],
    weakTypes: ["cardigan", "sweater", "sweatshirt", "hoodie", "pullover", "knitwear"],
    badTypes: ["pants", "trousers", "dress", "shoe", "bag"],
    blockedFamilies: ["bottoms", "dresses", "footwear", "bags", "accessories"],
  };
}

function strictSweaterContract(): ProductRecallContract {
  return {
    exactTypes: ["sweater", "pullover", "knit pullover", "turtleneck sweater", "knitwear", "jumper", "cardigan", "hoodie", "sweatshirt","t-shirt"],
    relatedTypes: ["long sleeve top", "overshirt", "baselayer"],
    weakTypes: ["tank top", "tee", "shirt"],
    badTypes: ["pants", "trousers", "dress", "shoe", "bag"],
    blockedFamilies: ["bottoms", "dresses", "footwear", "bags", "accessories"],
  };
}

function strictDressesContract(): ProductRecallContract {
  return {
    exactTypes: [
      "dress",
      "sleeveless dress",
      "tank dress",
      "midi dress",
      "mini dress",
      "maxi dress",
      "casual dress",
      "jumpsuit",
      "romper",
      "playsuit",
      "babydoll",
      "kaftan",
      "abaya",
      "jilbab",
    ],
    relatedTypes: ["halter dress", "sundress", "slip dress", "midi dress", "mini dress", "maxi dress"],
    weakTypes: ["gown", "kimono", "dress/top"],
    badTypes: ["tank top", "cami", "shirt", "skirt", "pants"],
    blockedFamilies: ["tops", "bottoms", "footwear", "bags", "accessories", "outerwear"],
  };
}

function strictTopFallbackContract(): ProductRecallContract {
  return {
    exactTypes: [
      "top",
      "shirt",
      "short sleeve top",
      "blouse",
      "tee",
      "tshirt",
      "sleeveless_top",
      "tank top",
      "camisole",
      "polo",
      "polo shirt",
      "crop top",
      "basic top",
      "long sleeve",
      "short sleeve",
      "baselayer",
      "bodysuit",
      "track top",
      "loungewear",
    ],
    relatedTypes: ["long sleeve top", "overshirt", "knit top", "woven tops", "woven shirts", "shirt men", "women shirt", "men shirt"],
    weakTypes: ["sweater", "cardigan", "hoodie", "sweatshirt", "pullover", "jumper", "knitwear", "rugby shirts"],
    badTypes: ["pants", "trousers", "dress", "shoe", "bag"],
    blockedFamilies: ["bottoms", "dresses", "footwear", "bags", "accessories"],
  };
}

export function buildProductRecallContract(params: {
  desiredProductTypes: string[];
  detectionCategory?: string;
}): ProductRecallContract {
  const desired = uniq(params.desiredProductTypes);
  const category = String(params.detectionCategory ?? "").toLowerCase().trim();
  const blob = [category, ...desired].join(" ");

  // Footwear contract
  if (category === "footwear" || includesAny(blob, /\b(shoe|shoes|sneaker|trainer|boot|loafer|flat|sandal|heel|pump|oxford)\b/)) {
    const footwearContract = (() => {
      if (includesAny(blob, /\b(sneaker|sneakers|trainer|trainers|running\s*shoe|low\s*top)\b/)) {
        return {
          exactTypes: ["sneaker", "low top sneaker", "trainer", "running shoe", "athletic shoe", "sport shoe", "tennis shoe"],
          relatedTypes: ["shoe", "casual shoe", "trainers", "sneakers"],
          weakTypes: ["boot", "loafer", "flat", "sandal", "heel", "mule", "slide"],
        };
      }
      if (includesAny(blob, /\b(boot|boots|chelsea|ankle\s*boot)\b/)) {
        return {
          exactTypes: ["boot", "ankle boot", "chelsea boot", "ski boots", "snowboard boots", "after ski boot"],
          relatedTypes: ["shoe", "shoes", "footwear"],
          weakTypes: ["sneaker", "loafer", "flat", "sandal", "heel", "pump"],
        };
      }
      if (includesAny(blob, /\b(loafer|loafers|flat|flats|oxford|oxfords)\b/)) {
        return {
          exactTypes: ["loafer", "flat", "oxford", "ballerina", "ballerinas", "ballet flat", "ballet flats"],
          relatedTypes: ["shoe", "casual shoe", "dress shoe"],
          weakTypes: ["sneaker", "boot", "sandal", "heel", "pump"],
        };
      }
      if (includesAny(blob, /\b(sandal|sandals|heel|heels|pump|pumps)\b/)) {
        return {
          exactTypes: ["sandal", "heel", "pump", "flat sandal", "dress shoe", "espadrille", "slide", "mule"],
          relatedTypes: ["shoe", "footwear", "women shoes"],
          weakTypes: ["sneaker", "boot", "loafer", "flat", "oxford"],
        };
      }
      return {
        exactTypes: ["shoe", "footwear", "shoes"],
        relatedTypes: ["sneaker", "trainer", "boot", "loafer", "flat", "sandal", "heel", "pump", "oxford", "ballerina"],
        weakTypes: ["casual shoe", "dress shoe", "men shoes", "women shoes"],
      };
    })();
    const contract = {
      exactTypes: uniq(footwearContract.exactTypes),
      relatedTypes: uniq(footwearContract.relatedTypes),
      weakTypes: uniq(footwearContract.weakTypes),
      badTypes: uniq(["dress", "shirt", "blouse", "t-shirt", "hoodie", "pants", "trousers", "bag"]),
      blockedFamilies: ["dresses", "tops", "bottoms", "bags", "accessories", "outerwear"],
    };
    return sanitizeContract(contract);
  }

  // Sweater / knit top contract
  if (includesAny(blob, /\b(sweater|knit|pullover|jumper|knitwear)\b/)) {
    return sanitizeContract(strictSweaterContract());
  }

  // Button-up shirt contract
  if (includesAny(blob, /\b(button\s*up|button-up|button\s*down|button-down|collared shirt|shirt|blouse)\b/)) {
    return sanitizeContract(strictButtonUpShirtContract());
  }

  // Trousers contract
  if (category === "bottoms" || includesAny(blob, /\b(trouser|trousers|pant|pants|wide\s*leg|tailored|dress pant|chino|slack)\b/)) {
    return sanitizeContract(strictBottomsContract());
  }

  // Dresses contract
  if (category === "dresses" || includesAny(blob, /\b(dress|gown|frock)\b/)) {
    return sanitizeContract(strictDressesContract());
  }

  // Generic top fallback
  if (category === "tops" || includesAny(blob, /\b(top|tee|t-shirt|polo|blouse)\b/)) {
    return sanitizeContract(strictTopFallbackContract());
  }

  return sanitizeContract({
    exactTypes: [],
    relatedTypes: [],
    weakTypes: [],
    badTypes: [],
    blockedFamilies: [],
  });
}

function sanitizeContract(contract: ProductRecallContract): ProductRecallContract {
  const bad = uniq(contract.badTypes);

  const exactTypes = uniq(contract.exactTypes).filter((t) => !containsEquivalent(t, bad));
  const relatedTypes = uniq(contract.relatedTypes)
    .filter((t) => !containsEquivalent(t, bad))
    .filter((t) => !containsEquivalent(t, exactTypes));
  const weakTypes = uniq(contract.weakTypes)
    .filter((t) => !containsEquivalent(t, bad))
    .filter((t) => !containsEquivalent(t, exactTypes))
    .filter((t) => !containsEquivalent(t, relatedTypes));

  return {
    exactTypes,
    relatedTypes,
    weakTypes,
    badTypes: bad,
    blockedFamilies: uniq(contract.blockedFamilies),
  };
}

export function familyBlockTerms(families: string[]): string[] {
  const out: string[] = [];
  for (const family of families) {
    const f = String(family).toLowerCase().trim();
    if (!f) continue;
    out.push(f);
    for (const t of getCategorySearchTerms(f)) {
      out.push(String(t).toLowerCase().trim());
    }
  }
  return uniq(out);
}

export function allocateRecallBudgets(total: number): {
  exact: number;
  related: number;
  visual: number;
} {
  const safeTotal = Math.max(1, Math.floor(total));
  const visual = Math.max(1, Math.round(safeTotal * 0.6));
  const exact = Math.max(1, Math.round(safeTotal * 0.25));
  const related = Math.max(0, safeTotal - visual - exact);
  return { exact, related, visual };
}
