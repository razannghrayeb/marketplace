import { load } from "cheerio";
import type { ScrapedProduct } from "../types";
import { normalizeColorTokensFromRaw } from "../../color/queryColorFilter";

const VENDOR_NAME = "Moustache";
const VENDOR_URL = "https://moustachestores.com";
const RETURN_POLICY =
  "Exchanges only at MOUSTACHE Lebanon stores within 7 days of collection with invoice; items must be unworn, unwashed, unaltered, with tags. Shoes must be tried on carpet. No cash refunds. Faulty goods can be returned within 7 days for repair or replacement if available; otherwise exchanged per policy.";

function safeText(s?: string | null) {
  const t = (s ?? "").trim();
  return t.length ? t : null;
}

function normalizeUrl(url: string): string {
  return new URL(url, VENDOR_URL).toString();
}

function canonicalizeParentProductUrl(url: string): string {
  try {
    const parsed = new URL(url, VENDOR_URL);
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

function moneyToCents(s: string): number {
  const n = Number(String(s).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function detectCurrency(s: string): string {
  if (/\$|USD/i.test(s)) return "USD";
  if (/EUR/i.test(s)) return "EUR";
  return "USD";
}

function inferAvailability($: ReturnType<typeof load>): boolean {
  const stockText = $(".stock, .stock-status, .product-stock-status")
    .first()
    .text()
    .toLowerCase()
    .trim();

  if (stockText.includes("out of stock") || stockText.includes("sold out")) {
    return false;
  }

  const button = $("button[type='submit'].product-form__add-button, button.product-form__add-button, button[name='add']")
    .first();
  const disabled = button.attr("disabled");
  const ariaDisabled = button.attr("aria-disabled");
  const buttonText = button.text().toLowerCase();
  if (disabled != null || ariaDisabled === "true") return false;
  if (button.hasClass("disabled") || button.hasClass("is-disabled")) return false;
  if (buttonText.includes("sold out") || buttonText.includes("unavailable")) return false;

  return true;
}

function parseJsonSafe<T = any>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function extractShopifyProductJson($: ReturnType<typeof load>): any | null {
  const scripts = $("script[type='application/json']");
  for (const el of scripts.toArray()) {
    const text = $(el).text().trim();
    if (!text) continue;
    const parsed = parseJsonSafe(text);
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as any).variants)) {
      return parsed;
    }
  }

  for (const el of $("script").toArray()) {
    const text = $(el).text();
    if (!text || !text.includes("ShopifyAnalytics")) continue;
    const m = text.match(/ShopifyAnalytics\.meta\.product\s*=\s*({[\s\S]*?});/);
    if (!m) continue;
    const parsed = parseJsonSafe(m[1]);
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as any).variants)) {
      return parsed;
    }
  }

  return null;
}

function extractShopifyCurrency($: ReturnType<typeof load>): string | null {
  const meta =
    $('meta[itemprop="priceCurrency"]').attr("content") ??
    $('meta[property="product:price:currency"]').attr("content") ??
    null;
  if (meta) return meta.trim();

  for (const el of $("script").toArray()) {
    const text = $(el).text();
    if (!text) continue;
    const m = text.match(/"currency"\s*:\s*"([A-Z]{3})"/);
    if (m?.[1]) return m[1];
    const m2 = text.match(/Shopify\.currency\.active\s*=\s*"([A-Z]{3})"/);
    if (m2?.[1]) return m2[1];
  }

  return null;
}

function normalizeOptionName(name: string | null | undefined): string {
  return (name ?? "").trim().toLowerCase();
}

function normalizeVariantValue(value: any): string | null {
  const v = String(value ?? "").trim();
  return v.length ? v : null;
}

function isCodeLikeColorValue(value: string | null | undefined): boolean {
  const v = String(value ?? "").trim();
  if (!v) return false;
  if (/^\d{3,}$/.test(v)) return true;
  if (/^[a-z]{0,2}\d{3,}[a-z0-9-]*$/i.test(v)) return true;
  return false;
}

function resolveColorValue(
  rawColor: string | null | undefined,
  title: string | null | undefined,
  description: string | null | undefined
): string | null {
  const normalizedRaw = normalizeVariantValue(rawColor);
  if (normalizedRaw && !isCodeLikeColorValue(normalizedRaw)) {
    const fromRaw = normalizeColorTokensFromRaw(normalizedRaw)[0] ?? null;
    return fromRaw ?? normalizedRaw;
  }

  const inferred = normalizeColorTokensFromRaw(
    [normalizedRaw, title, description].filter(Boolean).join(" ")
  )[0] ?? null;

  return inferred ?? normalizedRaw ?? null;
}

function looksLikeSizeValue(value: string | null | undefined): boolean {
  const v = (value ?? "").trim().toLowerCase();
  if (!v) return false;
  if (v === "one size" || v === "onesize" || v === "os") return true;
  if (/^(xxs|xs|s|m|l|xl|xxl|xxxl|xxxxl)$/.test(v)) return true;
  if (/^\d{1,3}(\.\d+)?$/.test(v)) return true;
  if (/^\d{1,2}y$/.test(v)) return true;
  return false;
}

function guessOptionIndexes(productJson: any): { colorIndex: number; sizeIndex: number } {
  const optionsWithValues = Array.isArray(productJson?.options_with_values)
    ? productJson.options_with_values
    : null;

  const optionNames: string[] = Array.isArray(productJson?.options)
    ? productJson.options.map((o: any) => (typeof o === "string" ? o : o?.name)).filter(Boolean)
    : [];

  const names = optionsWithValues
    ? optionsWithValues.map((o: any) => String(o?.name ?? "")).filter(Boolean)
    : optionNames;

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

  if (colorIndex === -1 && optionsWithValues) {
    colorIndex = optionsWithValues.findIndex((o: any) => {
      const values = Array.isArray(o?.values) ? o.values : [];
      return values.some((v: any) => !looksLikeSizeValue(String(v ?? "")));
    });
  }

  if (sizeIndex === -1 && optionsWithValues) {
    sizeIndex = optionsWithValues.findIndex((o: any) => {
      const values = Array.isArray(o?.values) ? o.values : [];
      return values.some((v: any) => looksLikeSizeValue(String(v ?? "")));
    });
  }

  if (sizeIndex === -1 && names.length === 1 && colorIndex === -1) {
    const values = optionsWithValues?.[0]?.values ?? [];
    if (Array.isArray(values) && values.some((v: any) => looksLikeSizeValue(String(v ?? "")))) {
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

  return { colorIndex, sizeIndex };
}

function isVariantAvailable(v: any): boolean {
  if (typeof v?.available === "boolean") return v.available;
  if (typeof v?.available === "number") return v.available > 0;
  if (typeof v?.inventory_quantity === "number") return v.inventory_quantity > 0;
  if (v?.inventory_management == null) return true;
  return false;
}

function variantMoneyToCents(value: any): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    if (Number.isInteger(value) && value >= 1000) return value;
    return Math.round(value * 100);
  }
  const n = Number(String(value).replace(/[^0-9.]/g, ""));
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

/**
 * Listing page -> product URLs
 * Shopify pattern: /products/<handle>
 */
export function extractProductUrls(listHtml: string): string[] {
  const $ = load(listHtml);
  const urls = new Set<string>();

  $('a[href*="/products/"]').each((_, a) => {
    const href = $(a).attr("href");
    if (!href) return;

    // Skip gift cards
    if (/gift-?card/i.test(href) || /gift-?cards/i.test(href)) return;

    const u = new URL(href, VENDOR_URL);
    u.hash = "";
    urls.add(u.toString());
  });

  return [...urls];
}

/**
 * Product page -> ScrapedProduct
 */
export function parseProductPage(
  productHtml: string,
  productUrl: string,
  productJsonOverride?: any | null
): ScrapedProduct | ScrapedProduct[] | null {
  const $ = load(productHtml);
  const parentProductUrl = canonicalizeParentProductUrl(
    productUrl.split("#")[0].split("?")[0]
  );

  const productJson = productJsonOverride ?? extractShopifyProductJson($);

  const brand =
    safeText($(".product-meta__vendor a").first().text()) ??
    safeText($(".product-meta__vendor").first().text()) ??
    safeText(productJson?.vendor) ??
    null;

  const title =
    safeText($(".product-meta__title").first().text()) ??
    safeText($("h1").first().text()) ??
    safeText($('meta[property="og:title"]').attr("content")) ??
    safeText(productJson?.title);

  if (!title) return null;
  if (/gift\s*card/i.test(title) || /gift-?card/i.test(productUrl)) return null;

  const currencyFromHtml = extractShopifyCurrency($);

  const saleText = $(".price-list .price--highlight").first().text().trim();
  const regularText = $(".price-list .price--compare").first().text().trim();

  const currency = currencyFromHtml ?? detectCurrency(saleText || regularText || "$");

  const saleCents = saleText ? moneyToCents(saleText) : 0;
  const regularCents = regularText ? moneyToCents(regularText) : 0;

  const hasDiscount = regularCents > 0 && saleCents > 0 && saleCents < regularCents;

  const price_cents = hasDiscount ? regularCents : (saleCents || regularCents || 0);
  const sales_price_cents = hasDiscount ? saleCents : null;

  const availability = inferAvailability($);

  let size: string | null = null;
  let color: string | null = null;

  $(".product-form__option-selector").each((_, el) => {
    const name = $(el).find(".product-form__option-name").first().text().trim().toLowerCase();
    const value = safeText($(el).find(".product-form__option-value").first().text());

    if (!value) return;

    if (name.startsWith("size")) size = value;
    if (name.startsWith("color")) color = value;
  });

  const description =
    safeText($(".product__description").first().text()) ??
    safeText($(".product-description").first().text()) ??
    safeText($(".rte").first().text()) ??
    safeText($('meta[property="og:description"]').attr("content")) ??
    null;

  let category: string | null = null;
  try {
    const slug = new URL(productUrl).pathname.split("/").pop() || "";
    const parts = slug.split("-").filter(Boolean);
    if (parts.length >= 2) category = `${parts[0]} ${parts[1]}`.toLowerCase();
  } catch {
    // ignore
  }

  if (!category) {
    const type = safeText(productJson?.product_type ?? productJson?.type);
    if (type) category = type;
  }

  let image_url =
    safeText($('meta[property="og:image"]').attr("content")) ??
    null;

  if (image_url) image_url = new URL(image_url, VENDOR_URL).toString();

  const imageUrls = new Set<string>();
  const pushImage = (u?: string | null) => {
    if (!u) return;
    try {
      imageUrls.add(normalizeUrl(u));
    } catch {
      // ignore invalid URLs
    }
  };

  pushImage(image_url);

  $(
    ".product__media img, .product-gallery img, .product__slideshow img, .product__image img"
  ).each((_, img) => {
    const src =
      $(img).attr("data-src") ??
      $(img).attr("data-lazy-src") ??
      $(img).attr("data-zoom-image") ??
      $(img).attr("src");
    pushImage(src ?? null);
  });

  if (productJson?.images && Array.isArray(productJson.images)) {
    for (const img of productJson.images) {
      if (typeof img === "string") pushImage(img);
      else if (img?.src) pushImage(String(img.src));
    }
  }

  const image_urls = imageUrls.size ? Array.from(imageUrls) : null;
  const primary_image_url = image_urls?.[0] ?? null;

  if (!productJson || !Array.isArray(productJson.variants)) {
    return {
      vendor_name: VENDOR_NAME,
      vendor_url: VENDOR_URL,
      product_url: productUrl,
      parent_product_url: parentProductUrl,
      variant_id: null,

      title,
      brand,
      category,
      description,
      size,
      color,

      return_policy: RETURN_POLICY,
      currency,
      price_cents,
      sales_price_cents,
      availability,

      image_url: primary_image_url,
      image_urls,
    };
  }

  const options: string[] = Array.isArray(productJson.options)
    ? productJson.options.map((o: any) => (typeof o === "string" ? o : o?.name)).filter(Boolean)
    : [];

  const { colorIndex, sizeIndex } = guessOptionIndexes({
    options,
    options_with_values: productJson.options_with_values,
  });

  const groupMap = new Map<string, { color: string | null; variants: any[] }>();
  for (const v of productJson.variants) {
    const optionsList = [v?.option1, v?.option2, v?.option3];
    const colorValue = colorIndex >= 0 ? normalizeVariantValue(optionsList[colorIndex]) : null;
    const key = colorValue ?? "__default__";
    const entry = groupMap.get(key) ?? { color: colorValue, variants: [] };
    entry.variants.push(v);
    groupMap.set(key, entry);
  }

  const rows: ScrapedProduct[] = [];
  const base = {
    vendor_name: VENDOR_NAME,
    vendor_url: VENDOR_URL,
    parent_product_url: parentProductUrl,
    title,
    brand,
    category,
    description,
    return_policy: RETURN_POLICY,
    currency,
    image_urls,
  };

  for (const { color: groupColor, variants } of groupMap.values()) {
    const sizeSet: string[] = [];
    const sizeSeen = new Set<string>();
    for (const v of variants) {
      const optionsList = [v?.option1, v?.option2, v?.option3];
      const sizeValue = sizeIndex >= 0 ? normalizeVariantValue(optionsList[sizeIndex]) : null;
      if (sizeValue && !sizeSeen.has(sizeValue)) {
        sizeSeen.add(sizeValue);
        sizeSet.push(sizeValue);
      }
    }

    const sizeValue = sizeSet.length ? sizeSet.join(", ") : null;
    const { price, sale } = pickGroupPrice(variants);
    const groupAvailable = variants.some((v) => isVariantAvailable(v));

    const variantIds = variants
      .map((v) => v?.id)
      .filter((v) => v != null)
      .map((v) => String(v));
    const variantIdValue = variantIds.length ? variantIds[0] : null;

    let groupImage: string | null = null;
    for (const v of variants) {
      const img = v?.featured_image?.src ?? v?.image?.src ?? null;
      if (img) {
        try {
          groupImage = normalizeUrl(String(img));
          break;
        } catch {
          // ignore
        }
      }
    }

    const groupProductUrl = groupColor
      ? `${parentProductUrl}#color=${encodeURIComponent(groupColor)}`
      : parentProductUrl;

    const resolvedColor = resolveColorValue(groupColor, title, description);

    rows.push({
      ...base,
      product_url: groupProductUrl,
      variant_id: variantIdValue,
      size: sizeValue,
      color: resolvedColor,
      price_cents: price,
      sales_price_cents: sale,
      availability: groupAvailable,
      image_url: groupImage ?? primary_image_url,
    });
  }

  return rows;
}
