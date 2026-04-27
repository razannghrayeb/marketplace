import { osClient, getProductsByIdsOrdered } from "../core";
import { config } from "../../config";
import { getImagesForProducts } from "../../routes/products/images.service";
import type { ProductResult } from "../../routes/products/types";

/**
 * Options to rank "related" items by the same signals as main text search, not only aisle/brand.
 */
export interface FindRelatedProductsOptions {
  /** Processed user query — primary lexical relevance for related results. */
  relevanceQuery?: string;
  /** Synonym / expansion terms (soft boost). */
  expandedTerms?: string[];
  /** Entity colors from the query — extra should-clauses on title/description. */
  colorHints?: string[];
}

/**
 * Related products: same category and/or brand as the current result set, excluding main hits.
 *
 * Without `relevanceQuery`, ranking is essentially arbitrary (constant scores on keyword `terms`),
 * so "related" items rarely match what the user actually asked for. Passing the processed query
 * makes OpenSearch score by title/description alignment like the primary search.
 */
export async function findRelatedProducts(
  excludeIds: string[],
  brands: string[],
  categories: string[],
  limit: number,
  options?: FindRelatedProductsOptions,
): Promise<ProductResult[]> {
  const excludeNumericIds = excludeIds.map((id) => parseInt(id, 10));

  const brandShould =
    brands.length > 0
      ? [{ terms: { brand: brands.map((b) => String(b).toLowerCase()) } }]
      : [];
  const categoryShould =
    categories.length > 0
      ? [{ terms: { category: categories.map((c) => String(c).toLowerCase()) } }]
      : [];

  if (brandShould.length === 0 && categoryShould.length === 0) return [];

  const filter: object[] = [
    { bool: { must_not: [{ term: { is_hidden: true } }] } },
    {
      bool: {
        should: [...brandShould, ...categoryShould],
        minimum_should_match: 1,
      },
    },
  ];

  const shouldScore: object[] = [];
  const q = (options?.relevanceQuery ?? "").trim();
  if (q.length >= 2) {
    shouldScore.push({
      multi_match: {
        query: q,
        fields: [
          "title^3",
          "description^2",
          "brand^1.5",
          "category^1.2",
          "product_types^1.5",
          "attr_style",
          "attr_material",
        ],
        type: "best_fields",
        fuzziness: "AUTO",
      },
    });
  }

  const exp = [...(options?.expandedTerms ?? [])]
    .map((t) => String(t).trim())
    .filter((t) => t.length >= 2);
  const expJoined = [...new Set(exp)].join(" ").trim();
  if (expJoined.length >= 2 && expJoined.toLowerCase() !== q.toLowerCase()) {
    shouldScore.push({
      multi_match: {
        query: expJoined,
        fields: ["title^2", "description", "product_types"],
        type: "best_fields",
        operator: "or",
        boost: 0.72,
      },
    });
  }

  for (const col of (options?.colorHints ?? []).slice(0, 4)) {
    const c = String(col).toLowerCase().trim();
    if (c.length < 2) continue;
    shouldScore.push({
      match: {
        title: { query: c, boost: 1.1 },
      },
    });
  }

  const queryBool: Record<string, unknown> = {
    filter,
    must_not:
      excludeNumericIds.length > 0 ? { terms: { product_id: excludeIds } } : undefined,
  };
  if (shouldScore.length > 0) {
    queryBool.should = shouldScore;
    queryBool.minimum_should_match = 0;
  }

  const searchBody = {
    size: limit,
    _source: {
      excludes: ["embedding_*"],
    },
    query: {
      bool: queryBool,
    },
    sort: [{ _score: "desc" }, { price_usd: "asc" }],
  };

  const osResponse = await osClient.search({
    index: config.opensearch.index,
    body: searchBody,
  });

  const hits = osResponse.body.hits.hits;
  const productIds = hits.map((hit: any) => hit._source.product_id);

  if (productIds.length === 0) return [];

  const products = await getProductsByIdsOrdered(productIds);
  const numericIds = productIds.map((id: string) => parseInt(id, 10));
  const imagesByProduct = await getImagesForProducts(numericIds);

  return products.map((p: any) => {
    const images = imagesByProduct.get(parseInt(p.id, 10)) || [];
    return {
      ...p,
      match_type: "related" as const,
      images: images.map((img) => ({
        id: img.id,
        url: img.cdn_url,
        is_primary: img.is_primary,
      })),
    };
  }) as ProductResult[];
}
