import { supabaseAdmin } from "../supabaseAdmin";
import { CATEGORY_URLS, listCategoryUrls, listProductUrls } from "./vendors/eshopgs_lb";

const VENDOR_URL = "https://eshopgs.com";
const HOME_URL = "https://eshopgs.com/lb/";

const RETRYABLE_CODES = new Set(["ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT"]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url: string, attempts = 3): Promise<string> {
  let lastErr: unknown = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0",
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } catch (err: any) {
      lastErr = err;
      const code = err?.code || err?.cause?.code;
      if (!code || !RETRYABLE_CODES.has(code) || i === attempts - 1) throw err;
      await sleep(500 * Math.pow(2, i));
    }
  }
  throw lastErr;
}

function normalizeUrl(url: string): string {
  const u = new URL(url);
  u.hash = "";
  u.search = "";
  return u.toString();
}

async function fetchAllCategoryProductUrls(): Promise<string[]> {
  let categoryUrls: string[] = [];
  try {
    const homeHtml = await fetchWithRetry(HOME_URL);
    categoryUrls = listCategoryUrls(homeHtml);
  } catch {
    // ignore and fall back
  }

  if (categoryUrls.length === 0) {
    categoryUrls = CATEGORY_URLS;
  }

  const urls = new Set<string>();
  const maxPages = 50;

  for (const categoryUrl of categoryUrls) {
    let emptyStreak = 0;

    for (let page = 1; page <= maxPages; page += 1) {
      const url = (() => {
        if (page === 1) return categoryUrl;
        try {
          const u = new URL(categoryUrl);
          u.searchParams.set("paged", String(page));
          return u.toString();
        } catch {
          return categoryUrl;
        }
      })();

      const html = await fetchWithRetry(url);
      const pageUrls = listProductUrls(html);
      let added = 0;

      for (const u of pageUrls) {
        const normalized = normalizeUrl(u);
        if (!urls.has(normalized)) {
          urls.add(normalized);
          added += 1;
        }
      }

      if (pageUrls.length === 0 || added === 0) {
        emptyStreak += 1;
      } else {
        emptyStreak = 0;
      }

      if (emptyStreak >= 2) break;
      await sleep(150);
    }
  }

  return Array.from(urls);
}

async function fetchDbProductUrls(): Promise<string[]> {
  const { data: vendorRows, error: vendorErr } = await supabaseAdmin
    .from("vendors")
    .select("id")
    .eq("url", VENDOR_URL)
    .limit(1);

  if (vendorErr) throw vendorErr;
  const vendorId = Number(vendorRows?.[0]?.id);
  if (!vendorId) throw new Error("EshopGS vendor not found in DB");

  const urls = new Set<string>();
  const pageSize = 1000;
  let from = 0;

  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await supabaseAdmin
      .from("products")
      .select("product_url, parent_product_url")
      .eq("vendor_id", vendorId)
      .range(from, to);

    if (error) throw error;
    if (!data || data.length === 0) break;

    for (const row of data as any[]) {
      const raw = row.parent_product_url ?? row.product_url;
      if (!raw) continue;
      urls.add(normalizeUrl(String(raw)));
    }

    if (data.length < pageSize) break;
    from += pageSize;
  }

  return Array.from(urls);
}

async function main() {
  const siteUrls = await fetchAllCategoryProductUrls();
  const dbUrls = await fetchDbProductUrls();

  const dbSet = new Set(dbUrls);
  const missing = siteUrls.filter((u) => !dbSet.has(u));

  console.log(`Site products: ${siteUrls.length}`);
  console.log(`DB products (distinct parent/product URLs): ${dbUrls.length}`);
  console.log(`Missing in DB: ${missing.length}`);

  if (missing.length > 0) {
    console.log("Missing URLs (first 20):");
    for (const u of missing.slice(0, 20)) {
      console.log(`- ${u}`);
    }
  }
}

main().catch((err) => {
  console.error("EshopGS coverage check failed", err);
  process.exit(1);
});
