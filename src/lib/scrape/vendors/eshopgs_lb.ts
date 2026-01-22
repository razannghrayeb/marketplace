import { load } from "cheerio";

export type ScrapedProduct = {
  vendor_name: string;     // "eshopgs"
  vendor_region: string;   // "LB"
  vendor_url: string;
  product_url: string;

  title: string;
  brand?: string | null;

  // ✅ new fields (stop being NULL if they exist)
  category?: string | null;
  description?: string | null;
  size?: string | null;
  color?: string | null;

  currency: string;

  // ✅ pricing fields
  price_cents: number;              // regular price (if no discount) OR regular price (if discount exists)
  sales_price_cents?: number | null; // discounted/current price (only when discount exists)

  image_url?: string | null;
};

// One vendor, multiple categories
export const CATEGORY_URLS = [
  "https://eshopgs.com/lb/product-category/girl/",
  "https://eshopgs.com/lb/product-category/boy/",
  "https://eshopgs.com/lb/product-category/women/",
  "https://eshopgs.com/lb/product-category/men/",
];

const BASE = "https://eshopgs.com";

/* helpers */

function moneyToCents(s: string): number {
  const n = Number(String(s).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function detectCurrency(s: string): string {
  if (/\$|USD/i.test(s)) return "USD";
  if (/LBP|ليرة|ل\.\ل/i.test(s)) return "LBP";
  return "USD";
}

function safeText(s?: string | null) {
  const t = (s ?? "").trim();
  return t.length ? t : null;
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

/* PRODUCT PAGE */

export function parseProduct(html: string, productUrl: string): ScrapedProduct {
  const $ = load(html);

  // ✅ Brand
  const brand = safeText($("h1.product_title.entry-title a").first().text());

  // ✅ Title: prefer GTM JSON (contains full product name),
  // fallback to product-collection text.
  let title = "";
  const gtmRaw = $('input[name="gtm4wp_product_data"]').attr("value");
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

  // ✅ Description (from your HTML)
  const description = safeText($(".product-short-description").first().text());

  // ✅ Category: prefer level-3 (e.g. Shirts), fallback to level-1 (Men)
  const category =
    safeText($("a.shop-by-tag-category-level-3").first().text()) ??
    safeText($("a.shop-by-tag-category-level-2").first().text()) ??
    safeText($("a.shop-by-tag-category-level-1").first().text());

  // ✅ Selected size & color (from your HTML)
  const size = safeText($("#selected-size-name").first().text());
  const color = safeText($("#selected-color-name").first().text());

  // ---------------------------
  // ✅ PRICE LOGIC
  // We will produce:
  // - price_cents = regular price (if exists), else current price
  // - sales_price_cents = current price (ONLY if there is a discount)
  // ---------------------------

  // 1) Try JSON-LD (sometimes available)
  let jsonPriceText = "";
  let jsonCurrency = "";

  $('script[type="application/ld+json"]').each((_, el) => {
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
  if (variationsRaw) {
    try {
      const variations = JSON.parse(variationsRaw);
      if (Array.isArray(variations) && variations.length > 0) {
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
    } catch {
      // ignore JSON errors
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

  // ✅ DB mapping:
  // price_cents should store the "regular" if discount exists, else store current.
  // sales_price_cents should store the "current" only when discount exists.
  const price_cents = hasDiscount ? regularCents! : saleCents;
  const sales_price_cents = hasDiscount ? saleCents : null;

  // ✅ Image (your current approach; also add fallback to variations image)
  let image_url: string | null = null;

  // from selected color-option style
  const style = $("button.color-option.selected").attr("style") || "";
  image_url = style.match(/url\(["']?(.*?)["']?\)/)?.[1] || null;

  // fallback: variation JSON image
  if (!image_url && variationsRaw) {
    try {
      const variations = JSON.parse(variationsRaw);
      if (Array.isArray(variations) && variations.length > 0) {
        const v = variations[0];
        const img = v?.image?.full_src || v?.image?.url || v?.image?.src;
        if (img) image_url = String(img);
      }
    } catch {
      // ignore
    }
  }

  // fallback: og:image
  if (!image_url) {
    const og = $('meta[property="og:image"]').attr("content");
    if (og) image_url = og;
  }

  return {
    vendor_name: "eshopgs",
    vendor_region: "LB",
    vendor_url: "https://eshopgs.com",
    product_url: productUrl,
    title,
    brand,

    category,
    description,
    size,
    color,

    currency,
    price_cents,
    sales_price_cents,

    image_url,
  };
}
