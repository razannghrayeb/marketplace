import fetch from "node-fetch";
import { CATEGORY_URLS, listCategoryUrls, listProductUrls, parseProduct } from "./vendors/eshopgs_lb";
import { getOrCreateVendorId, markUnseenProductsUnavailable, upsertProduct } from "./ingest";//Saves the product into Postgres
import { pg } from "../core/db"; //Used to check if product already exists

const VENDOR_NAME = "eshopgs";
const VENDOR_URL = "https://eshopgs.com";
const HOME_URL = "https://eshopgs.com/lb/";

/**
 * Build the next page URL for WooCommerce category pages.
 * Common formats:
 *  - https://site.com/category/        (page 1)
 *  - https://site.com/category/page/2/ (page 2+)
 */
function categoryPageUrl(baseCategoryUrl: string, page: number): string {
  if (page <= 1) return baseCategoryUrl;

  // ensure trailing slash
  const base = baseCategoryUrl.endsWith("/") ? baseCategoryUrl : baseCategoryUrl + "/";
  return `${base}page/${page}/`;
}

/**
 * Crawl ALL pages for each category.
 * Safety:
 * - maxPages prevents infinite loops if the website behaves weirdly.
 */
export async function runEshopgsCrawl(opts?: { maxPages?: number; delayMs?: number }) {
  const maxPages = opts?.maxPages ?? 50;   // safety cap
  const delayMs = opts?.delayMs ?? 0;      // optional politeness delay

  let found = 0;
  let inserted = 0;
  let updated = 0;
  let debugLogged = 0;
  const DEBUG_LIMIT = 10;

  // Track listing URLs we already processed (avoid duplicates across pages)
  const seenListingUrls = new Set<string>();

  let categoryUrls: string[] = [];
  try {
    const homeHtml = await (await fetch(HOME_URL)).text();
    categoryUrls = listCategoryUrls(homeHtml);
  } catch {
    // ignore and fall back
  }

  if (categoryUrls.length === 0) {
    categoryUrls = CATEGORY_URLS;
  }

  console.log(`Using ${categoryUrls.length} category URLs`);

  for (const categoryUrl of categoryUrls) {
    console.log(`\n=== Category: ${categoryUrl} ===`);

    for (let page = 1; page <= maxPages; page++) {
      const pageUrl = categoryPageUrl(categoryUrl, page);

      let listingHtml: string;
      try {
        const res = await fetch(pageUrl);
        if (!res.ok) {
          console.log(`Stop: ${pageUrl} returned HTTP ${res.status}`);
          break;
        }
        listingHtml = await res.text();
      } catch (e) {
        console.log(`Stop: failed to fetch listing page ${pageUrl}`);
        break;
      }

      const rawUrls = listProductUrls(listingHtml);

      // Filter out URLs we already saw from previous pages/categories
      const productUrls = rawUrls.filter((u) => {
        if (seenListingUrls.has(u)) return false;
        seenListingUrls.add(u);
        return true;
      });

      console.log(`Page ${page}: found ${productUrls.length} new product URLs`);

      // If the page has no products, we assume pagination ended
      if (productUrls.length === 0) break;

      found += productUrls.length;

      for (const url of productUrls) {
        try {
          const productHtml = await (await fetch(url)).text();
          const scrapedRows = parseProduct(productHtml, url);

          for (const scraped of scrapedRows) {
            if (debugLogged < DEBUG_LIMIT) {
              console.log(
                `DEBUG brand=${scraped.brand ?? "null"} title=${scraped.title ?? "null"} url=${scraped.product_url}`
              );
              debugLogged += 1;
            }

            // check if product already exists (by vendor name + product_url)
            const exists = await pg.query(
              `
              SELECT 1
              FROM products p
              JOIN vendors v ON v.id = p.vendor_id
              WHERE v.name = $1 AND p.product_url = $2
              LIMIT 1
              `,
              [scraped.vendor_name, scraped.product_url]
            );

            await upsertProduct(scraped);

            if (exists.rowCount === 0) inserted++;
            else updated++;
          }
        } catch (err) {
          console.error("Failed for URL:", url);
          console.error(err);
        }

        if (delayMs > 0) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }

      if (delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  const vendorId = await getOrCreateVendorId(VENDOR_NAME, VENDOR_URL);
  await markUnseenProductsUnavailable(vendorId, seenListingUrls);

  return { found, inserted, updated };
}

