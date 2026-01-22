import fetch from "node-fetch";
import { extractProductUrls, parseProductPage } from "./vendors/moustache_lb";
import { upsertProduct } from "./ingest";

// Start from a collection page (we can add more later)
const SEED_URLS = [
  // You can change this to other collections later
  "https://moustachestores.com/collections/all",
];

async function fetchHtml(url: string): Promise<string> {
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

function pageUrl(base: string, page: number) {
  const u = new URL(base);
  u.searchParams.set("page", String(page));
  return u.toString();
}

async function run() {
  const allProductUrls = new Set<string>();

  // 1) Collect product URLs
  for (const seed of SEED_URLS) {
    console.log(`\n=== Seed: ${seed} ===`);

    const MAX_PAGES = 5; // start small; increase later

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

  for (const url of allProductUrls) {
    try {
      const html = await fetchHtml(url);
      const product = parseProductPage(html, url);

      if (!product) {
        failed++;
        continue;
      }

      await upsertProduct(product as any);
      saved++;

      if (saved % 10 === 0) {
        console.log(`Progress: ${saved}/${allProductUrls.size}`);
      }
    } catch (e: any) {
      failed++;
      console.log(`Failed: ${url} -> ${e.message}`);
    }
  }

  console.log(`\nDone. TotalUrls=${allProductUrls.size}, Saved=${saved}, Failed=${failed}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
