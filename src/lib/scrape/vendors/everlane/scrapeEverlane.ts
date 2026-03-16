import { scrapeShopifyStore, type ShopifyVendorConfig } from "../../shopifyEngine";
import type { ScrapedProduct } from "../../types";

const EVERLANE_CONFIG: ShopifyVendorConfig = {
  vendorName: "Everlane",
  vendorUrl: "https://www.everlane.com",
  storeUrl: "https://www.everlane.com",
  vendorRegion: "US",
  currency: "USD",
  returnPolicy: "Free returns within 30 days",
  brand: "Everlane",
  collections: [],
  delayMs: 600,
};

export async function scrapeEverlane(): Promise<ScrapedProduct[]> {
  return scrapeShopifyStore(EVERLANE_CONFIG);
}
