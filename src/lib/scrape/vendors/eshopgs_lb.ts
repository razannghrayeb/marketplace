import { load } from "cheerio";

import type { ScrapedProduct } from "../types";

// One vendor, multiple categories
export const CATEGORY_URLS = [
  "https://eshopgs.com/lb/product-category/girl/",
  "https://eshopgs.com/lb/product-category/boy/",
  "https://eshopgs.com/lb/product-category/women/",
  "https://eshopgs.com/lb/product-category/men/",
];

const BASE = "https://eshopgs.com";
const RETURN_POLICY =
  "Exchanges accepted within 18 days if items are unworn, unwashed, undamaged, with tags; shoes must be tried on a clean surface. Some items are excluded (adult underwear, certain swimwear, gift cards, GS Storey limited to GS Storey range). Online exchanges require contacting customer service and a $3 shipping fee; exchanges are subject to stock. " +
  "Refunds are in-store only within 10 days for eligible items; sale items, adult underwear, loyalty-point purchases, and gifts are non-refundable. Delivery fees are non-refundable; refunds go back to the original card. Faulty goods can be returned within 10 days for repair, replacement, exchange, or refund after assessment.";

/* helpers */

function normalizeUrl(url: string): string {
  return new URL(url, BASE).toString();
}

function canonicalizeParentProductUrl(url: string): string {
  try {
    const parsed = new URL(url, BASE);
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

function numberToCents(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function detectCurrency(s: string): string {
  if (/\$|USD/i.test(s)) return "USD";
  if (/LBP|L\.L/i.test(s)) return "LBP";
  return "USD";
}

function safeText(s?: string | null) {
  const t = (s ?? "").trim();
  return t.length ? t : null;
}

function normalizeAttributeValue(value: unknown): string | null {
  if (value == null) return null;
  const t = String(value).replace(/[-_]+/g, " ").trim();
  return t.length ? t : null;
}

function normalizeSizeValue(value: string | null | undefined): string | null {
  if (!value) return null;
  const t = value.trim();
  if (!t) return null;
  const lower = t.toLowerCase();
  if (lower === "os" || lower === "one size" || lower === "onesize" || lower === "one-size" || lower === "free size") {
    return "ONE SIZE";
  }
  return t;
}

function extractVariantAttributes(variant: any): { size: string | null; color: string | null } {
  let size: string | null = null;
  let color: string | null = null;

  const attrs = variant?.attributes;
  if (attrs && typeof attrs === "object") {
    for (const [rawKey, rawVal] of Object.entries(attrs)) {
      const key = String(rawKey).toLowerCase();
      const value = normalizeAttributeValue(rawVal);
      if (!value) continue;

      if (
        !size &&
        (key.includes("size") || key.includes("taille") || key.includes("talla") || key.includes("taglia"))
      ) {
        size = normalizeSizeValue(value);
      }

      if (!color && (key.includes("color") || key.includes("colour") || key.includes("couleur"))) {
        color = value;
      }
    }
  }

  return { size, color };
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

  const disabled = $("button.single_add_to_cart_button").attr("disabled");
  if (disabled != null) return false;

  // If no clear signal, assume available.
  return true;
}

/* LISTING PAGE */

export function listProductUrls(listingHtml: string): string[] {
  const $ = load(listingHtml);

  const urls = $("a")
    .map((_, el) => $(el).attr("href"))
    .get()
    .filter((href): href is string => Boolean(href))
    .map((href) => new URL(href, BASE).toString())
    .filter((u) => u.includes("/lb/product/"));

  return Array.from(new Set(urls));
}

export function listCategoryUrls(pageHtml: string): string[] {
  const $ = load(pageHtml);
  const urls = new Set<string>();

  $("a")
    .map((_, el) => $(el).attr("href"))
    .get()
    .filter((href): href is string => Boolean(href))
    .forEach((href) => {
      if (!href.includes("/product-category/")) return;
      if (href.includes("/product/")) return;

      try {
        const u = new URL(href, BASE);
        u.hash = "";
        urls.add(u.toString());
      } catch {
        // ignore invalid URLs
      }
    });

  return Array.from(urls);
}

/* PRODUCT PAGE */

export function parseProduct(html: string, productUrl: string): ScrapedProduct[] {
  const $ = load(html);

  const parentProductUrl = canonicalizeParentProductUrl(
    productUrl.split("?")[0].split("#")[0]
  );

  // ? Brand (explicit brand link or label on product page)
  const brand =
    safeText($("h3.product-brand a").first().text()) ??
    safeText($(".product-brand a").first().text()) ??
    safeText($(".product_brand a").first().text()) ??
    safeText($("a[href*='/brand/']").first().text()) ??
    safeText($("a[href*='/lb/brand/']").first().text()) ??
    null;

  // ? Title: prefer GTM JSON (contains full product name),
  // fallback to product-collection text.
  let title = "";
  const gtmRaw = $("input[name='gtm4wp_product_data']").attr("value");
  if (gtmRaw) {
    try {
      const parsed = JSON.parse(gtmRaw);
      if (parsed?.item_name) title = String(parsed.item_name).trim();
    } catch {
      // ignore
    }
  }
  if (!title) title = $(".product-collection").first().text().trim();
  if (!title) title = $("title").text().trim();

  // ? Description (from your HTML)
  const description = safeText($(".product-short-description").first().text());

  // ? Category: prefer level-3 (e.g. Shirts), fallback to level-1 (Men)
  const category =
    safeText($("a.shop-by-tag-category-level-3").first().text()) ??
    safeText($("a.shop-by-tag-category-level-2").first().text()) ??
    safeText($("a.shop-by-tag-category-level-1").first().text());

  // ? Selected size & color (from your HTML)
  const size = normalizeSizeValue(safeText($("#selected-size-name").first().text()));
  const color = safeText($("#selected-color-name").first().text());

  // ---------------------------
  // ? PRICE LOGIC
  // We will produce:
  // - price_cents = regular price (if exists), else current price
  // - sales_price_cents = current price (ONLY if there is a discount)
  // ---------------------------

  // 1) Try JSON-LD (sometimes available)
  let jsonPriceText = "";
  let jsonCurrency = "";

  $("script[type='application/ld+json']").each((_, el) => {
    if (jsonPriceText) return;

    const raw = $(el).text().trim();
    if (!raw) return;

    try {
      const data = JSON.parse(raw);
      const items = Array.isArray(data) ? data : [data];

      for (const item of items) {
        const candidates = Array.isArray(item["@graph"]) ? item["@graph"] : [item];

        for (const c of candidates) {
          if (c?.["@type"] === "Product" && c?.offers) {
            const offers = Array.isArray(c.offers) ? c.offers[0] : c.offers;
            const price = offers?.price ?? offers?.lowPrice;
            const currency = offers?.priceCurrency;

            if (price != null) jsonPriceText = String(price);
            if (currency) jsonCurrency = String(currency);
            if (jsonPriceText) return;
          }
        }
      }
    } catch {
      // ignore invalid JSON
    }
  });

  // 2) Try WooCommerce variations JSON (very common on variable products)
  let variationSale: number | null = null;
  let variationRegular: number | null = null;
  let variationCurrency = "";

  const variationsRaw = $("form.variations_form").attr("data-product_variations");
  let variations: any[] = [];
  if (variationsRaw) {
    try {
      const parsed = JSON.parse(variationsRaw);
      if (Array.isArray(parsed)) variations = parsed;
    } catch {
      // ignore JSON errors
    }
  }

  if (variations.length > 0) {
    const v =
      variations.find((x: any) => x?.display_price != null) ||
      variations.find((x: any) => x?.display_regular_price != null) ||
      variations[0];

    if (v?.display_price != null) variationSale = Number(v.display_price);
    if (v?.display_regular_price != null) variationRegular = Number(v.display_regular_price);

    if (typeof v?.price_html === "string") {
      variationCurrency = detectCurrency(v.price_html);
    }
  }

  // 3) Fallback to visible HTML prices
  const saleText = $("ins .woocommerce-Price-amount.amount").first().text().trim();   // discounted
  const regularText = $("del .woocommerce-Price-amount.amount").first().text().trim(); // original
  const htmlFinalText =
    saleText ||
    regularText ||
    $(".woocommerce-Price-amount.amount").first().text().trim();

  const currency = jsonCurrency || variationCurrency || detectCurrency(htmlFinalText);

  // Compute regular + sale prices
  const htmlSaleCents = saleText ? moneyToCents(saleText) : null;
  const htmlRegularCents = regularText ? moneyToCents(regularText) : null;

  const varSaleCents =
    variationSale != null && Number.isFinite(variationSale) ? Math.round(variationSale * 100) : null;

  const varRegularCents =
    variationRegular != null && Number.isFinite(variationRegular) ? Math.round(variationRegular * 100) : null;

  // Prefer variation numbers, then HTML text, then JSON price, then fallback final
  const saleCents =
    varSaleCents ??
    htmlSaleCents ??
    (jsonPriceText ? moneyToCents(jsonPriceText) : null) ??
    moneyToCents(htmlFinalText);

  const regularCents =
    varRegularCents ??
    htmlRegularCents ??
    null;

  // Decide discount presence
  const hasDiscount =
    regularCents != null &&
    regularCents > 0 &&
    saleCents > 0 &&
    saleCents < regularCents;

  // ? DB mapping:
  // price_cents should store the "regular" if discount exists, else store current.
  // sales_price_cents should store the "current" only when discount exists.
  const price_cents = hasDiscount ? regularCents! : saleCents;
  const sales_price_cents = hasDiscount ? saleCents : null;

  const availability = inferAvailability($);

  // ? Image (your current approach; also add fallback to variations image)
  let image_url: string | null = null;

  // from selected color-option style
  const style = $("button.color-option.selected").attr("style") || "";
  image_url = style.match(/url\(["']?(.*?)["']?\)/)?.[1] || null;

  // fallback: variation JSON image
  if (!image_url && variations.length > 0) {
    const v = variations[0];
    const img = v?.image?.full_src || v?.image?.url || v?.image?.src;
    if (img) image_url = String(img);
  }

  // fallback: og:image
  if (!image_url) {
    const og = $("meta[property='og:image']").attr("content");
    if (og) image_url = og;
  }

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

  if (variations.length > 0) {
    for (const v of variations) {
      const img = v?.image?.full_src || v?.image?.url || v?.image?.src;
      if (img) pushImage(String(img));
    }
  }

  const ogImage = $("meta[property='og:image']").attr("content");
  pushImage(ogImage ?? null);

  $(
    "figure.woocommerce-product-gallery__wrapper img, .woocommerce-product-gallery img, img.wp-post-image"
  ).each((_, img) => {
    const src =
      $(img).attr("data-src") ??
      $(img).attr("data-large_image") ??
      $(img).attr("data-lazy-src") ??
      $(img).attr("src");
    pushImage(src ?? null);
  });

  const image_urls = imageUrls.size ? Array.from(imageUrls) : null;
  const primary_image_url = image_urls?.[0] ?? null;

  const base = {
    vendor_name: "eshopgs",
    vendor_region: "LB",
    vendor_url: "https://eshopgs.com",
    parent_product_url: parentProductUrl,
    title,
    brand,
    category,
    description,
    currency,
    image_urls,
    return_policy: RETURN_POLICY,
  };

  if (variations.length > 0) {
    const groups = new Map<
      string,
      {
        color: string | null;
        sizes: Set<string>;
        variantIds: Set<string>;
        imageUrl: string | null;
        available: boolean;
      }
    >();

    for (const v of variations) {
      const variantId = v?.variation_id ?? v?.id ?? null;
      const { size: vSize, color: vColor } = extractVariantAttributes(v);
      const rowColor = vColor ?? color ?? null;
      const colorKey = (rowColor ?? "unknown").toLowerCase();

      let group = groups.get(colorKey);
      if (!group) {
        group = {
          color: rowColor,
          sizes: new Set<string>(),
          variantIds: new Set<string>(),
          imageUrl: null,
          available: availability,
        };
        groups.set(colorKey, group);
      }

      if (vSize) group.sizes.add(vSize);
      if (variantId != null) group.variantIds.add(String(variantId));

      const variantImage = v?.image?.full_src || v?.image?.url || v?.image?.src || null;
      if (!group.imageUrl && variantImage) {
        group.imageUrl = normalizeUrl(String(variantImage));
      }

      const variantAvailable =
        typeof v?.is_in_stock === "boolean" ? v.is_in_stock : availability;
      if (variantAvailable) group.available = true;
    }

    const rows: ScrapedProduct[] = [];
    for (const group of groups.values()) {
      const sizeList =
        group.sizes.size > 0 ? Array.from(group.sizes).join(", ") : size ?? null;
      const variantIdList =
        group.variantIds.size > 0 ? Array.from(group.variantIds)[0] : null;
      const colorValue = group.color ?? null;
      const productUrl = colorValue
        ? `${parentProductUrl}#color=${encodeURIComponent(colorValue)}`
        : parentProductUrl;

      rows.push({
        ...base,
        product_url: productUrl,
        variant_id: variantIdList,
        size: sizeList,
        color: colorValue,
        price_cents,
        sales_price_cents,
        availability: group.available,
        image_url: group.imageUrl ?? primary_image_url,
      });
    }

    return rows;
  }

  return [
    {
      ...base,
      product_url: parentProductUrl,
      variant_id: null,
      size,
      color,
      price_cents,
      sales_price_cents,
      availability,
      image_url: primary_image_url,
    },
  ];
}
