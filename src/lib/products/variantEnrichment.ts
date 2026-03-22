/**
 * Merge parent `products` rows with `product_variants` for API / search responses.
 */
import { getVariantsByProductIds, type ProductVariantRow } from "./productVariants";

function pickDefaultVariant(variants: ProductVariantRow[]): ProductVariantRow | null {
  if (variants.length === 0) return null;
  const marked = variants.find((v) => v.is_default);
  if (marked) return marked;
  return [...variants].sort((a, b) => a.id - b.id)[0];
}

function parseCents(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Apply variant summary fields to one parent row (no DB).
 */
export function applyVariantSummaryToProduct<T extends { id: number | string }>(
  p: T,
  variants: ProductVariantRow[],
): T {
  if (variants.length === 0) return { ...p } as T;

  const d = pickDefaultVariant(variants);
  const centsList = variants
    .map((v) => parseCents(v.price_cents))
    .filter((n): n is number => n != null);
  const minCents = centsList.length > 0 ? Math.min(...centsList) : null;
  const maxCents = centsList.length > 0 ? Math.max(...centsList) : null;
  const salesList = variants
    .map((v) => parseCents(v.sales_price_cents))
    .filter((n): n is number => n != null);
  const minSales = salesList.length > 0 ? Math.min(...salesList) : null;

  const out: Record<string, unknown> = { ...(p as object) };
  out.variant_count = variants.length;
  if (minCents != null) out.min_price_cents = minCents;
  if (maxCents != null) out.max_price_cents = maxCents;
  if (minSales != null) out.min_sales_price_cents = minSales;

  if (d) {
    out.default_variant_id = d.id;
    out.default_variant_url = d.product_url;

    const sz = String((p as any).size ?? "").trim();
    if (!sz && d.size) out.size = d.size;

    const col = String((p as any).color ?? "").trim();
    if (!col && d.color) out.color = d.color;

    const parentSales = parseCents((p as any).sales_price_cents);
    if (parentSales == null && d.sales_price_cents != null) {
      const sc = parseCents(d.sales_price_cents);
      if (sc != null) out.sales_price_cents = sc;
    }

    const parentImg = String((p as any).image_url ?? "").trim();
    if (!parentImg && d.image_url) out.image_url = d.image_url;
  }

  return out as T;
}

/**
 * Batch-load variants and attach summary + default-SKU fields when the parent row
 * omits size/color (common after migrate-to-product-variants).
 */
export async function enrichProductsWithVariantSummary<T extends { id: number | string }>(
  products: T[],
): Promise<T[]> {
  if (products.length === 0) return products;

  const ids = [...new Set(products.map((p) => Number(p.id)).filter((n) => Number.isFinite(n) && n > 0))];
  if (ids.length === 0) return products.map((p) => ({ ...p }) as T);

  const byParent = await getVariantsByProductIds(ids);

  return products.map((p) => {
    const pid = Number(p.id);
    const variants = byParent.get(pid) ?? [];
    return applyVariantSummaryToProduct(p, variants);
  });
}
