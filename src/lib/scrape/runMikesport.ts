// src/lib/scrape/runMikesport.ts

import { scrapeAllMikesport } from "./vendors/mikesport_lb";
import { getOrCreateVendorId, markUnseenProductsUnavailable, upsertProduct } from "./ingest";

async function run() {
  console.log("Starting MikeSport scrape (ALL products via products.json pagination)...");

  const products = await scrapeAllMikesport();
  console.log(`Fetched ${products.length} product rows (variants included).`);

  let ok = 0;
  let fail = 0;
  const seenProductUrls = new Set<string>();

  for (const p of products) {
    try {
      // Optional progress log:
      // console.log("Upserting:", p.title, p.size, p.color);

      await upsertProduct(p);
      ok += 1;
      seenProductUrls.add(p.product_url);

      // Light progress indicator every 25 inserts
      if (ok % 25 === 0) {
        console.log(`Inserted/updated: ${ok} (failed: ${fail})`);
      }
    } catch (e: any) {
      fail += 1;
      console.error("Failed upserting product:", {
        title: p.title,
        product_url: p.product_url,
        error: e?.message ?? e,
      });
    }
  }

  const vendorId = await getOrCreateVendorId("Mike Sport", "https://lb.mikesport.com");
  await markUnseenProductsUnavailable(vendorId, seenProductUrls);

  console.log(`Done. Successful: ${ok}, Failed: ${fail}`);
}

run().catch((e) => {
  console.error("Run crashed:", e);
  process.exit(1);
});
