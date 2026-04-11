import type { ComparisonMode, ProductDecisionProfile } from "../types";

function normalize(value: string | undefined): string {
  return (value || "").trim().toLowerCase();
}

const groupMap: Record<string, string> = {
  dress: "one_piece",
  jumpsuit: "one_piece",
  romper: "one_piece",
  top: "tops",
  shirt: "tops",
  blouse: "tops",
  tee: "tops",
  hoodie: "tops",
  sweater: "tops",
  cardigan: "tops",
  pants: "bottoms",
  trouser: "bottoms",
  jeans: "bottoms",
  skirt: "bottoms",
  shorts: "bottoms",
  blazer: "outerwear",
  jacket: "outerwear",
  coat: "outerwear",
  sneaker: "footwear",
  heel: "footwear",
  boot: "footwear",
  loafer: "footwear",
  sandal: "footwear",
  bag: "accessories",
  accessory: "accessories",
};

export function inferMajorCategory(profile: ProductDecisionProfile): string {
  const cat = normalize(profile.category);
  const sub = normalize(profile.subcategory);
  for (const [token, group] of Object.entries(groupMap)) {
    if (cat.includes(token) || sub.includes(token)) return group;
  }
  return cat || "other";
}

export function resolveComparisonMode(
  profiles: ProductDecisionProfile[]
): { comparisonMode: ComparisonMode; reason: string } {
  const majorGroups = profiles.map(inferMajorCategory);
  const uniqueMajor = new Set(majorGroups);

  if (uniqueMajor.size > 1) {
    return {
      comparisonMode: "outfit_compare",
      reason: "Mixed major categories detected, so outfit-based impact is more reliable than direct winner forcing.",
    };
  }

  const subtypes = new Set(profiles.map((p) => normalize(p.subcategory)).filter(Boolean));

  if (subtypes.size > 1) {
    return {
      comparisonMode: "scenario_compare",
      reason: "Products share major category but differ by subtype, so scenario-based comparison is more meaningful.",
    };
  }

  return {
    comparisonMode: "direct_head_to_head",
    reason: "Products share category and subtype, enabling direct head-to-head evaluation.",
  };
}
