/**
 * Shared Shopify scraper engine.
 *
 * Uses public Shopify JSON endpoints:
 *   /products.json?limit=250&page=N
 *   /collections/{handle}/products.json?limit=250&page=N
 *   /collections.json?limit=250&page=N
 */

import type { ScrapedProduct } from "./types";

export interface ShopifyVariant {
  id: number;
  title: string;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  price: string;
  compare_at_price: string | null;
  available: boolean;
  sku: string;
  inventory_quantity?: number;
}

export interface ShopifyProduct {
  id: number;
  title: string;
  handle: string;
  vendor: string;
  product_type: string;
  tags: string[];
  body_html: string;
  options: Array<{ name: string; position: number; values: string[] }>;
  variants: ShopifyVariant[];
  images: Array<{ id: number; src: string; alt?: string }>;
  created_at: string;
  updated_at: string;
}

export interface ShopifyCollection {
  id: number;
  handle: string;
  title: string;
}

export interface ShopifyVendorConfig {
  vendorName: string;
  vendorUrl: string;
  storeUrl: string;
  vendorRegion: string;
  currency: string;
  returnPolicy?: string;
  brand?: string;
  collections: string[];
  delayMs: number;
}

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

export async function scrapeShopifyStore(
  config: ShopifyVendorConfig
): Promise<ScrapedProduct[]> {
  console.log(`\n${config.vendorName} scraper (Shopify engine)`);
  console.log(`Store: ${config.storeUrl}`);
  console.log(`Mode: ${config.collections.length > 0 ? "by collection" : "all products"}\n`);

  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept: "application/json",
    "Accept-Language": "en-US,en;q=0.9",
  };

  const allProducts: ScrapedProduct[] = [];
  const seenIds = new Set<number>();

  const endpoints =
    config.collections.length === 0
      ? [{ url: `${config.storeUrl}/products.json`, category: "" }]
      : config.collections.map((handle) => ({
          url: `${config.storeUrl}/collections/${handle}/products.json`,
          category: handle.replace(/-/g, " "),
        }));

  for (const endpoint of endpoints) {
    const label = endpoint.category || "all products";
    console.log(`Collection: ${label}`);

    let page = 1;
    let totalThisEndpoint = 0;

    while (true) {
      const url = `${endpoint.url}?limit=250&page=${page}`;
      process.stdout.write(`  Page ${page}  `);

      try {
        const res = await fetch(url, { headers });

        if (res.status === 404) {
          console.log("-> 404 (collection not found, skipping)");
          break;
        }

        if (!res.ok) {
          console.log(`-> HTTP ${res.status} (stopping this collection)`);
          break;
        }

        const json = (await res.json()) as { products?: ShopifyProduct[] };
        const products = json.products ?? [];

        if (products.length === 0) {
          console.log("-> 0 (end of catalogue)");
          break;
        }

        let newRows = 0;
        for (const product of products) {
          if (seenIds.has(product.id)) continue;
          seenIds.add(product.id);

          const category = normalizeCategory(
            endpoint.category || product.product_type || product.tags?.[0] || null
          );
          const rows = mapShopifyProduct(product, config, category);
          allProducts.push(...rows);
          newRows += rows.length;
        }

        totalThisEndpoint += products.length;
        console.log(
          `-> ${products.length} products, ${newRows} rows` +
            (products.length < 250 ? " (last page)" : "")
        );

        if (products.length < 250) break;
        page += 1;
        await sleep(config.delayMs);
      } catch (err) {
        console.log(`-> Error: ${(err as Error).message}`);
        break;
      }
    }

    console.log(`  Completed ${totalThisEndpoint} raw products for "${label}"\n`);
  }

  console.log(`${config.vendorName}: ${allProducts.length} total rows\n`);
  return allProducts;
}

export async function fetchAllCollections(storeUrl: string): Promise<ShopifyCollection[]> {
  const collections: ShopifyCollection[] = [];
  let page = 1;

  while (true) {
    const res = await fetch(`${storeUrl}/collections.json?limit=250&page=${page}`, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json",
      },
    });
    if (!res.ok) break;

    const json = (await res.json()) as { collections?: ShopifyCollection[] };
    const batch = json.collections ?? [];
    collections.push(...batch);
    if (batch.length < 250) break;
    page += 1;
  }

  return collections;
}

function mapShopifyProduct(
  product: ShopifyProduct,
  config: ShopifyVendorConfig,
  category: string | null
): ScrapedProduct[] {
  const rows: ScrapedProduct[] = [];

  const optionNames = product.options.map((option) => option.name.toLowerCase());
  const sizeOptionIndexes = optionNames
    .map((name, index) =>
      name.includes("size") ||
      name === "length" ||
      name.includes("waist") ||
      name.includes("inseam")
        ? index
        : -1
    )
    .filter((index) => index >= 0);
  const colorIdx = optionNames.findIndex(
    (name) => name.includes("color") || name.includes("colour") || name.includes("shade")
  );

  const description = stripHtml(product.body_html) || null;
  const imageUrls = Array.from(
    new Set(
      (product.images ?? [])
        .map((image) => image?.src?.trim())
        .filter((value): value is string => Boolean(value))
    )
  );
  const primaryImage = imageUrls[0] ?? null;
  const parentProductUrl = canonicalizeParentProductUrl(
    `${config.vendorUrl}/products/${product.handle}`
  );
  const brand = config.brand ?? product.vendor ?? config.vendorName;
  const fallbackColor =
    extractColorFromDescription(product.body_html) ??
    extractColorFromTitleOrHandle(product.title, product.handle);
  const isShoeProduct = looksLikeShoeProduct(
    category || product.product_type || null,
    product.title,
    product.handle
  );
  const isInchMeasuredProduct = looksLikeInchMeasuredProduct(
    category || product.product_type || null,
    product.title,
    product.handle
  );

  for (const variant of product.variants) {
    const optVals = [variant.option1, variant.option2, variant.option3];
    const rawSize = sizeOptionIndexes
      .map((index) =>
        normalizeSize(
          optVals[index] ?? null,
          isShoeProduct,
          isInchMeasuredProduct,
          optionNames[index] ?? null
        )
      )
      .filter((value): value is string => Boolean(value))
      .join(" x ") || null;
    const rawColor = colorIdx >= 0 ? (optVals[colorIdx] ?? null) : null;
    const size = rawSize;
    const color = normalizeColor(rawColor) ?? fallbackColor;

    const priceCents = parsePriceToCents(variant.price);
    const compareAtCents = variant.compare_at_price
      ? parsePriceToCents(variant.compare_at_price)
      : null;

    const price_cents =
      compareAtCents && compareAtCents > priceCents ? compareAtCents : priceCents;
    const sales_price_cents =
      compareAtCents && compareAtCents > priceCents ? priceCents : null;

    const productUrl = variant.id
      ? `${parentProductUrl}?variant=${encodeURIComponent(String(variant.id))}`
      : parentProductUrl;

    rows.push({
      vendor_name: config.vendorName,
      vendor_url: config.vendorUrl,
      product_url: productUrl,
      parent_product_url: parentProductUrl,
      variant_id: variant.id ? String(variant.id) : null,
      vendor_region: config.vendorRegion,
      return_policy: config.returnPolicy,
      title: product.title,
      brand,
      category: category || product.product_type || null,
      description,
      size,
      color,
      currency: config.currency,
      price_cents,
      sales_price_cents,
      availability: variant.available,
      last_seen: new Date().toISOString(),
      image_url: primaryImage,
      image_urls: imageUrls.length ? imageUrls : null,
    });
  }

  if (rows.length === 0) {
    rows.push({
      vendor_name: config.vendorName,
      vendor_url: config.vendorUrl,
      product_url: parentProductUrl,
      parent_product_url: parentProductUrl,
      variant_id: null,
      vendor_region: config.vendorRegion,
      title: product.title,
      brand,
      category: category || product.product_type || null,
      description,
      size: null,
      color: null,
      currency: config.currency,
      price_cents: 0,
      sales_price_cents: null,
      availability: false,
      last_seen: new Date().toISOString(),
      image_url: primaryImage,
      image_urls: imageUrls.length ? imageUrls : null,
    });
  }

  return rows;
}

function parsePriceToCents(price: string | null | undefined): number {
  if (!price) return 0;
  const n = parseFloat(price.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCategory(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;

  if (/^denim$/i.test(trimmed)) return "Jeans";

  return trimmed;
}

function normalizeColor(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length ? trimmed : null;
}

function normalizeSize(
  value: string | null | undefined,
  isShoeProduct: boolean,
  isInchMeasuredProduct: boolean,
  optionName: string | null | undefined
): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;

  if (isShoeProduct) {
    if (/[A-Za-z]{2,}/.test(trimmed)) return trimmed;
    if (/^\d+(\.\d+)?$/.test(trimmed)) return `${trimmed} UK`;
    return trimmed;
  }

  if (isInchMeasuredProduct || looksLikeInchOption(optionName)) {
    if (/^\d+(\.\d+)?$/.test(trimmed)) return `${trimmed} in`;
  }

  return trimmed;
}

function extractColorFromDescription(html: string | null | undefined): string | null {
  if (!html) return null;

  const strongMatch = html.match(/colou?r\s*:\s*<\/strong>\s*([^<]+)/i);
  if (strongMatch?.[1]) {
    const value = cleanupColorCandidate(strongMatch[1]);
    if (value) return value;
  }

  const text = stripHtml(html);
  const textMatch = text.match(/\bcolou?r\s*:\s*([A-Za-z][A-Za-z0-9\s/&,'-]+)/i);
  if (textMatch?.[1]) {
    const value = cleanupColorCandidate(textMatch[1]);
    if (value) return value;
  }

  return null;
}

function extractColorFromTitleOrHandle(title: string | null | undefined, handle: string | null | undefined): string | null {
  const pipeSections = (title ?? "")
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
  if (pipeSections.length >= 2) {
    const fromPipe = cleanupColorCandidate(pipeSections[pipeSections.length - 1]);
    if (fromPipe) return fromPipe;
  }

  const fromTitle = extractTrailingColorWords((title ?? "").split(/\s+/));
  if (fromTitle) return fromTitle;

  const fromHandle = extractTrailingColorWords((handle ?? "").split("-"));
  if (fromHandle) return fromHandle;

  return null;
}

function extractTrailingColorWords(parts: string[]): string | null {
  const cleaned = parts
    .map((part) => part.trim())
    .filter(Boolean);

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

function looksLikeColorToken(token: string): boolean {
  const normalized = token.toLowerCase().replace(/[^a-z]/g, "");
  if (!normalized) return false;

  const known = new Set([
    "black",
    "white",
    "blue",
    "navy",
    "red",
    "green",
    "olive",
    "pink",
    "purple",
    "yellow",
    "orange",
    "brown",
    "tan",
    "beige",
    "camel",
    "cream",
    "ivory",
    "grey",
    "gray",
    "silver",
    "gold",
    "burgundy",
    "maroon",
    "wine",
    "khaki",
    "stone",
    "natural",
    "oat",
    "ecru",
    "denim",
    "indigo",
    "mustard",
    "rust",
    "sage",
    "lilac",
    "teal",
    "aqua",
    "mint",
    "chocolate",
    "espresso",
    "mocha",
    "bone",
    "sand",
    "taupe",
  ]);

  return known.has(normalized);
}

function cleanupColorCandidate(value: string): string | null {
  const cleaned = value
    .replace(/\bproduct code\b.*$/i, "")
    .replace(/\bsku\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:/-]+$/g, "")
    .trim();

  return cleaned.length ? cleaned : null;
}

function looksLikeShoeProduct(
  category: string | null | undefined,
  title: string | null | undefined,
  handle: string | null | undefined
): boolean {
  const text = `${category ?? ""} ${title ?? ""} ${handle ?? ""}`.toLowerCase();
  return /\b(shoe|shoes|boot|boots|sneaker|sneakers|loafer|loafers|sandal|sandals|heel|heels|flat|flats|mule|mules|slipper|slippers|clog|clogs|trainer|trainers)\b/.test(
    text
  );
}

function looksLikeInchMeasuredProduct(
  category: string | null | undefined,
  title: string | null | undefined,
  handle: string | null | undefined
): boolean {
  const text = `${category ?? ""} ${title ?? ""} ${handle ?? ""}`.toLowerCase();
  return /\b(jean|jeans|denim|pant|pants|trouser|trousers|short|shorts|skirt|skirts)\b/.test(
    text
  );
}

function looksLikeInchOption(optionName: string | null | undefined): boolean {
  const text = (optionName ?? "").toLowerCase();
  return text.includes("waist") || text.includes("length") || text.includes("inseam");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function toCsv(rows: ScrapedProduct[]): string {
  const cols: (keyof ScrapedProduct)[] = [
    "vendor_name",
    "vendor_url",
    "product_url",
    "parent_product_url",
    "variant_id",
    "vendor_region",
    "return_policy",
    "title",
    "brand",
    "category",
    "description",
    "size",
    "color",
    "currency",
    "price_cents",
    "sales_price_cents",
    "availability",
    "last_seen",
    "image_url",
  ];

  const esc = (value: unknown) => {
    if (value == null) return "";
    const str = String(value).replace(/"/g, '""');
    return /[,"\n]/.test(str) ? `"${str}"` : str;
  };

  return [
    cols.join(","),
    ...rows.map((row) => cols.map((col) => esc(row[col])).join(",")),
  ].join("\n");
}
