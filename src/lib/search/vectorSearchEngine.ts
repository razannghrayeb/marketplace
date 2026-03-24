/**
 * All OpenSearch kNN query construction for image retrieval lives here.
 */

import { osClient } from "../core/opensearch";
import { config } from "../../config";
import type { SearchFilters } from "./multiVectorSearch";
import {
  MultiVectorSearchEngine,
  type AttributeEmbedding,
  type MultiVectorSearchConfig,
  type MultiVectorSearchResult,
} from "./multiVectorSearch";

export interface SingleVectorSearchParams {
  vector: number[];
  /** OpenSearch knn field name (e.g. embedding or embedding_global) */
  field: string;
  k: number;
  filters?: SearchFilters;
  indexName?: string;
}

export interface SingleVectorHit {
  productId: string;
  score: number;
}

/**
 * One kNN query — used for single-image similarity and per-detection crop search.
 */
export async function searchSingleVector(params: SingleVectorSearchParams): Promise<SingleVectorHit[]> {
  const { vector, field, k, filters = {}, indexName = config.opensearch.index } = params;
  const filterQuery = buildOpensearchFilterClauses(filters);

  const response = await osClient.search({
    index: indexName,
    body: {
      size: k,
      query: {
        bool: {
          must: [
            {
              knn: {
                [field]: {
                  vector,
                  k,
                },
              },
            },
          ],
          filter: filterQuery,
        },
      },
      _source: ["product_id"],
    },
  });

  const hits = response.body.hits.hits as any[];
  return hits.map((hit: any) => ({
    productId: String(hit._source?.product_id ?? ""),
    score: Number(hit._score) || 0,
  }));
}

/**
 * Parallel per-attribute kNN + union + weighted combine + PG hydrate (existing engine).
 */
export async function searchMultiVector(config: MultiVectorSearchConfig): Promise<MultiVectorSearchResult[]> {
  const engine = new MultiVectorSearchEngine();
  return engine.search(config);
}

export { MultiVectorSearchEngine, type MultiVectorSearchConfig, type MultiVectorSearchResult, type AttributeEmbedding };

function buildOpensearchFilterClauses(filters: SearchFilters): any[] {
  const filterClauses: any[] = [];

  if (filters.excludeHidden !== false) {
    filterClauses.push({ term: { is_hidden: false } });
  }

  if (filters.categories && filters.categories.length > 0) {
    filterClauses.push({ terms: { category: filters.categories } });
  }

  if (filters.vendors && filters.vendors.length > 0) {
    filterClauses.push({ terms: { vendor_id: filters.vendors } });
  }

  if (filters.brands && filters.brands.length > 0) {
    filterClauses.push({ terms: { brand: filters.brands } });
  }

  if (filters.availability && filters.availability.length > 0) {
    filterClauses.push({ terms: { availability: filters.availability } });
  }

  if (filters.gender) {
    filterClauses.push({ term: { attr_gender: filters.gender } });
  }

  if (filters.priceMin !== undefined || filters.priceMax !== undefined) {
    const rangeClause: any = { range: { price_usd: {} } };
    if (filters.priceMin !== undefined) {
      rangeClause.range.price_usd.gte = filters.priceMin;
    }
    if (filters.priceMax !== undefined) {
      rangeClause.range.price_usd.lte = filters.priceMax;
    }
    filterClauses.push(rangeClause);
  }

  return filterClauses;
}
