import fetch from "node-fetch";
import { extractProductUrls, parseProductPage } from "./vendors/moustache_lb";
import { deleteProductByUrl, getOrCreateVendorId, markUnseenProductsUnavailable, upsertProduct } from "./ingest";

// Start from a collection page (we can add more later)
const SEED_URLS = [
  // You can change this to other collections later
  "https://moustachestores.com/collections/all",
];

const VENDOR_NAME = "Moustache";
const VENDOR_URL = "https://moustachestores.com";

class NotFoundError extends Error {
  constructor(url: string) {
    super(`404: ${url}`);
  }
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      "accept-language": "en-US,en;q=0.9",
    },
  });

  if (res.status === 404) throw new NotFoundError(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return await res.text();
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      "accept-language": "en-US,en;q=0.9",
      accept: "text/html,application/xml;q=0.9,*/*;q=0.8",
    },
  });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return await res.text();
}

function extractSitemapLocs(xml: string): string[] {
  const out: string[] = [];
  const re = /<loc>([^<]+)<\/loc>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const loc = m[1]?.trim();
    if (loc) out.push(loc);
  }
  return out;
}

async function discoverProductUrlsFromSitemap(): Promise<string[]> {
  const urls = new Set<string>();
  const sitemapIndexUrl = `${VENDOR_URL}/sitemap.xml`;

  let sitemapLocs: string[] = [];
  try {
    const xml = await fetchText(sitemapIndexUrl);
    sitemapLocs = extractSitemapLocs(xml);
  } catch {
    sitemapLocs = [];
  }

  if (sitemapLocs.length === 0) {
    sitemapLocs = [`${VENDOR_URL}/sitemap_products_1.xml`];
  }

  for (const loc of sitemapLocs) {
    if (!loc.includes("sitemap_products")) continue;
    let xml = "";
    try {
      xml = await fetchText(loc);
    } catch {
      continue;
    }
    const locs = extractSitemapLocs(xml);
    for (const u of locs) {
      if (!u.includes("/products/")) continue;
      if (/gift-?card/i.test(u)) continue;
      urls.add(u.split("#")[0].split("?")[0]);
    }
  }

  return Array.from(urls);
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

function pageUrl(base: string, page: number) {
  const u = new URL(base);
  u.searchParams.set("page", String(page));
  return u.toString();
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export async function runMoustache() {
  const allProductUrls = new Set<string>();

  const sitemapUrls = await discoverProductUrlsFromSitemap();
  if (sitemapUrls.length > 0) {
    console.log(`\n=== Sitemap: found ${sitemapUrls.length} product URLs ===`);
    for (const u of sitemapUrls) allProductUrls.add(u);
  }

  // 1) Collect product URLs
  for (const seed of SEED_URLS) {
    console.log(`\n=== Seed: ${seed} ===`);

    const MAX_PAGES = 50;

    for (let page = 1; page <= MAX_PAGES; page++) {
      const listUrl = page === 1 ? seed : pageUrl(seed, page);

      let html: string;
      try {
        html = await fetchHtml(listUrl);
      } catch (e: any) {
        console.log(`Page ${page}: failed (${e.message})`);
        break;
      }

      const urls = extractProductUrls(html);
      let newCount = 0;

      for (const u of urls) {
        if (!allProductUrls.has(u)) {
          allProductUrls.add(u);
          newCount++;
        }
      }

      console.log(`Page ${page}: found ${newCount} new product URLs (total=${allProductUrls.size})`);

      if (newCount === 0) break;
    }
  }

  // 2) Visit product pages + ingest
  console.log(`\n=== Visiting ${allProductUrls.size} product pages ===`);

  let saved = 0;
  let failed = 0;
  const seenProductUrls = new Set<string>();

  for (const url of allProductUrls) {
    try {
      const html = await fetchHtml(url);
      const productJson = await fetchProductJson(url);
      const productOrList = parseProductPage(html, url, productJson);

      if (!productOrList) {
        console.log(`No product found - deleting from DB: ${url}`);
        await deleteProductByUrl(url).catch(() => {});
        failed++;
        continue;
      }

      const products = Array.isArray(productOrList) ? productOrList : [productOrList];

      for (const product of products) {
        product.vendor_name = VENDOR_NAME;
        product.vendor_url = VENDOR_URL;

        await upsertProduct(product);
        saved++;
        seenProductUrls.add(product.product_url);
      }

      if (saved % 10 === 0) {
        console.log(`Progress: ${saved}/${allProductUrls.size}`);
      }
    } catch (e: any) {
      if (e instanceof NotFoundError) {
        console.log(`404 - deleting from DB: ${url}`);
        await deleteProductByUrl(url).catch(() => {});
      } else {
        failed++;
        console.log(`Failed: ${url} -> ${e.message}`);
      }
    } finally {
      await sleep(500);
    }
  }

  const vendorId = await getOrCreateVendorId(VENDOR_NAME, VENDOR_URL);
  await markUnseenProductsUnavailable(vendorId, seenProductUrls);

  console.log(`\nDone. TotalUrls=${allProductUrls.size}, Saved=${saved}, Failed=${failed}`);
}

