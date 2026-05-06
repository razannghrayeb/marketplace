import { chromium } from "playwright";
import { parseKefelCard } from "./vendors/kefel_lb";
import { getOrCreateVendorId, markProductsUnavailableBefore, upsertProduct } from "./ingest";
import { supabaseAdmin } from "../supabaseAdmin";

const VENDOR_NAME = "Kefel Fashion";
const VENDOR_URL = "https://kefelfashion.netlify.app";

async function scrapeKefelProducts() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(VENDOR_URL, { waitUntil: "networkidle", timeout: 30000 });

  const cards: string[][] = await page.evaluate(() => {
    const results: string[][] = [];
    document.querySelectorAll('[class*="card"]').forEach((el) => {
      const lines = (el as HTMLElement).innerText
        .trim()
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      if (lines.length >= 7) results.push(lines);
    });
    return results;
  });

  await browser.close();
  return cards;
}

async function deleteStaleKefelProducts(vendorId: number) {
  // Remove old seed/fake products that don't belong to the kefel domain
  await supabaseAdmin
    .from("products")
    .delete()
    .eq("vendor_id", vendorId)
    .not("product_url", "like", `${VENDOR_URL}%`);
}

export async function runKefel() {
  console.log("=== Kefel Fashion scraper started ===");

  const crawlStartedAt = new Date().toISOString();
  const cards = await scrapeKefelProducts();
  console.log(`Found ${cards.length} product cards`);

  const vendorId = await getOrCreateVendorId(VENDOR_NAME, VENDOR_URL);
  await deleteStaleKefelProducts(vendorId);

  let saved = 0;
  let failed = 0;

  for (const lines of cards) {
    const product = parseKefelCard(lines);
    if (!product) { failed++; continue; }

    try {
      await upsertProduct(product);
      saved++;
      console.log(`  Saved: ${product.title}`);
    } catch (e: any) {
      failed++;
      console.error(`  Failed: ${product.title} — ${e.message}`);
    }
  }

  await markProductsUnavailableBefore(vendorId, crawlStartedAt);

  console.log(`\n=== Done. Saved=${saved}, Failed=${failed} ===`);
  return { saved, failed };
}
