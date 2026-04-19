import type { ProductDecisionProfile, RawProduct } from "../types";
import { clamp01, hasAny } from "./scoreUtils";

function n(v: number): number {
  return clamp01(v);
}

function parseTextTokens(product: RawProduct): string {
  return [
    product.title,
    product.category,
    product.subcategory,
    product.description,
    ...(product.styleTags || []),
    ...(product.occasionTags || []),
    ...(product.material || []),
    ...(product.colors || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function extractHeuristicSignals(product: RawProduct): Omit<ProductDecisionProfile, "effectivePrice" | "price" | "salePrice" | "id" | "title" | "brand" | "category" | "subcategory"> {
  const t = parseTextTokens(product);
  const usedHeuristics: string[] = [];

  const has = (words: string[]) => hasAny(t, words);

  const structureLevel =
    (has(["blazer", "tailored", "structured", "coat"]) ? 0.75 : 0.45) +
    (has(["oversized", "relaxed"]) ? -0.1 : 0);
  if (has(["blazer"])) usedHeuristics.push("category_blazer_structure_up");

  const softness =
    (has(["knit", "knitwear", "wool", "cashmere", "jersey"]) ? 0.78 : 0.44) +
    (has(["leather", "denim", "structured"]) ? -0.08 : 0);
  if (has(["knit", "knitwear"])) usedHeuristics.push("knitwear_softness_up");

  const textureRichness =
    (has(["satin", "silk", "sequins", "embroidered", "jacquard"]) ? 0.82 : 0.5) +
    (has(["cotton", "plain"]) ? -0.07 : 0);

  const silhouetteSharpness =
    (has(["slim", "tailored", "structured", "fitted"]) ? 0.78 : 0.46) +
    (has(["oversized", "boxy"]) ? -0.08 : 0);
  if (has(["slim", "tailored"])) usedHeuristics.push("tailored_silhouette_sharpness_up");

  const colorEnergy = has(["neon", "metallic", "bright", "vibrant", "red", "lime"]) ? 0.8 : 0.45;
  if (has(["neon", "metallic"])) usedHeuristics.push("neon_metallic_color_energy_up");

  const visualBoldness = n(
    0.35 +
      colorEnergy * 0.3 +
      (has(["statement", "bold", "dramatic", "sequins", "animal print"]) ? 0.25 : 0) +
      (has(["minimal", "classic"]) ? -0.12 : 0)
  );

  const detailDensity = n(
    0.45 +
      (has(["ruffle", "embroidery", "sequins", "buckles", "layers", "pleated"]) ? 0.3 : 0) +
      (has(["minimal", "clean lines"]) ? -0.15 : 0)
  );

  const category = (product.category || "").toLowerCase();
  const outfitFlexibilityVisual = n(
    0.5 +
      (has(["black", "white", "navy", "beige", "neutral"]) ? 0.2 : 0) +
      (has(["neon", "metallic", "sequins"]) ? -0.18 : 0) +
      (category.includes("blazer") || category.includes("shirt") ? 0.08 : 0)
  );

  const classic = n(0.4 + (has(["classic", "timeless", "tailored", "wool", "navy", "beige"]) ? 0.35 : 0));
  const trendy = n(0.35 + (has(["trend", "viral", "cropped", "oversized", "y2k"]) ? 0.35 : 0));
  const polished = n(0.35 + structureLevel * 0.4 + (has(["blazer", "tailored", "formal"]) ? 0.18 : 0));
  const relaxed = n(0.3 + softness * 0.35 + (has(["oversized", "casual", "lounge"]) ? 0.2 : 0));
  const edgy = n(0.25 + (has(["leather", "metallic", "asymmetric", "bold"]) ? 0.45 : 0));
  const feminine = n(0.25 + (has(["floral", "dress", "silk", "satin", "ruffle"]) ? 0.38 : 0));
  const minimal = n(0.3 + (has(["minimal", "clean", "neutral", "capsule"]) ? 0.42 : 0));
  const expressive = n(0.25 + visualBoldness * 0.5 + (has(["statement", "vibrant"]) ? 0.2 : 0));

  const maintenanceEase = n(
    0.65 +
      (has(["machine wash", "cotton", "jersey"]) ? 0.15 : 0) +
      (has(["satin", "silk", "dry clean", "linen", "sequins"]) ? -0.25 : 0)
  );
  if (has(["satin"])) usedHeuristics.push("satin_maintenance_penalty");
  if (has(["linen"])) usedHeuristics.push("linen_wrinkle_maintenance_penalty");

  const occasionRange = n(
    0.45 +
      outfitFlexibilityVisual * 0.35 +
      (has(["work", "casual", "travel", "day to night"]) ? 0.15 : 0) -
      (has(["party", "formal", "sequins"]) ? 0.1 : 0)
  );

  const versatility = n(0.4 + outfitFlexibilityVisual * 0.4 + maintenanceEase * 0.2);
  const stylingEase = n(0.45 + versatility * 0.35 + (has(["oversized"]) ? -0.06 : 0) + (has(["tailored"] ) ? 0.06 : 0));
  const repeatWearPotential = n(0.42 + versatility * 0.38 + (1 - visualBoldness) * 0.2);
  const seasonality = n(0.35 + (has(["wool", "coat", "knit"]) ? 0.45 : 0) + (has(["linen", "lightweight"]) ? 0.25 : 0));

  const descriptionLength = (product.description || "").trim().split(/\s+/).filter(Boolean).length;
  const descriptionClarity = n(Math.min(1, descriptionLength / 120));
  const imageQuality = n(product.imageUrls.length > 0 ? 0.7 : 0.35);
  const realismConfidence = n(0.5 + (imageQuality - 0.5) * 0.5 + (has(["real model", "studio", "close up"]) ? 0.15 : 0));
  const photoToRealityConfidence = n(0.48 + descriptionClarity * 0.28 + realismConfidence * 0.24);
  const returnRisk = n(
    0.45 +
      (has(["final sale", "no return"]) ? 0.28 : 0) -
      (has(["return", "exchange", "refund", "free returns"]) ? 0.22 : 0)
  );

  const statementLevel = n(visualBoldness * 0.5 + expressive * 0.5);
  const trendVolatility = n(trendy * 0.6 + statementLevel * 0.3 + (1 - classic) * 0.1);
  const practicalStrength = n(versatility * 0.45 + stylingEase * 0.35 + maintenanceEase * 0.2);
  const emotionalPull = n(expressive * 0.5 + visualBoldness * 0.35 + textureRichness * 0.15);
  const socialVisibility = n(visualBoldness * 0.45 + polished * 0.25 + expressive * 0.3);

  return {
    imageSignals: {
      silhouetteSharpness: n(silhouetteSharpness),
      visualBoldness,
      softness: n(softness),
      textureRichness: n(textureRichness),
      structureLevel: n(structureLevel),
      detailDensity,
      colorEnergy,
      realismConfidence,
      outfitFlexibilityVisual,
    },
    styleSignals: {
      classic,
      trendy,
      polished,
      relaxed,
      edgy,
      feminine,
      minimal,
      expressive,
    },
    usageSignals: {
      versatility,
      stylingEase,
      occasionRange,
      maintenanceEase,
      seasonality,
      repeatWearPotential,
    },
    trustSignals: {
      photoToRealityConfidence,
      returnRisk,
      descriptionClarity,
      imageQuality,
    },
    derivedSignals: {
      trendVolatility,
      statementLevel,
      practicalStrength,
      emotionalPull,
      socialVisibility,
    },
    sourceMeta: {
      usedHeuristics,
      hasVisionSignals: false,
    },
  };
}
