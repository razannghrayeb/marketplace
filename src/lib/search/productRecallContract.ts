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
    .replace(/shirts/g, "shirt")
    .replace(/pants/g, "pant")
    .trim();
}

function containsEquivalent(term: string, list: string[]): boolean {
  const x = canonType(term);
  return list.some((item) => {
    const y = canonType(item);
    return x === y || x.includes(y) || y.includes(x);
  });
}

function pickDesired(desired: string[], re: RegExp): string[] {
  return uniq(desired.filter((term) => re.test(String(term).toLowerCase().trim())));
}

function includesAny(blob: string, re: RegExp): boolean {
  return re.test(blob);
}

function strictBottomsContract(): ProductRecallContract {
  return {
    exactTypes: [
      "wide leg trouser",
      "wide leg pants",
      "tailored trouser",
      "dress pants",
      "pleated trousers",
    ],
    relatedTypes: ["straight pants", "loose pants", "chinos"],
    weakTypes: ["jeans", "cargo pants", "utility pants"],
    badTypes: ["jogger", "sweatpants", "shorts", "skirt"],
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
      "blouse",
    ],
    relatedTypes: ["overshirt", "long sleeve top"],
    weakTypes: ["cardigan", "sweater", "sweatshirt", "hoodie"],
    badTypes: ["pants", "trousers", "dress", "shoe", "bag"],
    blockedFamilies: ["bottoms", "dresses", "footwear", "bags", "accessories"],
  };
}

function strictSweaterContract(): ProductRecallContract {
  return {
    exactTypes: ["sweater", "pullover", "knit pullover", "turtleneck sweater", "knitwear"],
    relatedTypes: ["cardigan", "long sleeve top"],
    weakTypes: ["hoodie", "sweatshirt"],
    badTypes: ["pants", "trousers", "dress", "shoe", "bag"],
    blockedFamilies: ["bottoms", "dresses", "footwear", "bags", "accessories"],
  };
}

function strictDressesContract(): ProductRecallContract {
  return {
    exactTypes: ["dress", "maxi dress", "midi dress", "mini dress", "wrap dress"],
    relatedTypes: ["sundress", "shirt dress"],
    weakTypes: ["jumpsuit", "romper"],
    badTypes: ["shirt", "blouse", "pants", "trousers", "shoe", "bag"],
    blockedFamilies: ["tops", "bottoms", "footwear", "bags", "accessories"],
  };
}

function strictTopFallbackContract(): ProductRecallContract {
  return {
    exactTypes: ["top", "shirt", "blouse", "tee", "tshirt", "sleeveless_top"],
    relatedTypes: ["long sleeve top", "overshirt"],
    weakTypes: ["sweater", "cardigan", "hoodie", "sweatshirt"],
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
    const footwearExact = pickDesired(desired, /\b(shoe|shoes|sneaker|sneakers|trainer|trainers|boot|boots|loafer|loafers|flat|flats|sandal|sandals|heel|heels|pump|pumps|oxford|oxfords)\b/);
    const contract = {
      exactTypes: uniq(["sneaker", "low top sneaker", "trainer", "shoe", ...footwearExact]),
      relatedTypes: uniq(["casual shoe"]),
      weakTypes: uniq(["loafer", "flat"]),
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
  const exact = Math.max(1, Math.round(safeTotal * 0.5));
  const related = Math.max(0, Math.round(safeTotal * 0.25));
  const visual = Math.max(1, safeTotal - exact - related);
  return { exact, related, visual };
}
