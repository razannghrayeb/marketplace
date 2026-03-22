/**
 * Intent-aware Reranker
 *
 * Re-scores candidate results using parsed user intent and feature signals.
 * Designed to be plug-and-play for both the composite query flow and the
 * multi-vector flow.
 */

import type { ParsedIntent } from "../prompt/gemeni";
import type { MultiVectorSearchResult } from "../search/multiVectorSearch";

export interface RerankOptions {
  vectorWeight?: number; // importance of existing vector score
  attributeWeight?: number; // importance of attribute match signals
  priceWeight?: number; // importance of price attractiveness
  recencyWeight?: number; // importance of recency/availability
}

export interface RerankedResult extends MultiVectorSearchResult {
  rerankScore: number;
  rerankBreakdown?: {
    vector: number;
    attribute: number;
    price: number;
    recency: number;
  };
}

/**
 * Simple intent-aware reranking function.
 * - Uses the parsed intent to boost attribute matches mentioned in the intent
 * - Combines existing vector score with attribute breakdown and price proximity
 */
function productBlobForRerank(p: MultiVectorSearchResult["product"]): string {
  if (!p) return "";
  const any = p as Record<string, unknown>;
  return [p.title, p.brand, p.category, any.color, any.description, any.name]
    .filter((x) => x != null && String(x).trim() !== "")
    .map((x) => String(x).toLowerCase())
    .join(" ");
}

/**
 * When scoreBreakdown is empty (e.g. composite /multi-image path), approximate
 * attribute relevance from extracted intent strings vs product text.
 */
function lexicalIntentMatchScore(
  product: MultiVectorSearchResult["product"] | undefined,
  intent: ParsedIntent
): number {
  if (!product) return 0;
  const blob = productBlobForRerank(product);
  if (!blob) return 0;

  let hits = 0;
  let total = 0;

  for (const ii of intent.imageIntents || []) {
    const ev = ii.extractedValues;
    if (!ev) continue;
    for (const val of Object.values(ev)) {
      const arr = Array.isArray(val) ? val : [val];
      for (const s of arr) {
        const t = String(s).toLowerCase().trim();
        if (t.length < 2) continue;
        total++;
        if (blob.includes(t)) hits++;
      }
    }
  }

  for (const t of intent.constraints?.mustHave || []) {
    const x = String(t).toLowerCase().trim();
    if (x.length < 2) continue;
    total++;
    if (blob.includes(x)) hits++;
  }

  if (intent.constraints?.category) {
    const c = String(intent.constraints.category).toLowerCase().trim();
    if (c.length >= 2) {
      total++;
      const cat = String(product.category || "").toLowerCase();
      if (blob.includes(c) || cat.includes(c) || c.includes(cat)) hits++;
    }
  }

  for (const t of intent.constraints?.mustNotHave || []) {
    const x = String(t).toLowerCase().trim();
    if (x.length >= 2 && blob.includes(x)) {
      hits = Math.max(0, hits - 1);
    }
  }

  if (total === 0) return 0;
  return clamp01(hits / total);
}

export function intentAwareRerank(
  results: MultiVectorSearchResult[],
  intent: ParsedIntent,
  options?: RerankOptions
): RerankedResult[] {
  const opts = {
    vectorWeight: 0.6,
    attributeWeight: 0.25,
    priceWeight: 0.1,
    recencyWeight: 0.05,
    ...(options || {}),
  };

  // Determine intent attribute priorities (from parsed intent.imageIntents and constraints)
  const intentAttrWeights = extractIntentAttributeWeights(intent);

  // Price target range if present
  const priceTarget = intent.constraints?.priceMin !== undefined || intent.constraints?.priceMax !== undefined
    ? { min: intent.constraints?.priceMin ?? 0, max: intent.constraints?.priceMax ?? Infinity }
    : null;

  return results.map(res => {
    // Vector component: use existing `score` field (expected normalized 0..1)
    const vectorComp = clamp01(res.score ?? 0);

    // Attribute component: compare scoreBreakdown attributes to intentAttrWeights
    let attributeComp = 0;
    if (res.scoreBreakdown && res.scoreBreakdown.length > 0) {
      for (const b of res.scoreBreakdown) {
        const attr = b.attribute;
        const sim = normalizeSimilarity(b.similarity);
        const intentW = intentAttrWeights[attr] ?? 0;
        attributeComp += intentW * sim;
      }
      // Normalize by total intent weight (if any) to keep in [0,1]
      const totalIntentWeight = Object.values(intentAttrWeights).reduce((a,b) => a+b, 0) || 1;
      attributeComp = attributeComp / totalIntentWeight;
    } else {
      attributeComp = lexicalIntentMatchScore(res.product, intent);
    }

    // Price component: closer to mid-range is better
    let priceComp = 0;
    if (priceTarget && res.product && res.product.priceUsd !== undefined && isFinite(priceTarget.max)) {
      const mid = (priceTarget.min + priceTarget.max) / 2;
      const range = Math.max(1, (priceTarget.max - priceTarget.min));
      const diff = Math.abs((res.product.priceUsd ?? mid) - mid);
      priceComp = clamp01(1 - diff / range);
    }

    // Recency / availability: boost if in stock
    const recencyComp = (res.product && res.product.availability === 'in_stock') ? 1 : 0;

    const rerankScore =
      opts.vectorWeight * vectorComp +
      opts.attributeWeight * attributeComp +
      opts.priceWeight * priceComp +
      opts.recencyWeight * recencyComp;

    const reranked: RerankedResult = {
      ...res,
      rerankScore,
      rerankBreakdown: {
        vector: +(opts.vectorWeight * vectorComp).toFixed(6),
        attribute: +(opts.attributeWeight * attributeComp).toFixed(6),
        price: +(opts.priceWeight * priceComp).toFixed(6),
        recency: +(opts.recencyWeight * recencyComp).toFixed(6),
      },
    };

    return reranked;
  }).sort((a,b) => b.rerankScore - a.rerankScore);
}

/**
 * Extract attribute weights from parsed intent.
 * - Looks at imageIntents primaryAttributes and any explicit extractedValues
 */
function extractIntentAttributeWeights(intent: ParsedIntent): Record<string, number> {
  const weights: Record<string, number> = {};

  if (!intent) return weights;

  // From image intents
  if (intent.imageIntents && intent.imageIntents.length > 0) {
    for (const imgIntent of intent.imageIntents) {
      const w = imgIntent.weight ?? 1;
      if (imgIntent.primaryAttributes && imgIntent.primaryAttributes.length > 0) {
        for (const a of imgIntent.primaryAttributes) {
          const key = a as string;
          weights[key] = (weights[key] || 0) + w;
        }
      }
      // extractedValues may also carry attribute-specific hints
      if ((imgIntent as any).extractedValues) {
        for (const k of Object.keys((imgIntent as any).extractedValues as Record<string, any>)) {
          weights[k] = (weights[k] || 0) + 1;
        }
      }
    }
  }

  // From constraints (e.g., explicit category/brand) - treat as high-level intents
  if ((intent as any).constraints) {
    const c: any = (intent as any).constraints;
    if (c.category) weights['category'] = (weights['category'] || 0) + 2;
    if (c.brands && c.brands.length > 0) weights['brand'] = (weights['brand'] || 0) + 1;
  }

  // Normalize to sum to 1
  const total = Object.values(weights).reduce((a,b) => a+b, 0);
  if (total > 0) {
    for (const k of Object.keys(weights)) {
      weights[k] = weights[k] / total;
    }
  }

  return weights;
}

function clamp01(v: number) { return Math.max(0, Math.min(1, v)); }

/**
 * Convert raw similarity (expected cosine in [-1,1]) to [0,1]
 */
function normalizeSimilarity(sim: number) {
  if (typeof sim !== 'number') return 0;
  return clamp01((sim + 1) / 2);
}
