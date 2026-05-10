/**
 * Sale listing — products with an active discount (sales_price_cents < price_cents).
 * Uses Postgres so we do not depend on OpenSearch sale fields.
 */

import { pg, productsTableHasIsHiddenColumn } from "../../lib/core/index";
import { getImagesForProducts } from "./images.service";

const SALE_WHERE = `
  p.sales_price_cents IS NOT NULL
  AND p.price_cents IS NOT NULL
  AND p.sales_price_cents > 0
  AND p.sales_price_cents < p.price_cents
`;

function orderClause(sort: string | undefined, alias = "p"): string {
  const prefix = alias ? `${alias}.` : "";
  switch (sort) {
    case "price_asc":
      return `${prefix}sales_price_cents ASC NULLS LAST, ${prefix}id DESC`;
    case "price_desc":
      return `${prefix}sales_price_cents DESC NULLS LAST, ${prefix}id DESC`;
    case "discount":
    default:
      return `${prefix}discount_ratio DESC NULLS LAST,
        ${prefix}sales_price_cents ASC,
        ${prefix}id DESC`;
  }
}

async function countSaleProducts(hiddenClause: string, normalizedParentExpr: string): Promise<number> {
  const countResult = await pg.query<{ c: string }>(
    `WITH ranked AS (
       SELECT
         p.id,
         row_number() OVER (
           PARTITION BY p.vendor_id, ${normalizedParentExpr}
           ORDER BY
             CASE WHEN p.availability THEN 1 ELSE 0 END DESC,
             p.last_seen DESC NULLS LAST,
             p.id DESC
         ) AS rn
       FROM products p
       WHERE 1=1
         ${hiddenClause}
         AND ${SALE_WHERE.replace(/\n/g, " ")}
     )
     SELECT COUNT(*)::int AS c
     FROM ranked
     WHERE rn = 1`,
  );

  return Number(countResult.rows[0]?.c ?? 0);
}

export async function listProductsOnSale(params: {
  page: number;
  limit: number;
  sort?: string;
}): Promise<{ products: unknown[]; total: number }> {
  const { page, limit, sort } = params;
  const offset = (page - 1) * limit;
  const hasIsHidden = await productsTableHasIsHiddenColumn();
  const hiddenClause = hasIsHidden ? "AND p.is_hidden = false" : "";

  const normalizedParentExpr = `
    CASE
      WHEN p.parent_product_url IS NOT NULL AND p.parent_product_url <> '' THEN
        regexp_replace(
          split_part(split_part(lower(p.parent_product_url), '?', 1), '#', 1),
          '^(https?://[^/]+)/(?:[a-z]{2}(?:-[a-z]{2})?)/(.*)$',
          '\\1/\\2'
        )
      ELSE
        regexp_replace(
          split_part(split_part(lower(p.product_url), '?', 1), '#', 1),
          '^(https?://[^/]+)/(?:[a-z]{2}(?:-[a-z]{2})?)/(.*)$',
          '\\1/\\2'
        )
    END
  `;

  const orderSql = orderClause(sort, "d");
  const result = await pg.query(
    `WITH ranked AS (
       SELECT
         p.id,
         p.vendor_id,
         p.price_cents,
         p.sales_price_cents,
         (
           (p.price_cents - p.sales_price_cents)::numeric
           / NULLIF(p.price_cents, 0)
         ) AS discount_ratio,
         row_number() OVER (
           PARTITION BY p.vendor_id, ${normalizedParentExpr}
           ORDER BY
             CASE WHEN p.availability THEN 1 ELSE 0 END DESC,
             p.last_seen DESC NULLS LAST,
             p.id DESC
         ) AS rn
       FROM products p
       WHERE 1=1
         ${hiddenClause}
         AND ${SALE_WHERE.replace(/\n/g, " ")}
     )
     , deduped AS (
       SELECT
         id,
         price_cents,
         sales_price_cents,
         discount_ratio
       FROM ranked
       WHERE rn = 1
     )
     , page_rows AS (
       SELECT
         d.id,
         COUNT(*) OVER()::int AS total,
         row_number() OVER (ORDER BY ${orderSql}) AS ordinal
       FROM deduped d
       ORDER BY ${orderSql}
       LIMIT $1 OFFSET $2
     )
     SELECT p.*, v.name as vendor_name, pr.total
     FROM page_rows pr
     JOIN products p ON p.id = pr.id
     LEFT JOIN vendors v ON v.id = p.vendor_id
     ORDER BY pr.ordinal`,
    [limit, offset],
  );

  const rows = result.rows ?? [];
  const total = rows.length > 0 ? Number(rows[0].total ?? 0) : await countSaleProducts(hiddenClause, normalizedParentExpr);
  const numericIds = rows.map((r: { id: number | string }) => Number(r.id)).filter((n) => Number.isFinite(n));
  const imagesByProduct = await getImagesForProducts(numericIds);

  const products = rows.map((p: Record<string, unknown>) => {
    const pid = Number(p.id);
    const imgs = imagesByProduct.get(pid) || [];
    const primary = imgs.find((i) => i.is_primary) || imgs[0];
    const cdn = primary?.cdn_url ?? (p.image_cdn as string | null) ?? (p.image_url as string | null);
    const { total: _total, ...productRow } = p;
    return {
      ...productRow,
      id: pid,
      image_cdn: cdn,
      image_url: cdn,
      images: imgs.map((img) => ({
        id: img.id,
        url: img.cdn_url,
        is_primary: img.is_primary,
        p_hash: img.p_hash ?? undefined,
      })),
    };
  });

  return { products, total };
}
