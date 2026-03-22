/**
 * Filter-only catalog browse (match_all + filters + pagination).
 * Used by the search facade so we avoid importing legacy OpenSearch builders from routes.
 */

import { osClient } from "../core/opensearch";
import { getProductsByIdsOrdered } from "../core/db";
import { enrichProductsWithVariantSummary } from "../products/variantEnrichment";
import { config } from "../../config";
import type { SearchFilters } from "../../routes/products/types";
import { getImagesForProducts } from "../../routes/products/images.service";

const LBP_TO_USD = 89000;

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
  const filter: any[] = [{ term: { is_hidden: false } }];
  appendBrowseFilters(filter, filters as SearchFilters);

  const searchBody = {
    size: limit,
    from: (page - 1) * limit,
    query: {
      bool: {
        must: [{ match_all: {} }],
        filter: filter.length > 0 ? filter : undefined,
      },
    },
    sort: [{ _score: "desc" }, { price_usd: "asc" }],
  };

  const osResponse = await osClient.search({
    index: config.opensearch.index,
    body: searchBody,
  });

  const hits = osResponse.body.hits.hits;
  const productIds: string[] = hits.map((hit: any) => String(hit._source.product_id));
  const scoreMap = new Map<string, number>();
  hits.forEach((hit: any) => {
    scoreMap.set(String(hit._source.product_id), hit._score);
  });

  if (productIds.length === 0) return [];

  const products = await enrichProductsWithVariantSummary(await getProductsByIdsOrdered(productIds));
  const numericIds = productIds.map((id) => parseInt(id, 10));
  const imagesByProduct = await getImagesForProducts(numericIds);

  return products.map((p: any) => {
    const images = imagesByProduct.get(parseInt(p.id, 10)) || [];
    return {
      ...p,
      similarity_score: scoreMap.get(String(p.id)),
      images: images.map((img) => ({
        id: img.id,
        url: img.cdn_url,
        is_primary: img.is_primary,
      })),
    };
  });
}
