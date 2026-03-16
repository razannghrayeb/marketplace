import { load, type CheerioAPI } from "cheerio";
import type { ScrapedProduct } from "../types";

const VENDOR_NAME = "MYHOLDAL";
const VENDOR_URL = "https://myholdal.com";
const RETURN_POLICY =
  "Exchanges/refunds accepted within 3 days of delivery with original tags and unworn, unwashed, unaltered condition. Swimwear, perfumes, and cosmetics are not exchangeable/refundable. Shoes must be tried on carpet. Gift orders can be exchanged only. A $4 delivery charge applies on returns/exchanges. Support: myholdal@holdalgroup.com.";

/* ---------------- helpers ---------------- */

function safeText(s?: string | null) {
  const t = (s ?? "").trim();
  return t.length ? t : null;
}

function normalizeUrl(url: string): string {
  return new URL(url, VENDOR_URL).toString();
}

function moneyToCents(s: string): number {
  const n = Number(String(s).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function stripHtml(html: string): string {
  return String(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toInt(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function inferAvailability($: CheerioAPI): boolean {
  const stockText = $(".stock, .stock-status, .product-stock-status")
    .first()
    .text()
    .toLowerCase()
    .trim();

  if (stockText.includes("out of stock") || stockText.includes("sold out")) {
    return false;
  }

  const button = $("button[type='submit'], button[name='add']")
    .first();
  const disabled = button.attr("disabled");
  const ariaDisabled = button.attr("aria-disabled");
  const buttonText = button.text().toLowerCase();
  if (disabled != null || ariaDisabled === "true") return false;
  if (button.hasClass("disabled") || button.hasClass("is-disabled")) return false;
  if (buttonText.includes("sold out") || buttonText.includes("unavailable")) return false;

  return true;
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

function extractColorFromDescription(value: string | null | undefined): string | null {
  const text = String(value ?? "");
  if (!text) return null;

  const m1 = text.match(/colou?r\s*:\s*<\/strong>\s*([^<]+)/i);
  if (m1?.[1]) return cleanupColorCandidate(m1[1]);

  const plain = stripHtml(text);
  const m2 = plain.match(/\bcolou?r\s*:\s*([A-Za-z0-9][A-Za-z0-9\s\/&,'-]+)/i);
  if (m2?.[1]) return cleanupColorCandidate(m2[1]);

  return null;
}

function extractSizeFromDescription(value: string | null | undefined): string | null {
  const text = String(value ?? "");
  if (!text) return null;

  const m1 = text.match(/size\s*:\s*<\/strong>\s*([^<]+)/i);
  if (m1?.[1]) return m1[1].trim();

  const plain = stripHtml(text);
  const m2 = plain.match(/\bsize\s*:\s*([A-Za-z0-9][A-Za-z0-9\s\/&().,\-]+)\b/i);
  if (m2?.[1]) return m2[1].trim();

  return null;
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

function guessOptionIndexes(productJson: any): { colorIndex: number; sizeIndex: number } {
  const optionsWithValues = Array.isArray(productJson?.options_with_values)
    ? productJson.options_with_values
    : null;

  const optionNames: string[] = Array.isArray(productJson?.options)
    ? productJson.options.map((o: any) => (typeof o === "string" ? o : o?.name)).filter(Boolean)
    : [];
  const variants = Array.isArray(productJson?.variants) ? productJson.variants : [];

  if (
    optionNames.length === 1 &&
    normalizeOptionName(optionNames[0]) === "title" &&
    (!optionsWithValues || (Array.isArray(optionsWithValues[0]?.values) &&
      optionsWithValues[0].values.every((v: any) => /^default title$/i.test(String(v ?? "").trim()))))
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
    const configured =
      optionsWithValues && Array.isArray(optionsWithValues[index]?.values)
        ? optionsWithValues[index].values.map((v: any) => String(v ?? "")).filter(Boolean)
        : [];
    const actual = valuesForIndex(index);
    return configured.length > 0 ? configured : actual;
  };

  const names = optionsWithValues
    ? optionsWithValues.map((o: any) => String(o?.name ?? "")).filter(Boolean)
    : optionNames;

  let colorIndex = names.findIndex((o) => {
    const name = normalizeOptionName(o);
    return name.includes("color") || name.includes("colour");
  });

  let sizeIndex = names.findIndex((o) => {
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
      const values = optionValuesAt(optionsWithValues.indexOf(o));
      return values.some((v: any) => {
        const value = String(v ?? "");
        return !looksLikeSizeValue(value) && !looksLikeGenderValue(value);
      });
    });
  } else if (colorIndex === -1 && optionNames.length > 0) {
    colorIndex = optionNames.findIndex((_, index) => {
      const values = optionValuesAt(index);
      return values.some((v) => !looksLikeSizeValue(v) && !looksLikeGenderValue(v));
    });
  }

  if (sizeIndex === -1 && optionsWithValues) {
    sizeIndex = optionsWithValues.findIndex((o: any) => {
      const values = optionValuesAt(optionsWithValues.indexOf(o));
      return values.some((v: any) => looksLikeSizeValue(String(v ?? "")));
    });
  } else if (sizeIndex === -1 && optionNames.length > 0) {
    sizeIndex = optionNames.findIndex((_, index) => {
      const values = optionValuesAt(index);
      return values.some((v) => looksLikeSizeValue(v));
    });
  }

  if (sizeIndex === -1 && names.length === 1 && colorIndex === -1) {
    const values = optionValuesAt(0);
    if (values.some((v) => looksLikeSizeValue(v))) {
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

  if (sizeIndex >= 0 && optionsWithValues?.[sizeIndex]) {
    const values = optionValuesAt(sizeIndex);
    if (values.some((v: any) => looksLikeGenderValue(String(v ?? "")))) {
      sizeIndex = -1;
    }
  }

  if (colorIndex >= 0) {
    const values = optionValuesAt(colorIndex);
    if (values.length > 0 && values.every((v) => looksLikeSizeValue(v))) {
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

function isVariantAvailable(v: any): boolean {
  if (typeof v?.available === "boolean") return v.available;
  if (typeof v?.available === "number") return v.available > 0;
  if (typeof v?.inventory_quantity === "number") return v.inventory_quantity > 0;
  if (v?.inventory_management == null) return true;
  return false;
}

/* ---------------- listing page ---------------- */

export function extractProductUrls(listHtml: string): string[] {
  const $ = load(listHtml);
  const urls = new Set<string>();

  $('a[href*="/products/"]').each((_, a) => {
    const href = $(a).attr("href");
    if (!href) return;

    if (href.includes("admin.shopify.com")) return;

    const u = new URL(href, VENDOR_URL);
    if (!u.hostname.includes("myholdal.com")) return;

    u.hash = "";
    urls.add(u.toString());
  });
  return [...urls];
}

/* ---------------- product page ---------------- */

export function parseProductPage(
  productHtml: string,
  productUrl: string,
  productJsonOverride?: any | null
): ScrapedProduct | ScrapedProduct[] | null {
  const $ = load(productHtml);
  const parentProductUrl = productUrl.split("#")[0].split("?")[0];

  const np = productJsonOverride ?? extractWindowNP($);

  const title =
    safeText(np?.title) ??
    safeText($("h1.product-single__title").first().text()) ??
    safeText($('meta[property="og:title"]').attr("content"));

  if (!title) return null;

  const brand =
    safeText(np?.vendor) ??
    safeText($(".product-single__vendor a").first().text()) ??
    null;

  const category =
    safeText(np?.type) ??
    null;

  const description =
    safeText(stripHtml(np?.content ?? np?.description ?? "")) ??
    safeText($(".collapsible-content__inner.rte").first().text()) ??
    null;
  const descriptionHtml = String(np?.content ?? np?.description ?? "");
  const fallbackColor = extractColorFromDescription(descriptionHtml) ?? extractColorFromTitleOrHandle(title, new URL(parentProductUrl).pathname.split("/").pop() ?? "");
  const fallbackSize = extractSizeFromDescription(descriptionHtml);

  const currency =
    detectCurrencyFromPage($, productHtml) ?? "USD";

  const currentCents =
    toInt(np?.price) ??
    parseVisiblePriceCents($) ??
    0;

  const regularCents =
    toInt(np?.compare_at_price) ??
    parseVisibleComparePriceCents($) ??
    null;

  const hasDiscount =
    regularCents != null &&
    regularCents > 0 &&
    currentCents > 0 &&
    currentCents < regularCents;

  const price_cents = hasDiscount ? regularCents! : currentCents;
  const sales_price_cents = hasDiscount ? currentCents : null;

  const availabilityFromPage = inferAvailability($);

  let image_url =
    safeText(np?.featured_image) ??
    safeText($('meta[property="og:image"]').attr("content")) ??
    null;

  if (image_url) image_url = new URL(image_url, VENDOR_URL).toString();

  const imageUrls = new Set<string>();
  const pushImage = (u?: string | null) => {
    if (!u) return;
    try {
      imageUrls.add(normalizeUrl(u));
    } catch {
      // ignore
    }
  };

  if (Array.isArray(np?.images)) {
    for (const img of np.images) {
      if (typeof img === "string") pushImage(img);
      else if (img?.src) pushImage(String(img.src));
    }
  }

  pushImage(image_url);

  const image_urls = imageUrls.size ? Array.from(imageUrls) : null;
  const primary_image_url = image_urls?.[0] ?? null;

  if (!np || !Array.isArray(np.variants)) {
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
      size: fallbackSize,
      color: fallbackColor,

      return_policy: RETURN_POLICY,
      currency,
      price_cents,
      sales_price_cents,
      availability: availabilityFromPage,

      image_url: primary_image_url,
      image_urls,
    };
  }

  const options: string[] = Array.isArray(np.options)
    ? np.options.map((o: any) => (typeof o === "string" ? o : o?.name)).filter(Boolean)
    : [];

  const { colorIndex, sizeIndex } = guessOptionIndexes({
    options,
    options_with_values: np.options_with_values,
  });

  const groupMap = new Map<string, { color: string | null; variants: any[] }>();
  for (const v of np.variants) {
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
      color: fallbackColor,
    };

  for (const { color: groupColor, variants } of groupMap.values()) {
    const sizeSet: string[] = [];
    const sizeSeen = new Set<string>();
    for (const v of variants) {
      const optionsList = [v?.option1, v?.option2, v?.option3];
      const sizeValue = sizeIndex >= 0 ? normalizeVariantValue(optionsList[sizeIndex]) : null;
      if (sizeValue && looksLikeSizeValue(sizeValue) && !sizeSeen.has(sizeValue)) {
        sizeSeen.add(sizeValue);
        sizeSet.push(sizeValue);
      }
    }

    const sizeValue = sizeSet.length ? sizeSet.join(", ") : null;
    const { price, sale } = pickGroupPrice(variants);
    const groupAvailable = variants.some((v) => isVariantAvailable(v)) || availabilityFromPage;

    const variantIds = variants
      .map((v) => v?.id)
      .filter((v) => v != null)
      .map((v) => String(v));
    const variantIdValue = variantIds.length ? variantIds.join(",") : null;
    const primaryVariantId = variantIds.length ? variantIds[0] : null;

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

    const groupProductUrl = primaryVariantId
      ? `${parentProductUrl}?variant=${encodeURIComponent(primaryVariantId)}`
      : parentProductUrl;

    rows.push({
      ...base,
      product_url: groupProductUrl,
      variant_id: variantIdValue,
      size: sizeValue ?? fallbackSize,
      color: groupColor ?? fallbackColor,
      price_cents: price,
      sales_price_cents: sale,
      availability: groupAvailable,
      image_url: groupImage ?? primary_image_url,
    });
  }

  return rows;
}

/* ---------------- helpers (cheerio-aware) ---------------- */

function parseVisiblePriceCents($: CheerioAPI): number | null {
  const txt = $(".product__price").first().text().trim();
  if (!txt) return null;
  return moneyToCents(txt);
}

function parseVisibleComparePriceCents($: CheerioAPI): number | null {
  const txt = $(".product__price--compare, .price--compare")
    .first()
    .text()
    .trim();
  if (!txt) return null;
  return moneyToCents(txt);
}

function detectCurrencyFromPage($: CheerioAPI, rawHtml: string): string | null {
  const opt = $(".product-single__variants option").first().text();
  if (/USD/i.test(opt) || /\$/.test(opt)) return "USD";
  if (/EUR/i.test(opt)) return "EUR";
  if (/USD/i.test(rawHtml)) return "USD";
  return null;
}

function extractWindowNP($: CheerioAPI): any | null {
  let found: any | null = null;

  $("script").each((_, el) => {
    if (found) return;

    const txt = $(el).html() || "";
    if (!txt.includes("window.NP")) return;

    const m = txt.match(/window\.NP\s*=\s*(\{[\s\S]*?\});/);
    if (!m?.[1]) return;

    try {
      found = JSON.parse(m[1]);
    } catch {
      // ignore
    }
  });

  return found;
}
