// src/lib/search/loadVariantsForIndexing.ts

import { pg } from "../core";

export interface VariantIndexSummary {
  productId: number;
  /** All distinct non-null colors across variants, e.g. ["Red", "Blue"] */
  colors: string[];
  /** All distinct non-null sizes across variants */
  sizes: string[];
  /** description from the default variant, if parent has none */
  description: string | null;
  /** image_url from the default variant, if parent has none */
  imageUrl: string | null;
}

/**
 * Batch-load variant data for a set of parent product IDs.
 * Used at index time to enrich OpenSearch documents with
 * variant-level fields (color, size, description) that may
 * be missing from the parent products row.
 */
export async function loadVariantsForIndexing(
  productIds: number[]
): Promise<Map<number, VariantIndexSummary>> {
  if (productIds.length === 0) return new Map();

  const res = await pg.query<{
    product_id: number;
    color: string | null;
    size: string | null;
    description: string | null;
    image_url: string | null;
    is_default: boolean;
  }>(
    `SELECT product_id, color, size, description, image_url, is_default
     FROM product_variants
     WHERE product_id = ANY($1)`,
    [productIds]
  );

  const map = new Map<number, VariantIndexSummary>();

  for (const row of res.rows) {
    const pid = row.product_id;
    if (!map.has(pid)) {
      map.set(pid, { productId: pid, colors: [], sizes: [], description: null, imageUrl: null });
    }
    const entry = map.get(pid)!;

    if (row.color && !entry.colors.includes(row.color)) {
      entry.colors.push(row.color);
    }
    if (row.size && !entry.sizes.includes(row.size)) {
      entry.sizes.push(row.size);
    }
    // Only take description/image from the default variant (or first one seen)
    if (row.is_default) {
      if (!entry.description && row.description) entry.description = row.description;
      if (!entry.imageUrl && row.image_url) entry.imageUrl = row.image_url;
    }
  }

  // Fallback: for products where no variant is_default=true,
  // pick description/image from the first variant that has them
  for (const row of res.rows) {
    const entry = map.get(row.product_id)!;
    if (!entry.description && row.description) entry.description = row.description;
    if (!entry.imageUrl && row.image_url) entry.imageUrl = row.image_url;
  }

  return map;
}