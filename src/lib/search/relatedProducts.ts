import { osClient, getProductsByIdsOrdered } from "../core";
import { config } from "../../config";
import { getImagesForProducts } from "../../routes/products/images.service";
import type { ProductResult } from "../../routes/products/types";

/**
 * Related products discovery by category + brand.
 *
 * Used by both enhanced and legacy search flows.
 */
export async function findRelatedProducts(
  excludeIds: string[],
  brands: string[],
  categories: string[],
  limit: number,
): Promise<ProductResult[]> {
  const excludeNumericIds = excludeIds.map((id) => parseInt(id, 10));

  // Build OR conditions for brands and categories
  const should: any[] = [];
  if (brands.length > 0) should.push({ terms: { brand: brands } });
  if (categories.length > 0) should.push({ terms: { category: categories } });

  if (should.length === 0) return [];

  const searchBody = {
    size: limit,
    query: {
      bool: {
        must: [{ term: { is_hidden: false } }],
        should,
        minimum_should_match: 1,
        must_not:
          excludeNumericIds.length > 0 ? { terms: { product_id: excludeIds } } : undefined,
      },
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

