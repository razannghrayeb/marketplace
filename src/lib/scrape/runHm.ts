// src/lib/scrape/runHmAll.ts
import { upsertProduct } from "./ingest";
import { scrapeHmProductPage } from "./vendors/hm_us";
import { discoverHmProductUrlsBySearch } from "./vendors/hm_discover_us";

const QUERIES = [
  // small test run
  "women",
  "dress",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const MAX_PAGES = Number(process.env.HM_MAX_PAGES ?? 2);
const MAX_PRODUCTS = Number(process.env.HM_MAX_PRODUCTS ?? 50);
const LOG_EVERY = Number(process.env.HM_LOG_EVERY ?? 10);

export async function runHm() {
  const all = new Set<string>();

  // 1) DISCOVER
  for (const q of QUERIES) {
    try {
      const urls = await discoverHmProductUrlsBySearch({ query: q, maxPages: MAX_PAGES, delayMs: 200 });
      urls.forEach((u) => all.add(u));
      if (all.size >= MAX_PRODUCTS) break;
    } catch (e) {
      console.error("[HM discover] failed query:", q, e);
    }
  }

  console.log("Discovered unique product URLs:", all.size);

  // 2) SCRAPE PRODUCT PAGES + UPSERT
  let totalUpserts = 0;
  let i = 0;

  for (const url of all) {
    if (i >= MAX_PRODUCTS) break;
    i++;
    if (i % LOG_EVERY === 1) {
      console.log(`(${i}/${Math.min(all.size, MAX_PRODUCTS)}) Scraping: ${url}`);
    }

    try {
      const products = await scrapeHmProductPage(url);
      for (const p of products) {
        await upsertProduct(p);
        totalUpserts++;
      }
      if (i % LOG_EVERY === 1) {
        console.log(`  -> upserted ${products.length} variants`);
      }
    } catch (e) {
      console.warn("  -> failed product:", url, e);
    }

    // be polite to H&M (avoid bursts)
    await sleep(250);
  }

  console.log("Done. Total upserts:", totalUpserts);
}

