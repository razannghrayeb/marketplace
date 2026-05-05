// src/lib/scrape/vendors/hm_discover_us.ts
import fetch from "node-fetch";

const BASE = "https://www2.hm.com";

function extractNextDataJson(html: string): any {
  const m = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
  );
  if (!m) throw new Error("__NEXT_DATA__ not found");
  return JSON.parse(m[1]);
}

// This is the same idea as your console script, but in Node.
// Also ignores hmgoe:// weird deep links (seen in your PDF). 
function collectProductUrls(obj: any, out = new Set<string>()): Set<string> {
  if (obj == null) return out;

  if (typeof obj === "string") {
    if (obj.startsWith("hmgoe://")) return out;
    if (obj.includes("productpage.") && obj.includes(".html")) {
      const full = obj.startsWith("http") ? obj : `${BASE}${obj}`;
      out.add(full);
    }
    return out;
  }

  if (Array.isArray(obj)) {
    for (const v of obj) collectProductUrls(v, out);
    return out;
  }

  if (typeof obj === "object") {
    for (const v of Object.values(obj)) collectProductUrls(v, out);
  }

  return out;
}

export async function discoverHmProductUrlsBySearch(opts: {
  query: string;
  maxPages?: number;
  delayMs?: number;
  locale?: string;
}): Promise<string[]> {
  const { query, maxPages = 80, delayMs = 250, locale = "en_us" } = opts;

  const urls = new Set<string>();

  for (let page = 1; page <= maxPages; page++) {
    const url = `${BASE}/${locale}/search-results.html?q=${encodeURIComponent(query)}&page=${page}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
      },
      redirect: "follow",
    });

    if (!res.ok) {
      console.warn(`[HM discover] q="${query}" page=${page}: HTTP ${res.status} — stopping`);
      break;
    }

    const html = await res.text();
    let nextData: any;
    try {
      nextData = extractNextDataJson(html);
    } catch {
      console.warn(`[HM discover] q="${query}" page=${page}: __NEXT_DATA__ not found, skipping`);
      break;
    }

    const before = urls.size;
    collectProductUrls(nextData, urls);
    const added = urls.size - before;

    console.log(`[HM discover] q="${query}" page=${page} +${added} (total=${urls.size})`);

    // Stop when this page yields nothing new (usually end of results)
    if (added === 0) break;

    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
  }

  return [...urls];
}