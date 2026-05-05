import type { ProductDecisionProfile, RawProduct } from "../types";
import { extractHeuristicSignals } from "./heuristicSignalExtractor";
import { clamp01 } from "./scoreUtils";

function toArray(input: unknown): string[] {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input.map((v) => String(v).trim().toLowerCase()).filter(Boolean);
  }
  return String(input)
    .split(/[;,|]/)
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

export function inferSubcategory(product: RawProduct): string | undefined {
  const text = `${product.subcategory || ""} ${product.title} ${product.category}`.toLowerCase();
  const subtypeKeywords = [
    "suit jacket",
    "dress jacket",
    "waistcoat",
    "gilet",
    "vest top",
    "sleeveless top",
    "tank top",
    "tailored jacket",
    "structured jacket",
    "tuxedo",
    "vest",
    "sneaker",
    "heel",
    "boot",
    "loafer",
    "sandal",
    "blazer",
    "shirt",
    "dress",
    "hoodie",
    "skirt",
    "jeans",
    "jacket",
    "coat",
  ];
  const found = subtypeKeywords.find((k) => text.includes(k));
  return found || product.subcategory;
}

export function normalizeProduct(raw: RawProduct): ProductDecisionProfile {
  const salePrice = raw.salePrice && raw.salePrice > 0 ? raw.salePrice : undefined;
  const effectivePrice = salePrice ?? raw.price;
  const heuristic = extractHeuristicSignals(raw);

  const metadataSignals = ((raw.metadata?.decisionSignals as Record<string, unknown>) || null) as
    | {
        imageSignals?: Partial<ProductDecisionProfile["imageSignals"]>;
        styleSignals?: Partial<ProductDecisionProfile["styleSignals"]>;
        usageSignals?: Partial<ProductDecisionProfile["usageSignals"]>;
        trustSignals?: Partial<ProductDecisionProfile["trustSignals"]>;
        derivedSignals?: Partial<ProductDecisionProfile["derivedSignals"]>;
      }
    | null;

  if (metadataSignals) {
    heuristic.sourceMeta.hasVisionSignals = true;
  }

  const mergeScores = <T extends Record<string, number>>(base: T, override?: Partial<T>): T => {
    const merged = { ...base, ...(override || {}) };
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(merged)) {
      out[key] = clamp01(Number(value));
    }
    return out as T;
  };

  return {
    id: raw.id,
    title: raw.title,
    brand: raw.brand || "unknown",
    category: raw.category || "unknown",
    subcategory: inferSubcategory(raw),
    price: raw.price,
    salePrice,
    effectivePrice,
    imageSignals: mergeScores(heuristic.imageSignals, metadataSignals?.imageSignals),
    styleSignals: mergeScores(heuristic.styleSignals, metadataSignals?.styleSignals),
    usageSignals: mergeScores(heuristic.usageSignals, metadataSignals?.usageSignals),
    trustSignals: mergeScores(heuristic.trustSignals, metadataSignals?.trustSignals),
    derivedSignals: mergeScores(heuristic.derivedSignals, metadataSignals?.derivedSignals),
    sourceMeta: heuristic.sourceMeta,
  };
}

export function normalizeProducts(rawProducts: RawProduct[]): ProductDecisionProfile[] {
  return rawProducts.map((p) => {
    const normalized: RawProduct = {
      ...p,
      colors: toArray(p.colors),
      material: toArray(p.material),
      styleTags: toArray(p.styleTags),
      occasionTags: toArray(p.occasionTags),
      careTags: toArray(p.careTags),
    };
    return normalizeProduct(normalized);
  });
}
