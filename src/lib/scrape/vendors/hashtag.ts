import type { ScrapedProduct } from "../types";

const BASE_URL = "https://www.hashtag-lb.com";
const RETURN_POLICY =
  "All sales conducted through Hashtag are considered final unless otherwise specified in this policy. " +
  "Size-Based Purchases: Items accompanied by a published size chart are non-returnable and non-refundable if the incorrect size is selected. " +
  "It is the purchaser's responsibility to review the size chart and select the correct size. " +
  "Defective or Damaged Goods: If an item is received defective, damaged, or materially different from what was advertised, you must notify Hashtag in writing within 7 calendar days of receipt. " +
  "Upon verification, Hashtag may, at its discretion, authorize replacement of the defective item or issuance of a store credit equal to the purchase value. " +
  "Refunds to the original payment method are considered only in exceptional cases, subject to management approval.";

type ShopifyImage = {
  src?: string;
};

type ShopifyVariant = {
  id: number;
  title?: string | null;
  price?: number | string | null;
  compare_at_price?: number | string | null;
  available?: boolean;
  option1?: string | null;
  option2?: string | null;
  option3?: string | null;
};

type ShopifyProduct = {
  id: number;
  title?: string;
  handle?: string;
  description?: string;
  vendor?: string;
  type?: string;
  url?: string;
  featured_image?: string | null;
  images?: Array<string | ShopifyImage>;
  available?: boolean;
  price?: number | string | null;
  compare_at_price?: number | string | null;
  options?: Array<string | { name?: string | null }>;
  variants?: ShopifyVariant[];
};

const RETRYABLE_ERROR_CODES = new Set([
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableFetchError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const anyErr = err as any;
  if (anyErr?.name === "AbortError") return true;
  const code = anyErr?.code || anyErr?.cause?.code;
  return typeof code === "string" && RETRYABLE_ERROR_CODES.has(code);
}

async function fetchWithRetry(url: string, init: RequestInit, attempts = 5): Promise<Response> {
  let lastErr: unknown = null;

  for (let i = 0; i < attempts; i += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch(url, {
        ...init,
        signal: controller.signal,
      });
      if (res.status === 429 && i < attempts - 1) {
        clearTimeout(timeout);
        const backoffMs = 3000 * Math.pow(2, i);
        console.log(`429 rate-limited, waiting ${backoffMs}ms before retry ${i + 1}...`);
        await sleep(backoffMs);
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (!isRetryableFetchError(err) || i === attempts - 1) throw err;
      const backoffMs = 600 * Math.pow(2, i);
      await sleep(backoffMs);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastErr;
}

function absoluteUrl(path?: string | null): string | null {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  if (path.startsWith("//")) return `https:${path}`;
  return new URL(path, BASE_URL).toString();
}

function toCents(value: unknown): number {
  if (value == null || value === "") return 0;

  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.round(value) : 0;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return 0;

    const n = Number(trimmed.replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) ? Math.round(n) : 0;
  }

  return 0;
}

function cleanHtmlText(html?: string | null): string | null {
  if (!html) return null;

  const text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return text || null;
}

function extractImageUrl(product: ShopifyProduct): string | null {
  if (product.featured_image) {
    return absoluteUrl(product.featured_image);
  }

  const firstImage = product.images?.[0];
  if (!firstImage) return null;

  if (typeof firstImage === "string") {
    return absoluteUrl(firstImage);
  }

  return absoluteUrl(firstImage.src ?? null);
}

function isOneSizeText(value: string | null | undefined): boolean {
  if (!value) return false;
  const t = value.toLowerCase();
  return /\b(one[\s-]?size|onesize|free\s*size|os)\b/i.test(t);
}


function mapVariantOptions(
  optionNames: Array<string | { name?: string | null }> | undefined,
  variant: ShopifyVariant | null
): { size: string | null; color: string | null } {
  let size: string | null = null;
  let color: string | null = null;

  if (!variant) return { size, color };

  const names = (optionNames ?? []).map((x) => {
    if (typeof x === "string") return x.toLowerCase().trim();
    return (x?.name ?? "").toLowerCase().trim();
  });

  if (names[0] === "size") {
    size = variant.option1 ?? null;
  } else if (names[0] === "color" || names[0] === "colour") {
    color = variant.option1 ?? null;
  }

  if (names[1] === "size") {
    size = variant.option2 ?? null;
  } else if (names[1] === "color" || names[1] === "colour") {
    color = variant.option2 ?? null;
  }

  if (names[2] === "size") {
    size = variant.option3 ?? null;
  } else if (names[2] === "color" || names[2] === "colour") {
    color = variant.option3 ?? null;
  }

  return { size, color };
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetchWithRetry(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json,text/plain,*/*",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status}`);
  }

  return (await res.json()) as T;
}

export async function getProductLinksFromCollection(collectionUrl: string): Promise<string[]> {
  const links = new Set<string>();
  const MAX_PAGES = 50;
  let emptyStreak = 0;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const pageUrl = (() => {
      try {
        const url = new URL(collectionUrl);
        url.searchParams.set("page", String(page));
        return url.toString();
      } catch {
        return collectionUrl;
      }
    })();

    const res = await fetchWithRetry(pageUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
      },
    });

    if (!res.ok) {
      if (page === 1) {
        throw new Error(`Failed to fetch ${collectionUrl}: ${res.status}`);
      }
      break;
    }

    const html = await res.text();
    const matches = [...html.matchAll(/href=['"]([^'"]*\/products\/[^'"]+)['"]/g)];
    let added = 0;

    for (const match of matches) {
      const href = match[1];
      const full = absoluteUrl(href);
      if (full) {
        const normalized = full.split("?")[0];
        if (!links.has(normalized)) {
          links.add(normalized);
          added += 1;
        }
      }
    }

    if (matches.length === 0 || added === 0) {
      emptyStreak += 1;
    } else {
      emptyStreak = 0;
    }

    if (emptyStreak >= 2) break;

    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  return [...links];
}

export async function scrapeHashtagProduct(productUrl: string): Promise<ScrapedProduct[]> {
  try {
    const baseProductUrl = productUrl.split("?")[0];
    const jsonUrl = `${baseProductUrl}.js`;
    const data = await fetchJson<ShopifyProduct>(jsonUrl);

    const description = cleanHtmlText(data.description);

    const optionNames = (data.options ?? []).map((x) => {
      if (typeof x === "string") return x.toLowerCase().trim();
      return (x?.name ?? "").toLowerCase().trim();
    });

    const parentProductUrl = absoluteUrl(data.url ?? baseProductUrl) || baseProductUrl;
    const allImageUrls = (data.images ?? [])
      .map((img) => {
        if (typeof img === "string") return absoluteUrl(img);
        return absoluteUrl(img?.src ?? null);
      })
      .filter((u): u is string => Boolean(u));

    const fallbackImageUrl =
      extractImageUrl(data) || allImageUrls[0] || null;

    const results: ScrapedProduct[] = [];

    for (const variant of data.variants ?? []) {
      let size: string | null = null;
      let color: string | null = null;

      if (optionNames[0] === "size") size = variant.option1 ?? null;
      if (optionNames[0] === "color" || optionNames[0] === "colour") color = variant.option1 ?? null;

      if (optionNames[1] === "size") size = variant.option2 ?? null;
      if (optionNames[1] === "color" || optionNames[1] === "colour") color = variant.option2 ?? null;

      if (optionNames[2] === "size") size = variant.option3 ?? null;
      if (optionNames[2] === "color" || optionNames[2] === "colour") color = variant.option3 ?? null;

      if (!size && isOneSizeText(description)) {
        size = "ONE SIZE";
      }

      results.push({
        vendor_name: "Hashtag",
        vendor_url: BASE_URL,
        parent_product_url: parentProductUrl,
        product_url: `${parentProductUrl}#variant=${variant.id}`,
        variant_id: String(variant.id),

        vendor_region: "Lebanon",
        return_policy: RETURN_POLICY,

        title: data.title?.trim() || "",
        brand: data.vendor?.trim() || null,
        category: data.type?.trim() || null,
        description,

        size,
        color,

        currency: "USD",
        price_cents: toCents(variant.price ?? data.price),
        sales_price_cents: (() => {
          const compare = toCents(variant.compare_at_price ?? data.compare_at_price);
          return compare > 0 ? compare : null;
        })(),

        availability: Boolean(variant.available),
        last_seen: new Date().toISOString(),

        image_url: fallbackImageUrl,
        image_urls: allImageUrls.length > 0 ? allImageUrls : null,
      });
    }

    return results;
  } catch (error) {
    console.error("Failed scraping product:", productUrl, error);
    return [];
  }
}

export async function scrapeHashtagCollection(collectionUrl: string): Promise<ScrapedProduct[]> {
  const productLinks = await getProductLinksFromCollection(collectionUrl);
  const results: ScrapedProduct[] = [];

  for (const productUrl of productLinks) {
    try {
      const variantRows = await scrapeHashtagProduct(productUrl);
      results.push(...variantRows);

      await new Promise((resolve) => setTimeout(resolve, 3000));
    } catch (error) {
      console.error("Failed scraping product:", productUrl, error);
    }
  }

  return results;
}
