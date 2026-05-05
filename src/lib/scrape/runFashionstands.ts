import fetch from "node-fetch";
import { parseProduct } from "./vendors/fashionstands_lb";
import { getOrCreateVendorId, markUnseenProductsUnavailable, upsertProduct } from "./ingest";

const VENDOR_NAME = "Fashion Stands";
const VENDOR_URL = "https://fashion-stands.myshopify.com";

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function fetchProductPage(page: number): Promise<any[]> {
  const url = `${VENDOR_URL}/products.json?limit=250&page=${page}`;

  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      "accept-language": "en-US,en;q=0.9",
      accept: "application/json",
    },
  });

  if (!res.ok) throw new Error(`Failed to fetch products: ${res.status}`);
  const data = (await res.json()) as any;
  return Array.isArray(data?.products) ? data.products : [];
}

export async function runFashionstands() {
  console.log("=== Fashion Stands scraper started ===");

  let saved = 0;
  let failed = 0;
  let page = 1;
  const seenProductUrls = new Set<string>();

  while (true) {
    let products: any[];

    try {
      products = await fetchProductPage(page);
    } catch (e: any) {
      console.error("Failed to fetch product page:", e.message);
      break;
    }

    if (products.length === 0) break;

    for (const raw of products) {
      const product = parseProduct(raw);

      if (!product) {
        failed++;
        continue;
      }

      try {
        await upsertProduct(product);
        seenProductUrls.add(product.product_url);
        saved++;
      } catch (e: any) {
        failed++;
        console.error(`Failed to upsert ${product.product_url}:`, e.message);
      }
    }

    console.log(`Page ${page}: saved=${saved}`);

    if (products.length < 250) break;
    page++;
    await sleep(300);
  }

  const vendorId = await getOrCreateVendorId(VENDOR_NAME, VENDOR_URL);
  await markUnseenProductsUnavailable(vendorId, seenProductUrls);

  console.log(`\n=== Done. Saved=${saved}, Failed=${failed} ===`);
  return { saved, failed };
}
