/**
 * Merge parent `products` rows with `product_variants` for API / search responses.
 */
import { normalizeColorToken, expandColorTermsForFilter } from "../color/queryColorFilter";
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

function variantRowMatchesColorHints(variant: ProductVariantRow, hints: string[]): boolean {
  const raw = String(variant.color ?? "").trim();
  if (!raw) return false;
  const rawLower = raw.toLowerCase();
  for (const h of hints) {
    const trimmed = String(h ?? "").trim();
    if (!trimmed) continue;
    const hc = normalizeColorToken(trimmed) ?? trimmed.toLowerCase();
    const terms = expandColorTermsForFilter(hc);
    for (const t of terms) {
      const tl = String(t).toLowerCase();
      if (!tl) continue;
      if (rawLower.includes(tl) || tl.includes(rawLower)) return true;
    }
    const vCanon = normalizeColorToken(raw);
    if (vCanon && normalizeColorToken(trimmed) === vCanon) return true;
  }
  return false;
}

/**
 * Pick a SKU whose `color` matches any of the hints (OpenSearch primary color, filter, query).
 * Prefer `is_default` among matches, then lowest id. Returns null if no hint or no match.
 */
const TEXT_HINT_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "your",
  "you",
  "are",
  "was",
  "has",
  "have",
  "had",
  "not",
  "but",
  "our",
  "out",
  "new",
  "all",
  "any",
  "can",
  "get",
  "use",
  "its",
  "his",
  "her",
]);

function tokenizeForVariantMatch(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s\u00c0-\u024f]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 2 && !TEXT_HINT_STOPWORDS.has(t));
}

/**
 * When the query mentions words that appear on a specific SKU (description, color, size, URL), prefer that row.
 */
export function pickVariantForTextHints(
  variants: ProductVariantRow[],
  rawQuery: string | null | undefined,
): ProductVariantRow | null {
  const q = String(rawQuery ?? "").trim();
  if (!q || variants.length === 0) return null;
  const tokens = tokenizeForVariantMatch(q);
  if (tokens.length === 0) return null;

  let best: ProductVariantRow | null = null;
  let bestScore = -1;

  for (const v of variants) {
    const blob = [v.description, v.color, v.size, v.product_url, v.variant_id]
      .filter((x) => x != null && String(x).trim() !== "")
      .join(" ")
      .toLowerCase();
    if (!blob) continue;
    let score = 0;
    for (const t of tokens) {
      if (blob.includes(t)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = v;
    } else if (score === bestScore && score > 0 && best) {
      if (v.is_default && !best.is_default) best = v;
      else if (v.is_default === best.is_default && v.id < best.id) best = v;
    }
  }
  return bestScore > 0 ? best : null;
}

/**
 * Search/browse: color hints first (filters + per-hit OS color), then lexical match on variant text fields.
 */
export function pickDisplaySkuForSearch(
  variants: ProductVariantRow[],
  options: {
    colorHints?: (string | null | undefined)[];
    textQuery?: string | null;
  },
): ProductVariantRow | null {
  const fromColor =
    options.colorHints && options.colorHints.length > 0
      ? pickVariantForColorHints(variants, options.colorHints)
      : null;
  if (fromColor) return fromColor;
  return pickVariantForTextHints(variants, options.textQuery ?? null);
}

export function pickVariantForColorHints(
  variants: ProductVariantRow[],
  hints: (string | null | undefined)[],
): ProductVariantRow | null {
  const unique = [
    ...new Set(
      hints
        .map((h) => String(h ?? "").trim())
        .filter((h) => h.length > 0),
    ),
  ];
  if (variants.length === 0 || unique.length === 0) return null;

  const matches = variants.filter((v) => variantRowMatchesColorHints(v, unique));
  if (matches.length === 0) return null;

  matches.sort((a, b) => {
    if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
    return a.id - b.id;
  });
  return matches[0];
}

/**
 * Put the variant listing image first so card UIs match the SKU shown (price/color/url).
 */
export function mergeVariantPrimaryImageIntoProductImages(
  variantId: number | null | undefined,
  variantImageUrl: string | null | undefined,
  gallery: Array<{ id: number; url: string; is_primary?: boolean; p_hash?: string | null }>,
): Array<{ id: number; url: string; is_primary?: boolean; p_hash?: string | null }> {
  const v = String(variantImageUrl ?? "").trim();
  if (!v) return gallery;
  const syntheticId =
    variantId != null && Number.isFinite(Number(variantId)) && Number(variantId) > 0
      ? -Math.abs(Number(variantId))
      : -1;
  const rest = gallery.filter((img) => String(img.url ?? "").trim() !== v);
  return [
    { id: syntheticId, url: v, is_primary: true },
    ...rest.map((img) => ({ ...img, is_primary: false })),
  ];
}

export type ResolveDisplayVariantFn = (
  productId: number,
  variants: ProductVariantRow[],
) => ProductVariantRow | null | undefined;

/**
 * Apply variant summary fields to one parent row (no DB).
 * @param displayVariant — when set and present in `variants`, drives price/image/size/color for this row; otherwise default SKU.
 */
export function applyVariantSummaryToProduct<T extends { id: number | string }>(
  p: T,
  variants: ProductVariantRow[],
  displayVariant?: ProductVariantRow | null,
): T {
  if (variants.length === 0) return { ...p } as T;

  const d =
    displayVariant != null && variants.some((v) => v.id === displayVariant.id)
      ? displayVariant
      : pickDefaultVariant(variants);
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

    // When SKUs exist, default variant is source of truth for sellable fields (API / listings).
    const variantPrice = parseCents(d.price_cents);
    if (variantPrice != null) out.price_cents = variantPrice;

    out.sales_price_cents = parseCents(d.sales_price_cents);

    if (d.currency != null && String(d.currency).trim() !== "") {
      out.currency = d.currency;
    }
    out.availability = Boolean(d.availability);
    out.last_seen = d.last_seen;

    if (d.size != null && String(d.size).trim() !== "") out.size = d.size;
    if (d.color != null && String(d.color).trim() !== "") out.color = d.color;

    const vDesc =
      d.description != null && String(d.description).trim() !== ""
        ? String(d.description).trim()
        : null;
    if (vDesc) out.description = vDesc;

    if (d.image_url != null && String(d.image_url).trim() !== "") {
      const u = String(d.image_url).trim();
      out.image_url = u;
      (out as any).image_cdn = u;
    }
  }

  return out as T;
}

/**
 * Batch-load variants and merge: range fields from all SKUs, display fields from chosen or default SKU.
 */
export async function enrichProductsWithVariantSummary<T extends { id: number | string }>(
  products: T[],
  options?: { resolveDisplayVariant?: ResolveDisplayVariantFn },
): Promise<T[]> {
  if (products.length === 0) return products;

  const ids = [...new Set(products.map((p) => Number(p.id)).filter((n) => Number.isFinite(n) && n > 0))];
  if (ids.length === 0) return products.map((p) => ({ ...p }) as T);

  const byParent = await getVariantsByProductIds(ids);

  return products.map((p) => {
    const pid = Number(p.id);
    const variants = byParent.get(pid) ?? [];
    const chosen = options?.resolveDisplayVariant?.(pid, variants);
    return applyVariantSummaryToProduct(p, variants, chosen ?? undefined);
  });
}
