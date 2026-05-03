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
  return String(t).toLowerCase().replace(/[\s_-]+/g, "").trim();
}

function isBadEquivalent(term: string, badTypes: string[]): boolean {
  const x = canonType(term);
  return badTypes.some((bad) => {
    const y = canonType(bad);
    return x === y || x.includes(y) || y.includes(x);
  });
}

function pickDesired(desired: string[], re: RegExp): string[] {
  return uniq(desired.filter((term) => re.test(String(term).toLowerCase().trim())));
}

function includesAny(blob: string, re: RegExp): boolean {
  return re.test(blob);
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
    const sweaterExact = pickDesired(desired, /\b(sweater|sweaters|pullover|pullovers|jumper|jumpers|knitwear|knitted|knit)\b/);
    const contract = {
      exactTypes: uniq(["sweater", "pullover", "jumper", "knitwear", "knitted", ...sweaterExact]),
      relatedTypes: uniq(["turtleneck", "cardigan"]),
      weakTypes: uniq(["sweatshirt", "hoodie"]),
      badTypes: uniq(["shirt", "blouse", "button down", "polo", "t-shirt", "short sleeve top"]),
      blockedFamilies: ["dresses", "bottoms", "footwear", "bags", "accessories"],
    };
    return sanitizeContract(contract);
  }

  // Button-up shirt contract
  if (includesAny(blob, /\b(button\s*up|button-up|button\s*down|button-down|collared shirt|shirt|blouse)\b/)) {
    const shirtExact = pickDesired(desired, /\b(shirt|shirts|button[-\s]*up|button[-\s]*down|collared shirt|blouse|blouses|top|tops)\b/);
    const contract = {
      exactTypes: uniq(["shirt", "button-up", "button down", "blouse", "collared shirt", ...shirtExact]),
      relatedTypes: uniq(["overshirt"]),
      weakTypes: uniq(["generic long sleeve top"]),
      badTypes: uniq(["sweater", "hoodie", "sweatshirt", "t-shirt", "tank"]),
      blockedFamilies: ["dresses", "bottoms", "footwear", "bags", "accessories"],
    };
    return sanitizeContract(contract);
  }

  // Trousers contract
  if (category === "bottoms" || includesAny(blob, /\b(trouser|trousers|pant|pants|wide\s*leg|tailored|dress pant|chino|slack)\b/)) {
    const trouserExact = pickDesired(desired, /\b(trouser|trousers|pant|pants|wide\s*leg|wide[-\s]*leg|tailored|dress pant|dress pants|chino|chinos|slack|slacks|jean|jeans|bottom|bottoms)\b/);
    const contract = {
      exactTypes: uniq(["wide leg trouser", "wide leg pant", "tailored trouser", "dress pant", "trousers", ...trouserExact]),
      relatedTypes: uniq(["straight pant", "chino", "loose pant"]),
      weakTypes: uniq(["jeans", "cargo", "utility pant"]),
      badTypes: uniq(["jogger", "sweatpant", "shorts", "skirt"]),
      blockedFamilies: ["tops", "dresses", "footwear", "bags", "accessories", "outerwear"],
    };
    return sanitizeContract(contract);
  }

  // Dresses contract
  if (category === "dresses" || includesAny(blob, /\b(dress|gown|frock)\b/)) {
    const dressExact = pickDesired(desired, /\b(dress|dresses|gown|gowns|frock|frocks)\b/);
    const contract = {
      exactTypes: uniq(["dress", "short sleeve dress", "long sleeve dress", ...dressExact]),
      relatedTypes: uniq(["midi dress", "maxi dress", "semi formal dress"]),
      weakTypes: uniq(["beach dress", "casual dress"]),
      badTypes: uniq(["shirt", "blouse", "t-shirt", "hoodie", "pants", "trousers"]),
      blockedFamilies: ["tops", "bottoms", "footwear", "bags", "accessories"],
    };
    return sanitizeContract(contract);
  }

  // Generic top fallback
  if (category === "tops" || includesAny(blob, /\b(top|tee|t-shirt|polo|blouse)\b/)) {
    const topExact = pickDesired(desired, /\b(top|tops|tee|tees|t-shirt|tshirts?|polo|polo shirts?|blouse|blouses|shirt|shirts)\b/);
    const contract = {
      exactTypes: uniq(["top", "tops", ...topExact]),
      relatedTypes: uniq([]),
      weakTypes: uniq([]),
      badTypes: uniq(["pants", "trousers", "dress", "shoe", "bag"]),
      blockedFamilies: ["bottoms", "dresses", "footwear", "bags", "accessories"],
    };
    return sanitizeContract(contract);
  }

  return sanitizeContract({
    exactTypes: uniq(desired),
    relatedTypes: [],
    weakTypes: [],
    badTypes: [],
    blockedFamilies: [],
  });
}

function sanitizeContract(contract: ProductRecallContract): ProductRecallContract {
  const bad = uniq(contract.badTypes);

  const exactTypes = uniq(contract.exactTypes).filter((t) => !isBadEquivalent(t, bad));
  const relatedTypes = uniq(contract.relatedTypes).filter((t) => !isBadEquivalent(t, bad) && !exactTypes.some((x) => canonType(x) === canonType(t)));
  const weakTypes = uniq(contract.weakTypes).filter((t) => !isBadEquivalent(t, bad) && !exactTypes.some((x) => canonType(x) === canonType(t)) && !relatedTypes.some((x) => canonType(x) === canonType(t)));

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
