/**
 * Filter-only catalog browse (match_all + filters + pagination).
 * Used by the search facade so we avoid importing legacy OpenSearch builders from routes.
 */

import { osClient } from "../core/opensearch";
import { getProductsByIdsOrdered } from "../core/db";
import { config } from "../../config";
import type { SearchFilters } from "../../routes/products/types";
import { getImagesForProducts } from "../../routes/products/images.service";

const LBP_TO_USD = 89000;
const BROWSE_GROUP_SCAN_CAP = 5000;

function normalizeParentUrlKey(raw: string): string {
  const cleaned = String(raw ?? "").trim();
  if (!cleaned) return "";
  try {
    const u = new URL(cleaned);
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length > 0 && /^[a-z]{2}(?:-[a-z]{2})?$/i.test(parts[0])) {
      parts.shift();
    }
    return `${u.origin.toLowerCase()}/${parts.join("/").toLowerCase()}`;
  } catch {
    const withoutFragment = cleaned.split("#")[0];
    const withoutQuery = withoutFragment.split("?")[0];
    return withoutQuery.toLowerCase();
  }
}

function appendBrowseFilters(filter: any[], filters: SearchFilters): void {
  if (filters.category) {
    if (Array.isArray(filters.category)) {
      const terms = filters.category.map((c) => String(c).toLowerCase()).filter(Boolean);
      if (terms.length > 0) filter.push({ terms: { category: terms } });
    } else {
      filter.push({ term: { category: String(filters.category).toLowerCase() } });
    }
  }
  if (filters.brand) {
    filter.push({ term: { brand: String(filters.brand).toLowerCase() } });
  }
  if (filters.vendorId) {
    filter.push({ term: { vendor_id: String(filters.vendorId) } });
  }
  if (filters.availability !== undefined) {
    filter.push({
      term: { availability: filters.availability ? "in_stock" : "out_of_stock" },
    });
  }
  if (filters.minPriceCents !== undefined || filters.maxPriceCents !== undefined) {
    const range: Record<string, number> = {};
    const currency = (filters.currency ?? "LBP").toUpperCase();
    if (currency === "USD") {
      if (filters.minPriceCents !== undefined) range.gte = filters.minPriceCents / 100;
      if (filters.maxPriceCents !== undefined) range.lte = filters.maxPriceCents / 100;
    } else {
      if (filters.minPriceCents !== undefined) range.gte = Math.floor(filters.minPriceCents / LBP_TO_USD);
      if (filters.maxPriceCents !== undefined) range.lte = Math.ceil(filters.maxPriceCents / LBP_TO_USD);
    }
    filter.push({ range: { price_usd: range } });
  }
  if (filters.color) filter.push({ term: { attr_color: String(filters.color).toLowerCase() } });
  if (filters.material) filter.push({ term: { attr_material: String(filters.material).toLowerCase() } });
  if (filters.fit) filter.push({ term: { attr_fit: String(filters.fit).toLowerCase() } });
  if (filters.style) filter.push({ term: { attr_style: String(filters.style).toLowerCase() } });
  if (filters.gender) filter.push({ term: { attr_gender: String(filters.gender).toLowerCase() } });
  if (filters.pattern) filter.push({ term: { attr_pattern: String(filters.pattern).toLowerCase() } });
}

export async function searchProductsFilteredBrowse(params: {
  filters?: Partial<SearchFilters>;
  page: number;
  limit: number;
}): Promise<any[]> {
  const { filters = {}, page, limit } = params;
  const filter: any[] = [{ bool: { must_not: [{ term: { is_hidden: true } }] } }];
  appendBrowseFilters(filter, filters as SearchFilters);

  const groupedOffset = (page - 1) * limit;
  const groupedNeeded = groupedOffset + limit;
  const batchSize = Math.min(200, Math.max(limit * 5, 50));

  const representativeIds: string[] = [];
  const seenGroupKeys = new Set<string>();
  const scoreMap = new Map<string, number>();

  let from = 0;
  while (
    representativeIds.length < groupedNeeded &&
    from < BROWSE_GROUP_SCAN_CAP
  ) {
    const searchBody = {
      size: batchSize,
      from,
      _source: ["product_id", "vendor_id", "parent_product_url", "product_url"],
      query: {
        bool: {
          must: [{ match_all: {} }],
          filter: filter.length > 0 ? filter : undefined,
        },
      },
      sort: [{ _score: "desc" }, { price_usd: "asc" }, { product_id: "asc" }],
    };

    const osResponse = await osClient.search({
      index: config.opensearch.index,
      body: searchBody,
    });

    const hits = osResponse.body.hits.hits as any[];
    if (!hits || hits.length === 0) break;

    for (const hit of hits) {
      const src = hit?._source ?? {};
      const productId = String(src.product_id ?? "").trim();
      if (!productId) continue;

      const parentRaw = normalizeParentUrlKey(String(src.parent_product_url ?? ""));
      const parentFromUrl = normalizeParentUrlKey(String(src.product_url ?? ""));
      const parentKey = parentRaw || parentFromUrl || `__id_${productId}`;
      const vendorKey = String(src.vendor_id ?? "").trim() || "__vendor";
      const groupKey = `${vendorKey}|${parentKey}`;

      if (seenGroupKeys.has(groupKey)) continue;
      seenGroupKeys.add(groupKey);
      representativeIds.push(productId);
      scoreMap.set(productId, Number(hit?._score ?? 0));

      if (representativeIds.length >= groupedNeeded) break;
    }

    from += hits.length;
    if (hits.length < batchSize) break;
  }

  const pagedIds = representativeIds.slice(groupedOffset, groupedOffset + limit);
  if (pagedIds.length === 0) return [];

  const products = await getProductsByIdsOrdered(pagedIds);
  const numericIds = pagedIds.map((id) => parseInt(id, 10)).filter(Number.isFinite);
  const imagesByProduct = await getImagesForProducts(numericIds);

  return products.map((p: any) => {
    const images = imagesByProduct.get(parseInt(p.id, 10)) || [];
    return {
      ...p,
      similarity_score: scoreMap.get(String(p.id)),
      images: images.map((img: any) => ({
        id: img.id,
        url: img.cdn_url,
        is_primary: img.is_primary,
        p_hash: img.p_hash ?? undefined,
      })),
    };
  });
}
