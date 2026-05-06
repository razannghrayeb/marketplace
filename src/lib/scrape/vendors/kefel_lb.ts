import type { ScrapedProduct } from "../types";

const VENDOR_NAME = "Kefel Fashion";
const VENDOR_URL = "https://kefelfashion.netlify.app";
const CURRENCY = "USD";

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function priceToCents(text: string): number {
  const n = Number(text.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

function isPriceLine(text: string): boolean {
  return /^\$[\d,]+(\.\d+)?$/.test(text.trim());
}

export function parseKefelCard(lines: string[]): ScrapedProduct | null {
  if (lines.length < 7) return null;

  const brand = lines[0]?.trim() || null;
  const title = lines[1]?.trim();
  const category = lines[2]?.trim() || null;
  // lines[3] = description, lines[4] = availability
  if (!title) return null;

  const availability = (lines[4] ?? "").toLowerCase().includes("in stock");

  let priceCents = 0;
  let salePriceCents: number | null = null;
  let color: string | null = null;
  let size: string | null = null;

  // Detect sale: lines[5] = original price, lines[6] = sale price, lines[7] = color, lines[8] = size
  // No sale:    lines[5] = price, lines[6] = color, lines[7] = size
  if (isPriceLine(lines[5] ?? "") && isPriceLine(lines[6] ?? "")) {
    priceCents = priceToCents(lines[5])
    salePriceCents = priceToCents(lines[6])
    color = lines[7]?.trim() || null
    size = lines[8]?.trim() || null
  } else if (isPriceLine(lines[5] ?? "")) {
    priceCents = priceToCents(lines[5])
    color = lines[6]?.trim() || null
    size = lines[7]?.trim() || null
  }

  const titleSlug = slug(title)
  const productUrl = `${VENDOR_URL}/#${titleSlug}`

  return {
    vendor_name: VENDOR_NAME,
    vendor_url: VENDOR_URL,
    product_url: productUrl,
    parent_product_url: productUrl,
    variant_id: titleSlug,
    title,
    brand: brand ?? VENDOR_NAME,
    category,
    color,
    size,
    currency: CURRENCY,
    price_cents: priceCents,
    sales_price_cents: salePriceCents,
    availability,
    image_url: null,
    image_urls: [],
    return_policy: null,
  };
}
