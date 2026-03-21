import { pg } from "../core/db";

export interface ProductSearchEnrichmentRow {
  product_id: number;
  canonical_type_ids: string[];
  norm_confidence: number;
  category_confidence: number;
  brand_confidence: number;
}

/**
 * Batch-load Phase-2 enrichment rows for index builds / reindex jobs.
 * Table may be empty until ETL is deployed — callers treat missing as default confidences.
 */
export async function loadProductSearchEnrichmentByIds(
  ids: number[],
): Promise<Map<number, ProductSearchEnrichmentRow>> {
  const out = new Map<number, ProductSearchEnrichmentRow>();
  if (!ids.length) return out;
  const uniq = [...new Set(ids.filter((n) => Number.isFinite(n) && n > 0))];
  if (!uniq.length) return out;

  let res;
  try {
    res = await pg.query(
      `SELECT product_id, canonical_type_ids, norm_confidence, category_confidence, brand_confidence
       FROM product_search_enrichment
       WHERE product_id = ANY($1::int[])`,
      [uniq],
    );
  } catch {
    return out;
  }

  for (const row of res.rows) {
    out.set(Number(row.product_id), {
      product_id: Number(row.product_id),
      canonical_type_ids: Array.isArray(row.canonical_type_ids) ? row.canonical_type_ids : [],
      norm_confidence: Number(row.norm_confidence ?? 0),
      category_confidence: Number(row.category_confidence ?? 0),
      brand_confidence: Number(row.brand_confidence ?? 0),
    });
  }
  return out;
}

/** Map DB canonical ids (e.g. footwear_shoes) to loose product_type tokens for the index. */
export function canonicalTypeIdsToProductTypeTokens(ids: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const parts = String(id).toLowerCase().split("_").filter(Boolean);
    if (parts.length >= 2) {
      const tail = parts.slice(1).join("_").replace(/_/g, " ");
      for (const t of [parts.join("_"), tail, parts[parts.length - 1]]) {
        const k = t.trim().toLowerCase();
        if (k && !seen.has(k)) {
          seen.add(k);
          out.push(k);
        }
      }
    } else if (parts.length === 1 && parts[0]) {
      const k = parts[0];
      if (!seen.has(k)) {
        seen.add(k);
        out.push(k);
      }
    }
  }
  return out;
}
