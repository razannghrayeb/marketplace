// src/lib/scrape/runHmAll.ts
import { upsertProduct, getOrCreateVendorId, markUnseenProductsUnavailable } from "./ingest";
import { scrapeHmProductPage } from "./vendors/hm_us";
import { discoverHmProductUrlsBySearch } from "./vendors/hm_discover_us";

const VENDOR_NAME = "H&M";
const VENDOR_URL = "https://www2.hm.com";
const LOCALE = process.env.HM_LOCALE ?? "en_us";

const QUERIES = [
  "women",
  "men",
  "dress",
  "shirt",
  "pants",
  "jacket",
  "shoes",
  "accessories",
  "kids",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const MAX_PAGES = Number(process.env.HM_MAX_PAGES ?? 10);
const MAX_PRODUCTS = Number(process.env.HM_MAX_PRODUCTS ?? 500);
const LOG_EVERY = Number(process.env.HM_LOG_EVERY ?? 25);

export async function runHm() {
  const all = new Set<string>();

  // 1) DISCOVER
  for (const q of QUERIES) {
    try {
      const urls = await discoverHmProductUrlsBySearch({ query: q, maxPages: MAX_PAGES, delayMs: 300, locale: LOCALE });
      urls.forEach((u) => all.add(u));
      console.log(`[HM] query="${q}" found ${urls.length} URLs (total=${all.size})`);
      if (all.size >= MAX_PRODUCTS) break;
    } catch (e) {
      console.error("[HM discover] failed query:", q, e);
    }
  }

  console.log(`\n[HM] Discovered ${all.size} unique product URLs`);

  // 2) SCRAPE PRODUCT PAGES + UPSERT
  let saved = 0;
  let failed = 0;
  let i = 0;
  const seenProductUrls = new Set<string>();

  for (const url of all) {
    if (i >= MAX_PRODUCTS) break;
    i++;

    if (i % LOG_EVERY === 0) {
      console.log(`[HM] Progress: ${i}/${Math.min(all.size, MAX_PRODUCTS)} saved=${saved} failed=${failed}`);
    }

    try {
      const products = await scrapeHmProductPage(url);
      if (products.length === 0) {
        failed++;
        continue;
      }
      for (const p of products) {
        await upsertProduct(p);
        seenProductUrls.add(p.product_url);
        saved++;
      }
    } catch (e: any) {
      failed++;
      console.warn(`[HM] failed: ${url} -> ${e.message}`);
    }

    await sleep(300);
  }

  const vendorId = await getOrCreateVendorId(VENDOR_NAME, VENDOR_URL);
  await markUnseenProductsUnavailable(vendorId, seenProductUrls);

  console.log(`\n[HM] Done. Saved=${saved}, Failed=${failed}`);
  return { saved, failed };
}

