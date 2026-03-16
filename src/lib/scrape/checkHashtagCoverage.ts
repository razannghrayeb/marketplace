import { supabaseAdmin } from "../supabaseAdmin";

const VENDOR_URL = "https://www.hashtag-lb.com";
const SHOPIFY_PRODUCTS_URL = "https://www.hashtag-lb.com/products.json";

type ShopifyProduct = {
  handle?: string;
};

async function fetchAllHashtagHandles(): Promise<string[]> {
  const handles = new Set<string>();
  const limit = 250;
  const maxPages = 50;

  for (let page = 1; page <= maxPages; page += 1) {
    const url = `${SHOPIFY_PRODUCTS_URL}?limit=${limit}&page=${page}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json,text/plain,*/*",
      },
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch ${url}: ${res.status}`);
    }

    const data = (await res.json()) as { products?: ShopifyProduct[] };
    const products = Array.isArray(data?.products) ? data.products : [];
    if (products.length === 0) break;

    for (const p of products) {
      const handle = (p.handle ?? "").trim();
      if (handle) handles.add(handle);
    }
  }

  return Array.from(handles);
}

function handleFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    const idx = parts.indexOf("products");
    if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
    return parts[parts.length - 1] ?? null;
  } catch {
    return null;
  }
}

async function fetchDbHandles(): Promise<string[]> {
  const { data: vendorRows, error: vendorErr } = await supabaseAdmin
    .from("vendors")
    .select("id")
    .eq("url", VENDOR_URL)
    .limit(1);

  if (vendorErr) throw vendorErr;
  const vendorId = Number(vendorRows?.[0]?.id);
  if (!vendorId) throw new Error("Hashtag vendor not found in DB");

  const handles = new Set<string>();
  const pageSize = 1000;
  let from = 0;

  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await supabaseAdmin
      .from("products")
      .select("parent_product_url, product_url")
      .eq("vendor_id", vendorId)
      .range(from, to);

    if (error) throw error;
    if (!data || data.length === 0) break;

    for (const row of data as any[]) {
      const handle =
        handleFromUrl(row.parent_product_url) ??
        handleFromUrl(row.product_url);
      if (handle) handles.add(handle);
    }

    if (data.length < pageSize) break;
    from += pageSize;
  }

  return Array.from(handles);
}

async function main() {
  const shopifyHandles = await fetchAllHashtagHandles();
  const dbHandles = await fetchDbHandles();

  const dbSet = new Set(dbHandles);
  const missing = shopifyHandles.filter((h) => !dbSet.has(h));

  console.log(`Shopify products: ${shopifyHandles.length}`);
  console.log(`DB products (distinct handles): ${dbHandles.length}`);
  console.log(`Missing in DB: ${missing.length}`);

  if (missing.length > 0) {
    console.log("Missing handles (first 20):");
    for (const h of missing.slice(0, 20)) {
      console.log(`- ${h}`);
    }
  }
}

main().catch((err) => {
  console.error("Hashtag coverage check failed", err);
  process.exit(1);
});
