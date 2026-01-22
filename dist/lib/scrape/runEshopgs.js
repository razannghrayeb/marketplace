"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runEshopgsCrawl = runEshopgsCrawl;
const node_fetch_1 = __importDefault(require("node-fetch"));
const eshopgs_lb_1 = require("./vendors/eshopgs_lb");
const ingest_1 = require("./ingest"); //Saves the product into Postgres
const db_1 = require("../core/db"); //Used to check if product already exists
/**
 * Build the next page URL for WooCommerce category pages.
 * Common formats:
 *  - https://site.com/category/        (page 1)
 *  - https://site.com/category/page/2/ (page 2+)
 */
function categoryPageUrl(baseCategoryUrl, page) {
    if (page <= 1)
        return baseCategoryUrl;
    // ensure trailing slash
    const base = baseCategoryUrl.endsWith("/") ? baseCategoryUrl : baseCategoryUrl + "/";
    return `${base}page/${page}/`;
}
/**
 * Crawl ALL pages for each category.
 * Safety:
 * - maxPages prevents infinite loops if the website behaves weirdly.
 */
async function runEshopgsCrawl(opts) {
    const maxPages = opts?.maxPages ?? 50; // safety cap
    const delayMs = opts?.delayMs ?? 0; // optional politeness delay
    let found = 0;
    let inserted = 0;
    let updated = 0;
    // Track listing URLs we already processed (avoid duplicates across pages)
    const seenListingUrls = new Set();
    for (const categoryUrl of eshopgs_lb_1.CATEGORY_URLS) {
        console.log(`\n=== Category: ${categoryUrl} ===`);
        for (let page = 1; page <= maxPages; page++) {
            const pageUrl = categoryPageUrl(categoryUrl, page);
            let listingHtml;
            try {
                const res = await (0, node_fetch_1.default)(pageUrl);
                if (!res.ok) {
                    console.log(`Stop: ${pageUrl} returned HTTP ${res.status}`);
                    break;
                }
                listingHtml = await res.text();
            }
            catch (e) {
                console.log(`Stop: failed to fetch listing page ${pageUrl}`);
                break;
            }
            const rawUrls = (0, eshopgs_lb_1.listProductUrls)(listingHtml);
            // Filter out URLs we already saw from previous pages/categories
            const productUrls = rawUrls.filter((u) => {
                if (seenListingUrls.has(u))
                    return false;
                seenListingUrls.add(u);
                return true;
            });
            console.log(`Page ${page}: found ${productUrls.length} new product URLs`);
            // If the page has no products, we assume pagination ended
            if (productUrls.length === 0)
                break;
            found += productUrls.length;
            for (const url of productUrls) {
                try {
                    const productHtml = await (await (0, node_fetch_1.default)(url)).text();
                    const scraped = (0, eshopgs_lb_1.parseProduct)(productHtml, url);
                    // check if product already exists (by vendor name + product_url)
                    const exists = await db_1.pg.query(`
            SELECT 1
            FROM products p
            JOIN vendors v ON v.id = p.vendor_id
            WHERE v.name = $1 AND p.product_url = $2
            LIMIT 1
            `, [scraped.vendor_name, scraped.product_url]);
                    await (0, ingest_1.upsertProduct)(scraped);
                    if (exists.rowCount === 0)
                        inserted++;
                    else
                        updated++;
                }
                catch (err) {
                    console.error("Failed for URL:", url);
                    console.error(err);
                }
            }
            if (delayMs > 0) {
                await new Promise((r) => setTimeout(r, delayMs));
            }
        }
    }
    return { found, inserted, updated };
}
// run directly
runEshopgsCrawl({ maxPages: 2, delayMs: 0 })
    .then(({ found, inserted, updated }) => {
    console.log(`\nDone. Found=${found}, Inserted=${inserted}, Updated=${updated}`);
    process.exit(0);
})
    .catch((err) => {
    console.error("Crawl failed", err);
    process.exit(1);
});
