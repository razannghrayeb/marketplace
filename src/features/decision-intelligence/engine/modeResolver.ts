import type { ComparisonMode, ProductDecisionProfile } from "../types";

function normalize(value: string | undefined): string {
  return (value || "").trim().toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasToken(value: string, token: string): boolean {
  const re = new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(token)}(?:$|[^a-z0-9])`, "i");
  return re.test(value);
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
    if (hasToken(cat, token) || hasToken(sub, token)) return group;
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
      reason: "These items belong to different wardrobe areas, so an outfit-level comparison is the clearest way to compare them.",
    };
  }

  const subtypes = new Set(profiles.map((p) => normalize(p.subcategory)).filter(Boolean));

  if (subtypes.size > 1) {
    return {
      comparisonMode: "scenario_compare",
      reason: "The items share a broad category but differ in style or fit, so a use-case comparison is more helpful.",
    };
  }

  return {
    comparisonMode: "direct_head_to_head",
    reason: "These items are similar enough for a direct side-by-side comparison.",
  };
}
