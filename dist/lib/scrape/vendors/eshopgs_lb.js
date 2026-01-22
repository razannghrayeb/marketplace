"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CATEGORY_URLS = void 0;
exports.listProductUrls = listProductUrls;
exports.parseProduct = parseProduct;
const cheerio_1 = require("cheerio");
// One vendor, multiple categories
exports.CATEGORY_URLS = [
    "https://eshopgs.com/lb/product-category/girl/",
    "https://eshopgs.com/lb/product-category/boy/",
    "https://eshopgs.com/lb/product-category/women/",
    "https://eshopgs.com/lb/product-category/men/",
];
const BASE = "https://eshopgs.com";
/*helpers*/
function moneyToCents(s) {
    const n = Number(String(s).replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
function detectCurrency(s) {
    if (/\$|USD/i.test(s))
        return "USD";
    if (/LBP|ليرة|ل\.\ل/i.test(s))
        return "LBP";
    return "USD";
}
/*LISTING PAGE*/
function listProductUrls(listingHtml) {
    const $ = (0, cheerio_1.load)(listingHtml);
    const urls = $("a")
        .map((_, el) => $(el).attr("href"))
        .get()
        .filter((href) => Boolean(href))
        .map((href) => new URL(href, BASE).toString())
        .filter((u) => u.includes("/lb/product/"));
    return Array.from(new Set(urls));
}
/*PRODUCT PAGE */
function parseProduct(html, productUrl) {
    const $ = (0, cheerio_1.load)(html);
    const brand = $("h1.product_title.entry-title a").text().trim() || undefined;
    const title = $(".product-collection").text().trim();
    //   const saleText = $("ins .woocommerce-Price-amount.amount")
    //     .first()
    //     .text()
    //     .trim();
    //   const regularText = $("del .woocommerce-Price-amount.amount")
    //     .first()
    //     .text()
    //     .trim();
    //   const finalText =
    //     saleText ||
    //     regularText ||
    //     $(".woocommerce-Price-amount.amount").first().text().trim();
    //   const currency = detectCurrency(finalText);
    //   const price_cents = moneyToCents(finalText);
    //   const original_price_cents =
    //     saleText && regularText ? moneyToCents(regularText) : undefined;
    // 1) Try JSON-LD (sometimes available)
    let jsonPriceText = "";
    let jsonCurrency = "";
    $('script[type="application/ld+json"]').each((_, el) => {
        if (jsonPriceText)
            return;
        const raw = $(el).text().trim();
        if (!raw)
            return;
        try {
            const data = JSON.parse(raw);
            const items = Array.isArray(data) ? data : [data];
            for (const item of items) {
                const candidates = Array.isArray(item["@graph"]) ? item["@graph"] : [item];
                for (const c of candidates) {
                    if (c?.["@type"] === "Product" && c?.offers) {
                        const offers = Array.isArray(c.offers) ? c.offers[0] : c.offers;
                        const price = offers?.price ?? offers?.lowPrice;
                        const currency = offers?.priceCurrency;
                        if (price != null)
                            jsonPriceText = String(price);
                        if (currency)
                            jsonCurrency = String(currency);
                        if (jsonPriceText)
                            return;
                    }
                }
            }
        }
        catch {
            // ignore invalid JSON
        }
    });
    // 2) Try WooCommerce variations JSON (very common on variable products)
    let variationPriceNumber = null;
    let variationCurrency = "";
    const variationsRaw = $("form.variations_form").attr("data-product_variations");
    if (variationsRaw) {
        try {
            const variations = JSON.parse(variationsRaw);
            if (Array.isArray(variations) && variations.length > 0) {
                const v = variations.find((x) => x?.display_price != null) ||
                    variations.find((x) => x?.display_regular_price != null) ||
                    variations[0];
                if (v?.display_price != null)
                    variationPriceNumber = Number(v.display_price);
                // Sometimes currency is only visible inside price_html
                if (typeof v?.price_html === "string") {
                    variationCurrency = detectCurrency(v.price_html);
                }
            }
        }
        catch {
            // ignore JSON errors
        }
    }
    // 3) Fallback to visible HTML prices
    const saleText = $("ins .woocommerce-Price-amount.amount").first().text().trim();
    const regularText = $("del .woocommerce-Price-amount.amount").first().text().trim();
    const htmlFinalText = saleText ||
        regularText ||
        $(".woocommerce-Price-amount.amount").first().text().trim();
    // Choose best available source
    const finalText = jsonPriceText || htmlFinalText;
    // Currency: prefer JSON-LD, then variations, then detect from text
    const currency = jsonCurrency || variationCurrency || detectCurrency(finalText);
    // Price: prefer variations number, then JSON-LD/HTML text
    const price_cents = variationPriceNumber != null && Number.isFinite(variationPriceNumber)
        ? Math.round(variationPriceNumber * 100)
        : moneyToCents(finalText);
    const original_price_cents = saleText && regularText ? moneyToCents(regularText) : undefined;
    //ends
    // Image from background-image style
    const style = $("button.color-option.selected").attr("style") || "";
    const image_url = style.match(/url\(["']?(.*?)["']?\)/)?.[1] || undefined;
    return {
        vendor_name: "eshopgs",
        vendor_region: "LB",
        vendor_url: "https://eshopgs.com",
        product_url: productUrl,
        title,
        brand,
        currency,
        price_cents,
        original_price_cents,
        image_url,
    };
}
