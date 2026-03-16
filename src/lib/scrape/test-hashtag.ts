import { scrapeHashtagCollection } from "./vendors/hashtag";

async function main() {
  const products = await scrapeHashtagCollection(
    "https://www.hashtag-lb.com/collections/all"
  );

  console.log("TOTAL PRODUCTS:", products.length);
  console.log(products.slice(0, 5));
}

main().catch(console.error);