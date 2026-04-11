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

function orderClause(sort: string | undefined): string {
  switch (sort) {
    case "price_asc":
      return "p.sales_price_cents ASC NULLS LAST, p.id DESC";
    case "price_desc":
      return "p.sales_price_cents DESC NULLS LAST, p.id DESC";
    case "discount":
    default:
      return `(
          (p.price_cents - p.sales_price_cents)::numeric
          / NULLIF(p.price_cents, 0)
        ) DESC NULLS LAST,
        p.sales_price_cents ASC,
        p.id DESC`;
  }
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

  const countResult = await pg.query<{ c: string }>(
    `SELECT COUNT(*)::int AS c
     FROM products p
     WHERE 1=1
       ${hiddenClause}
       AND ${SALE_WHERE.replace(/\n/g, " ")}`,
  );
  const total = Number(countResult.rows[0]?.c ?? 0);

  const orderSql = orderClause(sort);
  const result = await pg.query(
    `SELECT p.*, v.name as vendor_name
     FROM products p
     LEFT JOIN vendors v ON v.id = p.vendor_id
     WHERE 1=1
       ${hiddenClause}
       AND ${SALE_WHERE.replace(/\n/g, " ")}
     ORDER BY ${orderSql}
     LIMIT $1 OFFSET $2`,
    [limit, offset],
  );

  const rows = result.rows ?? [];
  const numericIds = rows.map((r: { id: number | string }) => Number(r.id)).filter((n) => Number.isFinite(n));
  const imagesByProduct = await getImagesForProducts(numericIds);

  const products = rows.map((p: Record<string, unknown>) => {
    const pid = Number(p.id);
    const imgs = imagesByProduct.get(pid) || [];
    const primary = imgs.find((i) => i.is_primary) || imgs[0];
    const cdn = primary?.cdn_url ?? (p.image_cdn as string | null) ?? (p.image_url as string | null);
    return {
      ...p,
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
