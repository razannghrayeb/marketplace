import fetch from "node-fetch";
import { parseProductPage } from "./vendors/myholdal_lb";
import { getOrCreateVendorId, markUnseenProductsUnavailable, upsertProduct } from "./ingest";

const BASE = "https://myholdal.com";
const VENDOR_NAME = "MYHOLDAL";
const VENDOR_URL = "https://myholdal.com";

/** Fetch text (HTML/XML) */
async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      "accept-language": "en-US,en;q=0.9",
    },
  });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return await res.text();
}

async function fetchProductJson(productUrl: string): Promise<any | null> {
  const base = productUrl.split("#")[0].split("?")[0];
  const url = base.endsWith(".js") ? base : `${base}.js`;
  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      "accept-language": "en-US,en;q=0.9",
      accept: "application/json",
    },
  });
  if (!res.ok) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}
function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** Extract <loc>...</loc> URLs from sitemap XML */
function extractLocUrls(xml: string): string[] {
  const urls: string[] = [];
  const re = /<loc>\s*([^<]+)\s*<\/loc>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    urls.push(m[1]);
  }
  return urls;
}

/** Get all product page URLs by crawling sitemap index -> product sitemaps */
async function getAllProductUrlsFromSitemap(): Promise<string[]> {
  // 1) Fetch sitemap index
  const indexXml = await fetchText(`${BASE}/sitemap.xml`);
  const sitemapUrls = extractLocUrls(indexXml);

  // 2) Keep only "product" sitemaps
  const productSitemaps = sitemapUrls.filter((u) => u.includes("sitemap_products"));

  // If the store doesn't split, sometimes product URLs are directly in sitemap.xml
  if (productSitemaps.length === 0) {
    const directProducts = sitemapUrls.filter((u) => u.includes("/products/") && u.includes("myholdal.com"));
    return Array.from(new Set(directProducts));
  }

  // 3) Crawl each product sitemap and collect product URLs
  const productUrls = new Set<string>();

  for (const sm of productSitemaps) {
    try {
      const xml = await fetchText(sm);
      const urls = extractLocUrls(xml)
        .filter((u) => u.includes("/products/"))
        .filter((u) => !u.includes("admin.shopify.com"))
        .filter((u) => u.includes("myholdal.com"));

      urls.forEach((u) => productUrls.add(u));
      console.log(`Sitemap: ${sm} -> +${urls.length} products (total=${productUrls.size})`);
    } catch (e: any) {
      console.log(`Sitemap failed: ${sm} -> ${e.message}`);
    }
  }

  return Array.from(productUrls);
}

async function run() {
  console.log(`\n=== MYHOLDAL sitemap crawl ===`);
  const productUrls = await getAllProductUrlsFromSitemap();

  console.log(`\n=== Visiting ${productUrls.length} product pages ===`);

  let saved = 0;
  let failed = 0;
  const seenProductUrls = new Set<string>();

  for (const url of productUrls) {
    try {
      const html = await fetchText(url);
      const productJson = await fetchProductJson(url);
      const productOrList = parseProductPage(html, url, productJson);

      if (!productOrList) {
        failed++;
        continue;
      }

      const products = Array.isArray(productOrList) ? productOrList : [productOrList];

      for (const product of products) {
        await upsertProduct(product as any);
        saved++;
        seenProductUrls.add(product.product_url);
      }

      if (saved % 50 === 0) {
        console.log(`Progress: ${saved}/${productUrls.length}`);
      }
    } catch (e: any) {
      failed++;
      console.log(`Failed: ${url} -> ${e.message}`);
    } finally {
      await sleep(500);
    }
  }

  const vendorId = await getOrCreateVendorId(VENDOR_NAME, VENDOR_URL);
  await markUnseenProductsUnavailable(vendorId, seenProductUrls);

  console.log(`\nDone. TotalUrls=${productUrls.length}, Saved=${saved}, Failed=${failed}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
