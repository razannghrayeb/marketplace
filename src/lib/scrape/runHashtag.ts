import { scrapeHashtagCollection } from "./vendors/hashtag";
import { getOrCreateVendorId, markProductsUnavailableBefore, upsertProduct } from "./ingest";

const VENDOR_NAME = "Hashtag";
const VENDOR_URL = "https://www.hashtag-lb.com";

export async function runHashtagCrawl() {
  const crawlStartedAt = new Date().toISOString();
  const products = await scrapeHashtagCollection(
    "https://www.hashtag-lb.com/collections/all"
  );

  let inserted = 0;
  let updated = 0;

  for (const product of products) {
    await upsertProduct(product);
    inserted++;
  }

  const vendorId = await getOrCreateVendorId(VENDOR_NAME, VENDOR_URL);
  await markProductsUnavailableBefore(vendorId, crawlStartedAt);

  return { found: products.length, inserted, updated };
}

runHashtagCrawl()
  .then(({ found, inserted, updated }) => {
    console.log(`Done. Found=${found}, Inserted=${inserted}, Updated=${updated}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("Hashtag crawl failed", err);
    process.exit(1);
  });
