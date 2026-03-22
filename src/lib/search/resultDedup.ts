/**
 * Post-retrieval deduplication for search results (product id, canonical group,
 * same primary image URL, near-duplicate pHash).
 */
import { hammingDistance } from "../products/canonical";

export interface DedupSearchResultItem {
  id?: string | number;
  canonical_id?: string | number | null;
  image_cdn?: string | null;
  image_url?: string | null;
  images?: Array<{ url?: string | null; is_primary?: boolean; p_hash?: string | null }>;
  p_hash?: string | null;
  similarity_score?: number;
  rerankScore?: number;
  finalRelevance01?: number;
}

export interface DedupOptions {
  /** Max Hamming distance between pHashes to treat as duplicate (default 10) */
  imageHammingMax?: number;
}

function normalizeImageUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    return `${u.origin}${u.pathname}`.toLowerCase();
  } catch {
    return s.split("?")[0].toLowerCase().trim() || null;
  }
}

function primaryImageUrl(p: DedupSearchResultItem): string | null {
  const imgs = p.images;
  if (imgs?.length) {
    const prim = imgs.find((i) => i.is_primary) || imgs[0];
    if (prim?.url) return normalizeImageUrl(prim.url);
  }
  return normalizeImageUrl(p.image_cdn || p.image_url || null);
}

function primaryPHash(p: DedupSearchResultItem): string | null {
  if (p.p_hash) return p.p_hash;
  const imgs = p.images;
  if (imgs?.length) {
    const prim = imgs.find((i) => i.is_primary) || imgs[0];
    const h = prim?.p_hash;
    if (h) return h;
  }
  return null;
}

function scoreOf(p: DedupSearchResultItem): number {
  const f = p.finalRelevance01;
  if (typeof f === "number" && Number.isFinite(f)) return f * 1e9 + (p.rerankScore ?? 0);
  const r = p.rerankScore;
  if (typeof r === "number" && Number.isFinite(r)) return r;
  const s = p.similarity_score;
  if (typeof s === "number" && Number.isFinite(s)) return s;
  return 0;
}

/**
 * Keep highest-scoring item per duplicate key (id → canonical → image URL → pHash neighborhood).
 */
export function dedupeSearchResults<T extends DedupSearchResultItem>(items: T[], opts?: DedupOptions): T[] {
  const hammingMax = opts?.imageHammingMax ?? 10;
  const sorted = [...items].sort((a, b) => scoreOf(b) - scoreOf(a));
  const seenIds = new Set<string>();
  const seenCanonical = new Set<string>();
  const seenUrls = new Set<string>();
  const keptPhashes: string[] = [];

  const out: T[] = [];
  for (const p of sorted) {
    const idStr = p.id != null ? String(p.id) : "";
    if (idStr && seenIds.has(idStr)) continue;

    const c = p.canonical_id != null && String(p.canonical_id) !== "" ? String(p.canonical_id) : "";
    if (c && seenCanonical.has(c)) continue;

    const url = primaryImageUrl(p);
    if (url && seenUrls.has(url)) continue;

    const ph = primaryPHash(p);
    if (ph && ph.length >= 8) {
      let nearDup = false;
      for (const k of keptPhashes) {
        if (hammingDistance(ph, k) <= hammingMax) {
          nearDup = true;
          break;
        }
      }
      if (nearDup) continue;
      keptPhashes.push(ph);
    }

    if (idStr) seenIds.add(idStr);
    if (c) seenCanonical.add(c);
    if (url) seenUrls.add(url);
    out.push(p);
  }
  return out;
}

/**
 * Drop related items that duplicate main list by id or primary image URL, then dedupe related.
 */
export function filterRelatedAgainstMain<T extends DedupSearchResultItem>(
  main: T[],
  related: T[] | undefined | null,
): T[] | undefined {
  if (related == null) return undefined;
  if (related.length === 0) return [];

  const idSet = new Set(main.map((m) => String(m.id)));
  const urlSet = new Set(main.map((m) => primaryImageUrl(m)).filter(Boolean) as string[]);

  const filtered = related.filter((r) => {
    if (idSet.has(String(r.id))) return false;
    const u = primaryImageUrl(r);
    if (u && urlSet.has(u)) return false;
    return true;
  });

  return dedupeSearchResults(filtered);
}
