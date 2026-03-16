import { getOrCreateVendorId, markProductsUnavailableBefore, upsertProduct } from "./ingest";
import { scrapeEverlane } from "./vendors/everlane/scrapeEverlane";

const VENDOR_NAME = "Everlane";
const VENDOR_URL = "https://www.everlane.com";

async function run() {
  const crawlStartedAt = new Date().toISOString();
  const products = await scrapeEverlane();

  if (products.length === 0) {
    console.warn("No Everlane products scraped.");
    return;
  }

  let ok = 0;
  let fail = 0;

  for (const product of products) {
    try {
      await upsertProduct(product);
      ok += 1;

      if (ok % 50 === 0) {
        console.log(`Upserted ${ok} Everlane rows`);
      }
    } catch (err: any) {
      fail += 1;
      console.error("Failed upserting Everlane product:", {
        title: product.title,
        product_url: product.product_url,
        error: err?.message ?? err,
      });
    }
  }

  const vendorId = await getOrCreateVendorId(VENDOR_NAME, VENDOR_URL);
  await markProductsUnavailableBefore(vendorId, crawlStartedAt);

  console.log(`Done. Successful: ${ok}, Failed: ${fail}`);
}

run().catch((err) => {
  console.error("Everlane run crashed:", err);
  process.exit(1);
});
