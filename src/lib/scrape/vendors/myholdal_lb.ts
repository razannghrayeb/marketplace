import { load, type CheerioAPI } from "cheerio";

export type ScrapedProduct = {
  vendor_name: string;
  vendor_url: string;
  product_url: string;

  title: string;
  brand?: string | null;

  category?: string | null;
  description?: string | null;
  size?: string | null;
  color?: string | null;

  currency: string;
  price_cents: number;               // regular if sale exists, else current
  sales_price_cents?: number | null; // current only if sale exists

  image_url?: string | null;
};

const VENDOR_NAME = "MYHOLDAL";
const VENDOR_URL = "https://myholdal.com";

/* ---------------- helpers ---------------- */

function safeText(s?: string | null) {
  const t = (s ?? "").trim();
  return t.length ? t : null;
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

/* ---------------- listing page ---------------- */

export function extractProductUrls(listHtml: string): string[] {
  const $ = load(listHtml);
  const urls = new Set<string>();

$('a[href*="/products/"]').each((_, a) => {
  const href = $(a).attr("href");
  if (!href) return;

  // ❌ skip Shopify admin links
  if (href.includes("admin.shopify.com")) return;

  const u = new URL(href, VENDOR_URL);

  // extra safety: only allow myholdal.com
  if (!u.hostname.includes("myholdal.com")) return;

  u.hash = "";
  urls.add(u.toString());
});
  return [...urls];
}

/* ---------------- product page ---------------- */

export function parseProductPage(
  productHtml: string,
  productUrl: string
): ScrapedProduct | null {
  const $ = load(productHtml);

  // 1) Extract Shopify window.NP JSON (BEST SOURCE)
  const np = extractWindowNP($);

  // ---- title ----
  const title =
    safeText(np?.title) ??
    safeText($("h1.product-single__title").first().text()) ??
    safeText($('meta[property="og:title"]').attr("content"));

  if (!title) return null;

  // ---- brand ----
  const brand =
    safeText(np?.vendor) ??
    safeText($(".product-single__vendor a").first().text()) ??
    null;

  // ---- category ----
  const category =
    safeText(np?.type) ??
    null;

  // ---- description ----
  const description =
    safeText(stripHtml(np?.content ?? np?.description ?? "")) ??
    safeText($(".collapsible-content__inner.rte").first().text()) ??
    null;

  // ---- currency ----
  const currency =
    detectCurrencyFromPage($, productHtml) ?? "USD";

  // ---- prices (NP prices are already in cents) ----
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

  // ---- size & color from options / variants ----
  let size: string | null = null;
  let color: string | null = null;

  const variant = pickVariant(np);

  if (np?.options && variant?.options) {
    for (let i = 0; i < np.options.length; i++) {
      const optName = String(np.options[i] ?? "").toLowerCase();
      const optValue = String(variant.options[i] ?? "").trim();

      if (!optValue) continue;

      if (optName.includes("size")) size = optValue;
      if (optName.includes("color")) color = optValue;
    }
  }

  // ---- image ----
  let image_url =
    safeText(np?.featured_image) ??
    safeText($('meta[property="og:image"]').attr("content")) ??
    null;

  if (image_url) {
    if (image_url.startsWith("//")) image_url = "https:" + image_url;
    image_url = new URL(image_url, VENDOR_URL).toString();
  }

  return {
    vendor_name: VENDOR_NAME,
    vendor_url: VENDOR_URL,
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
  if (/EUR|€/.test(opt)) return "EUR";
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

function pickVariant(np: any): any | null {
  if (!np) return null;
  const variants = Array.isArray(np.variants) ? np.variants : null;
  if (!variants || variants.length === 0) return null;
  return variants[0];
}
