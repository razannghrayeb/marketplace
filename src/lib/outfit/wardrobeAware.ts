/**
 * Wardrobe-first ordering and highlight cards for complete-my-outfit.
 */

import { pg } from "../core";
import { detectCategory, type Product, type ProductCategory, type RecommendedProduct, type StyleRecommendation } from "./completestyle";

export interface WardrobeHighlight {
  bucketCategory: string;
  wardrobeItem: {
    id: number;
    name: string;
    imageUrl?: string;
    matchScore: number;
    matchReason: string;
  };
}

function scoreOwnedAgainstStyle(
  matchScore: number,
  stylePrimary: string,
  candidateColor: string,
  harmonies: { colors: string[] }[],
): { score: number; reasons: string[] } {
  const sp = stylePrimary.toLowerCase();
  const cc = (candidateColor || "").toLowerCase();
  let colorHarmony = 0.65;
  if (!cc) colorHarmony = 0.62;
  else if (sp === "neutral") colorHarmony = 0.92;
  else if (cc === sp) colorHarmony = 0.88;
  else if (harmonies.some((h) => h.colors.includes(cc))) colorHarmony = 0.82;

  const combined = Math.round(Math.min(100, matchScore * 0.45 + colorHarmony * 55));
  const reasons = ["In your wardrobe"];
  if (colorHarmony >= 0.8) reasons.push("Works with this look's palette");
  else reasons.push("Wearable with this outfit");
  return { score: combined, reasons };
}

/**
 * Reorder products (owned first when strong), build highlight when best owned beats threshold.
 */
export async function buildWardrobeAwareRecommendations(
  recommendations: StyleRecommendation[],
  userId: number,
  seedProduct: Product,
  style: { colorProfile: { primary: string; harmonies: { colors: string[] }[] } },
  options: { maxPerCategory?: number; highlightScoreMin?: number },
): Promise<{ recommendations: StyleRecommendation[]; highlights: WardrobeHighlight[] }> {
  const maxPer = Math.max(1, options.maxPerCategory ?? 5);
  const highlightMin = options.highlightScoreMin ?? 82;

  const ownedRows = await pg.query<Product>(`
    SELECT
      p.id,
      p.title,
      p.brand,
      p.category,
      p.color,
      p.price_cents,
      p.currency,
      p.image_url,
      p.image_cdn,
      p.description
    FROM wardrobe_items wi
    JOIN products p ON p.id = wi.product_id
    WHERE wi.user_id = $1
      AND wi.product_id IS NOT NULL
      AND p.availability = true
  `, [userId]);

  if (!ownedRows.rows.length) {
    return { recommendations, highlights: [] };
  }

  const ownedProducts = ownedRows.rows.slice(0, 80);
  const ownedWithCat = await Promise.all(
    ownedProducts.map(async (p) => {
      const cat = await detectCategory(p.title, p.description);
      return { product: p, detectedCategory: cat.category as ProductCategory };
    }),
  );

  const highlights: WardrobeHighlight[] = [];

  const nextRecs = recommendations.map((rec) => {
    const tokens = rec.category.split(" / ").map((t) => t.trim()).filter(Boolean);
    const ownedForRec = ownedWithCat.filter((o) => tokens.includes(o.detectedCategory));
    if (ownedForRec.length === 0) return rec;

    const ownedIdSet = new Set(ownedForRec.map((o) => o.product.id));
    const products = rec.products.map((p) => {
      const rp = p as RecommendedProduct;
      if (ownedIdSet.has(p.id)) {
        (rp as RecommendedProduct & { owned?: boolean }).owned = true;
      }
      return rp;
    });

    const existingIds = new Set(products.map((p) => p.id));
    const extras: RecommendedProduct[] = [];

    for (const { product: p } of ownedForRec) {
      if (existingIds.has(p.id)) continue;
      const { score, reasons } = scoreOwnedAgainstStyle(72, style.colorProfile.primary, p.color || "", style.colorProfile.harmonies);
      extras.push({
        ...p,
        matchScore: score,
        confidence: 0.75,
        matchReasons: reasons,
        explainability: {
          visualSimilarity: 0,
          attributeMatch: 0,
          colorHarmony: 0.8,
          styleCompatibility: 0.75,
          occasionAlignment: 0.7,
        },
        owned: true,
      } as RecommendedProduct);
      existingIds.add(p.id);
    }

    let merged = [...extras, ...products];
    merged.sort((a, b) => {
      const ao = (a as { owned?: boolean }).owned === true ? 1 : 0;
      const bo = (b as { owned?: boolean }).owned === true ? 1 : 0;
      if (ao !== bo) return bo - ao;
      return (b.matchScore ?? 0) - (a.matchScore ?? 0);
    });
    merged = merged.slice(0, maxPer);

    const bestOwned = merged.find((p) => (p as { owned?: boolean }).owned === true);
    if (bestOwned && (bestOwned.matchScore ?? 0) >= highlightMin) {
      highlights.push({
        bucketCategory: rec.category,
        wardrobeItem: {
          id: bestOwned.id,
          name: bestOwned.title,
          imageUrl: bestOwned.image_cdn || bestOwned.image_url,
          matchScore: Math.round(bestOwned.matchScore ?? 0),
          matchReason: `You already own a strong option for ${rec.category.split(" / ")[0] || "this look"}`,
        },
      });
    }

    return { ...rec, products: merged };
  });

  return { recommendations: nextRecs, highlights };
}
