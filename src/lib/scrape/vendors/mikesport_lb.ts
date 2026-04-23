// src/lib/scrape/vendors/mikesport_lb.ts

import type { ScrapedProduct } from "../types";

const BASE = "https://lb.mikesport.com";
const VENDOR_NAME = "Mike Sport";

function canonicalizeParentProductUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1] ?? "";
    if (/-lebanon-\d+$/i.test(last)) {
      segments[segments.length - 1] = last.replace(/-\d+$/i, "");
      parsed.pathname = `/${segments.join("/")}`;
    }
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url.split("#")[0].split("?")[0];
  }
}

function ensureHttps(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("//")) return `https:${url}`;
  return url;
}

function htmlToText(html: string): string {
  return (html ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(value: string | null | undefined): string | null {
  if (!value) return null;
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#x60;/g, "`")
    .replace(/&#x3D;/g, "=");
}

function extractColorFromDescription(html: string | null | undefined): string | null {
  if (!html) return null;
  const m1 = html.match(/colou?r\s*:\s*<\/strong>\s*([^<]+)/i);
  if (m1?.[1]) return cleanupColorCandidate(m1[1]);
  const text = htmlToText(html);
  const m2 = text.match(/\bcolou?r\s*:\s*([A-Za-z0-9][A-Za-z0-9\s\/&\-,]+)\b/i);
  if (m2?.[1]) return cleanupColorCandidate(m2[1]);
  return null;
}

function extractSizeFromDescription(html: string | null | undefined): string | null {
  if (!html) return null;
  const m1 = html.match(/size\s*:\s*<\/strong>\s*([^<]+)/i);
  if (m1?.[1]) return m1[1].trim();
  const text = htmlToText(html);
  const m2 = text.match(/\bsize\s*:\s*([A-Za-z0-9][A-Za-z0-9\s\/&().,\-]+)\b/i);
  if (m2?.[1]) return m2[1].trim();
  return null;
}

function cleanupColorCandidate(value: string | null | undefined): string | null {
  const cleaned = String(value ?? "")
    .replace(/\bproduct code\b.*$/i, "")
    .replace(/\bsku\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:/-]+$/g, "")
    .trim();
  return cleaned.length ? cleaned : null;
}

function looksLikeColorToken(token: string): boolean {
  const normalized = token.toLowerCase().replace(/[^a-z]/g, "");
  if (!normalized) return false;

  const known = new Set([
    "black","white","blue","navy","red","green","olive","pink","purple","yellow",
    "orange","brown","tan","beige","camel","cream","ivory","grey","gray","silver",
    "gold","burgundy","maroon","wine","khaki","stone","natural","oat","ecru",
    "denim","indigo","mustard","rust","sage","lilac","teal","aqua","mint",
    "chocolate","espresso","mocha","bone","sand","taupe","graphite","charcoal",
    "coal","henna","merlot","pond","plum","rose","bordeaux","sienna","smoke",
  ]);

  return known.has(normalized);
}

function extractTrailingColorWords(parts: string[]): string | null {
  const cleaned = parts.map((part) => part.trim()).filter(Boolean);
  if (cleaned.length === 0) return null;

  const out: string[] = [];
  for (let i = cleaned.length - 1; i >= 0 && out.length < 3; i -= 1) {
    const token = cleaned[i];
    if (!looksLikeColorToken(token)) break;
    out.unshift(token);
  }

  if (out.length === 0) return null;
  return cleanupColorCandidate(out.join(" "));
}

function extractColorFromTitleOrHandle(title: string | null | undefined, handle: string | null | undefined): string | null {
  const fromTitle = extractTrailingColorWords((title ?? "").split(/\s+/));
  if (fromTitle) return fromTitle;

  const fromHandle = extractTrailingColorWords((handle ?? "").split("-"));
  if (fromHandle) return fromHandle;

  return null;
}

function normalizeOptionName(name: string | null | undefined): string {
  return (name ?? "").trim().toLowerCase();
}

function normalizeVariantValue(value: any): string | null {
  const v = String(value ?? "").trim();
  if (!v) return null;
  if (/^default title$/i.test(v)) return null;
  return v.length ? v : null;
}

function looksLikeSizeValue(value: string | null | undefined): boolean {
  const v = (value ?? "").trim().toLowerCase();
  if (!v) return false;
  if (v === "one size" || v === "onesize" || v === "os") return true;
  if (/^(xxs|xs|s|m|l|xl|xxl|xxxl|xxxxl)$/.test(v)) return true;
  if (/^\d{1,3}(\.\d+)?$/.test(v)) return true;
  if (/^\d{1,3}\s?(eu|us|uk|fr|it)$/.test(v)) return true;
  if (/^\d{1,3}\s?-\s?\d{1,3}\s?(eu|us|uk|fr|it)$/.test(v)) return true;
  if (/^\d{1,3}\s?1\/2\s?(eu|us|uk|fr|it)?$/.test(v)) return true;
  if (/^\d{1,3}\.\d\s?(eu|us|uk|fr|it)?$/.test(v)) return true;
  if (/^\d{1,2}\s?-\s?\d{1,2}\s?years?$/.test(v)) return true;
  if (/^\d{1,2}\s?years?$/.test(v)) return true;
  if (/^\d{1,2}y$/.test(v)) return true;
  return false;
}

function looksLikeGenderValue(value: string | null | undefined): boolean {
  const v = (value ?? "").trim().toLowerCase();
  if (!v) return false;
  if (v === "women" || v === "woman" || v === "men" || v === "man") return true;
  if (v === "girls" || v === "girl" || v === "boys" || v === "boy") return true;
  if (v === "kids" || v === "kid" || v === "unisex") return true;
  return false;
}

function guessOptionIndexes(product: any): { colorIndex: number; sizeIndex: number } {
  const options = Array.isArray(product?.options) ? product.options : [];
  const names = options.map((o: any) => String(o?.name ?? "")).filter(Boolean);
  const variants = Array.isArray(product?.variants) ? product.variants : [];

  if (
    options.length === 1 &&
    normalizeOptionName(names[0]) === "title" &&
    Array.isArray(options[0]?.values) &&
    options[0].values.every((v: any) => /^default title$/i.test(String(v ?? "").trim()))
  ) {
    return { colorIndex: -1, sizeIndex: -1 };
  }

  const valuesForIndex = (index: number): string[] => {
    if (index < 0) return [];
    const key = `option${index + 1}`;
    const out = new Set<string>();
    for (const variant of variants) {
      const value = normalizeVariantValue(variant?.[key]);
      if (value) out.add(value);
    }
    return Array.from(out);
  };

  const optionValuesAt = (index: number): string[] => {
    const configured = Array.isArray(options?.[index]?.values)
      ? options[index].values.map((v: any) => String(v ?? "")).filter(Boolean)
      : [];
    const actual = valuesForIndex(index);
    return configured.length > 0 ? configured : actual;
  };

  let colorIndex = names.findIndex((o: string) => {
    const name = normalizeOptionName(o);
    return name.includes("color") || name.includes("colour");
  });

  let sizeIndex = names.findIndex((o: string) => {
    const name = normalizeOptionName(o);
    return (
      name.includes("size") ||
      name.includes("taille") ||
      name.includes("talla") ||
      name.includes("taglia")
    );
  });

  if (colorIndex === -1 && options.length > 0) {
    colorIndex = options.findIndex((o: any) => {
      const optionIndex = options.indexOf(o);
      const values = optionValuesAt(optionIndex);
      return values.some((v: any) => {
        const value = String(v ?? "");
        return !looksLikeSizeValue(value) && !looksLikeGenderValue(value);
      });
    });
  }

  if (sizeIndex === -1 && options.length > 0) {
    sizeIndex = options.findIndex((o: any) => {
      const optionIndex = options.indexOf(o);
      const values = optionValuesAt(optionIndex);
      return values.some((v: any) => looksLikeSizeValue(String(v ?? "")));
    });
  }

  if (sizeIndex === -1 && names.length === 1 && colorIndex === -1) {
    const values = optionValuesAt(0);
    if (values.some((v: any) => looksLikeSizeValue(String(v ?? "")))) {
      sizeIndex = 0;
    } else {
      colorIndex = 0;
    }
  }

  if (colorIndex === -1 && names.length >= 2 && sizeIndex >= 0) {
    colorIndex = sizeIndex === 0 ? 1 : 0;
  }

  if (sizeIndex === -1 && names.length >= 2 && colorIndex >= 0) {
    sizeIndex = colorIndex === 0 ? 1 : 0;
  }

  if (sizeIndex >= 0 && options?.[sizeIndex]) {
    const values = optionValuesAt(sizeIndex);
    if (values.some((v: any) => looksLikeGenderValue(String(v ?? "")))) {
      sizeIndex = -1;
    }
  }

  if (colorIndex >= 0) {
    const values = optionValuesAt(colorIndex);
    if (values.length > 0 && values.every((v) => looksLikeSizeValue(String(v ?? "")))) {
      colorIndex = -1;
    }
  }

  return { colorIndex, sizeIndex };
}

function variantMoneyToCents(value: any): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    if (Number.isInteger(value) && value >= 1000) return value;
    return Math.round(value * 100);
  }
  const str = String(value).trim();
  if (!str) return null;
  if (!str.includes(".")) {
    const n = Number(str);
    if (!Number.isFinite(n)) return null;
    if (n >= 1000) return Math.trunc(n);
    return Math.round(n * 100);
  }
  const n = Number(str.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function pickGroupPrice(variants: any[]): { price: number; sale: number | null } {
  let bestPrice: number | null = null;
  let bestCompare: number | null = null;

  for (const v of variants) {
    const price = variantMoneyToCents(v?.price);
    if (price == null) continue;
    const compare = variantMoneyToCents(v?.compare_at_price);

    if (bestPrice == null || price < bestPrice) {
      bestPrice = price;
      bestCompare = compare ?? null;
    }
  }

  const price = bestPrice ?? 0;
  if (bestCompare != null && bestCompare > price) {
    return { price: bestCompare, sale: price };
  }
  return { price, sale: null };
}

function isVariantAvailable(v: any): boolean {
  if (typeof v?.available === "boolean") return v.available;
  if (typeof v?.available === "number") return v.available > 0;
  if (typeof v?.inventory_quantity === "number") return v.inventory_quantity > 0;
  if (v?.inventory_management == null) return true;
  return false;
}

/**
 * Fetch ALL products from Shopify using pagination.
 * Shopify max limit is 250; use page=1..n until empty.
 */
export async function fetchAllMikesportRawProducts(): Promise<any[]> {
  const all: any[] = [];
  const startPage = Number(process.env.MIKESPORT_START_PAGE ?? "1");
  let page = Number.isFinite(startPage) && startPage > 0 ? startPage : 1;

  const maxPagesEnv = Number(process.env.MIKESPORT_MAX_PAGES ?? "0");
  const maxPages = Number.isFinite(maxPagesEnv) && maxPagesEnv > 0 ? maxPagesEnv : null;

  while (true) {
    if (maxPages != null && page > (startPage + maxPages - 1)) break;
    const url = `${BASE}/products.json?limit=250&page=${page}`;
    let res: Response | null = null;
    let lastStatus: number | null = null;
    const attempts = 5;
    for (let i = 0; i < attempts; i += 1) {
      res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0",
          Accept: "application/json",
        },
      });

      if (res.ok || res.status === 400) break;

      lastStatus = res.status;
      if (res.status === 503 || res.status === 502 || res.status === 429) {
        const delay = 750 * Math.pow(2, i);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      break;
    }

    if (!res) throw new Error(`MikeSport products.json failed (page=${page})`);

    if (!res.ok) {
      if (res.status === 400) break;
      throw new Error(
        `MikeSport products.json failed (page=${page}): ${res.status}. ` +
          `Set MIKESPORT_START_PAGE=${page} to resume.`
      );
    }

    const data = await res.json();
    const products: any[] = data?.products ?? [];
    if (products.length === 0) break;

    all.push(...products);
    page += 1;
  }

  return all;
}

/**
 * Convert MikeSport Shopify product into ScrapedProduct rows.
 * Group by color with size list, one row per color (variant URL uses ?variant=ID).
 */
export function mapMikesportProductToScrapedRows(product: any): ScrapedProduct[] {
  const vendor_name = VENDOR_NAME;
  const vendor_url = BASE;

  const handle = String(product?.handle ?? "").trim();
  const baseProductUrl = canonicalizeParentProductUrl(
    handle ? `${BASE}/products/${handle}` : BASE
  );

  const title = decodeHtmlEntities(String(product?.title ?? "").trim()) || "Untitled";

  const brandRaw = decodeHtmlEntities(String(product?.vendor ?? "").trim());
  const brand = brandRaw ? brandRaw : null;

  const categoryRaw = decodeHtmlEntities(String(product?.product_type ?? "").trim());
  const category = categoryRaw ? categoryRaw : null;

  const description = String(product?.body_html ?? "").trim() || null;

  const colorFromDesc = extractColorFromDescription(description ?? "");
  const colorFallback = colorFromDesc ?? extractColorFromTitleOrHandle(title, handle);
  const sizeFromDesc = extractSizeFromDescription(description ?? "");

  const image_urls = Array.isArray(product?.images)
    ? product.images
        .map((img: any) => ensureHttps(img?.src ?? img))
        .filter((u: string | null): u is string => Boolean(u))
    : null;

  const imageById = new Map<string, string>();
  if (Array.isArray(product?.images)) {
    for (const img of product.images) {
      const id = img?.id ? String(img.id) : null;
      const src = ensureHttps(img?.src ?? null);
      if (id && src) imageById.set(id, src);
    }
  }

  const defaultImage = image_urls?.[0] ?? ensureHttps(product?.image?.src ?? product?.featured_image) ?? null;

  const return_policy =
    "Return policy applies as per Mike Sport Lebanon website. Please refer to the vendor's Shipping & Returns page.";

  const variants: any[] = Array.isArray(product?.variants) ? product.variants : [];

  if (variants.length === 0) {
    return [
      {
        vendor_name,
        vendor_url,
        product_url: baseProductUrl,
        parent_product_url: baseProductUrl,
        variant_id: null,
        title,
        brand,
        category,
        description,
        size: sizeFromDesc,
        color: colorFallback,
        currency: "USD",
        price_cents: 0,
        sales_price_cents: null,
        availability: false,
        image_url: defaultImage ?? undefined,
        image_urls,
        return_policy,
      },
    ];
  }

  const { colorIndex, sizeIndex } = guessOptionIndexes(product);

  const groupMap = new Map<string, { color: string | null; variants: any[] }>();
  for (const v of variants) {
    const optionsList = [v?.option1, v?.option2, v?.option3];
    const colorValue = colorIndex >= 0 ? normalizeVariantValue(optionsList[colorIndex]) : null;
    const key = colorValue ?? "__default__";
    const entry = groupMap.get(key) ?? { color: colorValue, variants: [] };
    entry.variants.push(v);
    groupMap.set(key, entry);
  }

  const rows: ScrapedProduct[] = [];

  for (const { color: groupColor, variants: groupVariants } of groupMap.values()) {
    const sizeSet: string[] = [];
    const sizeSeen = new Set<string>();
    for (const v of groupVariants) {
      const optionsList = [v?.option1, v?.option2, v?.option3];
      const sizeValue = sizeIndex >= 0 ? normalizeVariantValue(optionsList[sizeIndex]) : null;
      if (sizeValue && looksLikeSizeValue(sizeValue) && !sizeSeen.has(sizeValue)) {
        sizeSeen.add(sizeValue);
        sizeSet.push(sizeValue);
      }
    }

    const sizeValue = sizeSet.length ? sizeSet.join(", ") : null;
    const { price, sale } = pickGroupPrice(groupVariants);
    const groupAvailable = groupVariants.some((v) => isVariantAvailable(v));

    const variantIds = groupVariants
      .map((v) => v?.id)
      .filter((v) => v != null)
      .map((v) => String(v));
    const variantIdValue = variantIds.length ? variantIds[0] : null;
    const primaryVariantId = variantIds.length ? variantIds[0] : null;

    let groupImage: string | null = null;
    for (const v of groupVariants) {
      const imageId = v?.image_id ? String(v.image_id) : null;
      if (imageId && imageById.has(imageId)) {
        groupImage = imageById.get(imageId) ?? null;
        break;
      }
      const featured = ensureHttps(v?.featured_image?.src ?? v?.image?.src ?? null);
      if (featured) {
        groupImage = featured;
        break;
      }
    }

    // If Shopify exposes no real color option, keep one stable product row.
    const hasRealColorOption = colorIndex >= 0 && groupColor != null;
    const product_url = hasRealColorOption && primaryVariantId
      ? `${baseProductUrl}?variant=${encodeURIComponent(primaryVariantId)}`
      : baseProductUrl;

    rows.push({
      vendor_name,
      vendor_url,
      product_url,
      parent_product_url: baseProductUrl,
      variant_id: variantIdValue,
      title,
      brand,
      category,
      description,
      size: sizeValue ?? sizeFromDesc,
      color: groupColor ?? colorFallback,
      currency: "USD",
      price_cents: price,
      sales_price_cents: sale,
      availability: groupAvailable,
      image_url: groupImage ?? defaultImage ?? undefined,
      image_urls,
      return_policy,
    });
  }

  return rows;
}

/**
 * High-level function: fetch all products and return ScrapedProduct rows.
 */
export async function scrapeAllMikesport(): Promise<ScrapedProduct[]> {
  const raw = await fetchAllMikesportRawProducts();

  const rows: ScrapedProduct[] = [];
  const seen = new Set<string>();

  for (const p of raw) {
    const mapped = mapMikesportProductToScrapedRows(p);
    for (const row of mapped) {
      if (!row.product_url) continue;
      if (seen.has(row.product_url)) continue;
      seen.add(row.product_url);
      rows.push(row);
    }
  }

  return rows;
}
