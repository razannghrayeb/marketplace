// src/lib/scrape/vendors/hm_us.ts
import type { ScrapedProduct } from "../types";

const VENDOR_URL = "https://www2.hm.com";
const VENDOR_NAME = "H&M";

function extractNextDataJson(html: string): any {
  const m = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
  );
  if (!m) throw new Error("__NEXT_DATA__ not found");
  return JSON.parse(m[1]);
}

function extractJsonLdProduct(html: string): {
  name?: string;
  brand?: string;
  description?: string;
  image?: string;
  price?: number;
  currency?: string;
} | null {
  const scripts = Array.from(html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g));
  for (const s of scripts) {
    const raw = s[1]?.trim();
    if (!raw) continue;
    try {
      const data = JSON.parse(raw);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        const candidates = Array.isArray(item["@graph"]) ? item["@graph"] : [item];
        for (const c of candidates) {
          if (c?.["@type"] !== "Product") continue;
          const offers = Array.isArray(c.offers) ? c.offers[0] : c.offers;
          const price = offers?.price != null ? Number(offers.price) : undefined;
          const currency = offers?.priceCurrency;
          const image = Array.isArray(c.image) ? c.image[0] : c.image;
          const brand =
            typeof c.brand === "string" ? c.brand :
            typeof c.brand?.name === "string" ? c.brand.name : undefined;
          return {
            name: typeof c.name === "string" ? c.name : undefined,
            brand,
            description: typeof c.description === "string" ? c.description : undefined,
            image: typeof image === "string" ? image : undefined,
            price: Number.isFinite(price as any) ? price : undefined,
            currency: typeof currency === "string" ? currency : undefined,
          };
        }
      }
    } catch {
      // ignore invalid JSON-LD
    }
  }
  return null;
}

function collectImageUrls(obj: any): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();

  const walk = (x: any) => {
    if (x == null) return;
    if (typeof x === "string") {
      // H&M images often look like: https://image.hm.com/assets/hm/...
      if (x.startsWith("https://image.hm.com/") && (x.includes(".jpg") || x.includes(".png") || x.includes(".webp"))) {
        if (!seen.has(x)) {
          seen.add(x);
          urls.push(x);
        }
      }
      return;
    }
    if (Array.isArray(x)) {
      for (const v of x) walk(v);
      return;
    }
    if (typeof x === "object") {
      for (const k of Object.keys(x)) walk(x[k]);
    }
  };

  walk(obj);
  return urls;
}

function findFirstSizesArray(obj: any): any[] | null {
  // We look for an array where items resemble your snippet:
  // { sizeCode: "...", size: "006", name: "XL", sizeScaleCode: "176" }
  const walk = (x: any): any[] | null => {
    if (!x) return null;

    if (Array.isArray(x)) {
      if (
        x.length > 0 &&
        typeof x[0] === "object" &&
        (("name" in x[0]) || ("size" in x[0])) &&
        (("sizeCode" in x[0]) || ("sku" in x[0]))
      ) {
        return x;
      }
      for (const v of x) {
        const r = walk(v);
        if (r) return r;
      }
      return null;
    }

    if (typeof x === "object") {
      for (const k of Object.keys(x)) {
        if (k.toLowerCase().includes("size") && Array.isArray((x as any)[k])) {
          const candidate = (x as any)[k];
          const ok =
            candidate.length > 0 &&
            typeof candidate[0] === "object" &&
            (("name" in candidate[0]) || ("size" in candidate[0]));
          if (ok) return candidate;
        }
        const r = walk((x as any)[k]);
        if (r) return r;
      }
    }

    return null;
  };

  return walk(obj);
}

function normalizeSizeValue(v: any): string | null {
  if (v == null) return null;
  if (typeof v === "string") {
    const t = v.trim();
    return t ? t : null;
  }
  if (typeof v === "object") {
    const cand =
      v.name ??
      v.size ??
      v.sizeName ??
      v.sizeLabel ??
      v.displayName ??
      v.label ??
      v.value;
    if (typeof cand === "string") {
      const t = cand.trim();
      return t ? t : null;
    }
  }
  return null;
}

function extractSizes(aemData: any, details: any): string[] | null {
  const candidates: any[] = [];

  const directArrays = [
    details?.sizes,
    details?.availableSizes,
    details?.variantSizes,
    details?.variants?.[0]?.sizes,
    details?.variants?.[0]?.availableSizes,
  ];

  for (const arr of directArrays) {
    if (Array.isArray(arr) && arr.length > 0) {
      candidates.push(arr);
    }
  }

  if (candidates.length === 0) {
    const found = findFirstSizesArray(aemData);
    if (Array.isArray(found) && found.length > 0) candidates.push(found);
  }

  if (candidates.length === 0) return null;

  const out = new Set<string>();
  for (const arr of candidates) {
    for (const item of arr) {
      const sz = normalizeSizeValue(item);
      if (sz) out.add(sz);
    }
  }

  return out.size ? Array.from(out) : null;
}

function findFirstStringByKeys(obj: any, keys: string[]): string | null {
  const keySet = new Set(keys.map((k) => k.toLowerCase()));

  const walk = (x: any): string | null => {
    if (!x) return null;
    if (typeof x !== "object") return null;

    for (const [k, v] of Object.entries(x)) {
      if (keySet.has(k.toLowerCase()) && typeof v === "string") {
        const t = v.trim();
        if (t) return t;
      }
    }

    for (const v of Object.values(x)) {
      if (typeof v === "object") {
        const r = walk(v);
        if (r) return r;
      }
    }

    return null;
  };

  return walk(obj);
}

function findFirstObjectByKeys(obj: any, keys: string[]): any | null {
  const keySet = new Set(keys.map((k) => k.toLowerCase()));

  const walk = (x: any): any | null => {
    if (!x || typeof x !== "object") return null;
    for (const [k, v] of Object.entries(x)) {
      if (keySet.has(k.toLowerCase()) && v && typeof v === "object") {
        return v;
      }
    }
    for (const v of Object.values(x)) {
      if (v && typeof v === "object") {
        const r = walk(v);
        if (r) return r;
      }
    }
    return null;
  };

  return walk(obj);
}

function extractColor(details: any, aemData: any): string | null {
  const direct =
    details?.colorName ??
    details?.colourName ??
    details?.color?.name ??
    details?.colour?.name ??
    details?.baseColor?.name ??
    details?.baseColour?.name ??
    details?.color ??
    details?.colour ??
    null;

  if (typeof direct === "string") {
    const t = direct.trim();
    if (t) return t;
  }

  return findFirstStringByKeys(aemData, ["colorName", "colourName"]);
}

function extractBrand(details: any, aemData: any): string | null {
  const direct =
    details?.brandName ??
    details?.brand?.name ??
    details?.brand ??
    null;
  if (typeof direct === "string") {
    const t = direct.trim();
    if (t) return t;
  }
  return findFirstStringByKeys(aemData, ["brand", "brandName"]);
}

function extractCategory(details: any, aemData: any): string | null {
  const normalize = (v: any): string | null => {
    if (v == null) return null;
    if (Array.isArray(v)) {
      const parts = v
        .map((x) => (typeof x === "string" ? x.trim() : null))
        .filter(Boolean) as string[];
      if (parts.length === 0) return null;
      return parts[parts.length - 1];
    }
    if (typeof v === "string") {
      const t = v.trim();
      if (!t) return null;
      if (t.includes("PRODUCT_DETAIL_PAGE")) return null;
      if (/^[A-Z0-9_]+$/.test(t)) return null;
      return t;
    }
    return null;
  };

  const direct =
    normalize(details?.categoryPath) ??
    normalize(details?.categoryName) ??
    normalize(details?.category) ??
    null;

  if (direct) return direct;

  return (
    normalize(findFirstStringByKeys(aemData, ["categoryPath", "categoryName", "category"])) ??
    null
  );
}

function extractDescription(details: any, aemData: any): string | null {
  const direct =
    details?.description ??
    details?.productDescription ??
    details?.longDescription ??
    details?.shortDescription ??
    null;
  if (typeof direct === "string") {
    const t = direct.trim();
    if (t) return t;
  }
  return findFirstStringByKeys(aemData, ["description", "productDescription", "longDescription", "shortDescription"]);
}

function findPriceFields(aemData: any): { currency?: string; value?: number; formatted?: string } {
  const s = JSON.stringify(aemData);

  // We prefer whitePriceValue + priceCurrency (you saw both)
  const valueMatch = s.match(/"whitePriceValue"\s*:\s*"([^"]+)"/);
  const currencyMatch = s.match(/"priceCurrency"\s*:\s*"([^"]+)"/);
  const formattedMatch = s.match(/"whitePrice"\s*:\s*"([^"]+)"/);

  const value = valueMatch ? Number(valueMatch[1]) : undefined;
  const currency = currencyMatch ? currencyMatch[1] : undefined;
  const formatted = formattedMatch ? formattedMatch[1] : undefined;

  return { currency, value, formatted };
}

export async function scrapeHmProductPage(productUrl: string): Promise<ScrapedProduct[]> {
  const res = await fetch(productUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  if (!res.ok) {
    throw new Error(`H&M fetch failed ${res.status} ${res.statusText} for ${productUrl}`);
  }

  const html = await res.text();
  const nextData = extractNextDataJson(html);

  const pageProps = nextData?.props?.pageProps;
  const productPageProps = pageProps?.productPageProps;
  const aemData = productPageProps?.aemData;
  const jsonLd = extractJsonLdProduct(html);

  if (!aemData) {
    // Some pages don't expose aemData; we'll fall back to other sources.
    // Keep aemData null and use generic extractors below.
  }

  const details =
    aemData?.productArticleDetails ??
    findFirstObjectByKeys(nextData, ["productArticleDetails"]) ??
    productPageProps?.product ??
    findFirstObjectByKeys(nextData, ["product"]);

  const title: string | undefined =
    details?.baseProductName ??
    details?.name ??
    jsonLd?.name ??
    findFirstStringByKeys(nextData, ["baseProductName", "name"]);

  const articleCode: string | undefined =
    details?.articleCode ??
    productPageProps?.articleCode ??
    findFirstStringByKeys(nextData, ["articleCode", "code"]);

  if (!title) throw new Error("Missing baseProductName");
  if (!articleCode) throw new Error("Missing articleCode");

  const price = aemData ? findPriceFields(aemData) : {};
  const priceValue = price.value ?? jsonLd?.price;
  if (!priceValue || Number.isNaN(priceValue) || priceValue <= 0) {
    throw new Error(`Invalid price for ${productUrl} (found: ${price.formatted ?? "none"})`);
  }

  const currency = price.currency ?? jsonLd?.currency ?? "USD";
  const price_cents = Math.round(priceValue * 100);

  const images = aemData ? collectImageUrls(aemData) : [];
  const image_url = images[0] ?? jsonLd?.image; // pick first; you can store more later if your schema supports it

  // Sizes (optional): if we find size array, we emit one row per size
  const sizes = extractSizes(aemData ?? nextData, details);
  const color = extractColor(details, aemData ?? nextData);
  const brand = extractBrand(details, aemData ?? nextData);
  const category = extractCategory(details, aemData ?? nextData);
  const description = extractDescription(details, aemData ?? nextData) ?? jsonLd?.description ?? null;

  const base: Omit<ScrapedProduct, "size"> = {
    vendor_name: VENDOR_NAME,
    vendor_url: VENDOR_URL,
    product_url: productUrl,
    title,
    brand: brand ?? null,
    category: category ?? null,
    description: description ?? null,
    color,
    currency,
    price_cents,
    image_url,
    // Optional fields (use only if your type includes them)
    // brand: VENDOR_NAME,
    // category: details?.categoryPath,
    // description: details?.pageId,
  } as any;

  if (sizes && sizes.length) {
    return sizes.map((sz: any) => ({
      ...base,
      size: (sz.name ?? sz.size ?? "").toString() || null,
      // If later you find stock value, you can map available here
      // available: typeof sz.stock === "number" ? sz.stock > 0 : true,
    })) as any;
  }

  // Fallback: single row without size
  return [{ ...base, size: null } as any];
}
