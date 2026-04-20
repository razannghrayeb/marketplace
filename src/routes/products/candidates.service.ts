/**
 * Candidates Service - Unified candidate generator for recommendations
 *
 * Pulls candidates from multiple sources:
 * 1. CLIP k-NN (visually similar items)
 * 2. Text/hybrid search (same name/material/attributes)
 * 3. Optional pHash deduplication (removes near-identical images)
 *
 * Returns a consistent list with scores from each source.
 */
import { osClient } from "../../lib/core";
import { pg, getProductsByIdsOrdered } from "../../lib/core";
import { config } from "../../config";
import { getImagesForProducts } from "./images.service";
import { hammingDistance } from "../../lib/products";
import { parseQuery, buildSemanticOpenSearchQuery } from "../../lib/search";
import type {
  CandidateGeneratorParams,
  CandidateGeneratorResult,
  CandidateResult,
  CandidateSource,
  ProductResult,
} from "./types";

// ============================================================================
// Constants
// ============================================================================

const CLIP_WEIGHT = 0.6;
const TEXT_WEIGHT = 0.4;

// ============================================================================
// Main Candidate Generator
// ============================================================================

/**
 * Unified candidate generator for recommendation/outfit engine
 *
 * Pulls candidates from multiple sources:
 * 1. CLIP k-NN (visually similar items)
 * 2. Text/hybrid search (same name/material/attributes)
 * 3. Optional pHash deduplication (removes near-identical images)
 *
 * Returns a consistent list with scores from each source.
 */
export async function getCandidateScoresForProducts(
  params: CandidateGeneratorParams
): Promise<CandidateGeneratorResult> {
  const startTime = Date.now();
  const {
    baseProductId,
    limit = 30,
    clipLimit = 200,
    textLimit = 200,
    usePHashDedup = true,
    pHashThreshold = 5,
  } = params;

  // Input validation
  const numericId = parseInt(baseProductId, 10);
  if (isNaN(numericId) || numericId <= 0) {
    console.warn(`[CandidateGenerator] Invalid baseProductId: ${baseProductId}`);
    return createEmptyResult(baseProductId);
  }

  // Fetch base product from Postgres
  const baseProduct = await fetchBaseProduct(numericId);
  if (!baseProduct) {
    console.warn(`[CandidateGenerator] Base product not found: ${baseProductId}`);
    return createEmptyResult(baseProductId);
  }

  const { base, basePHash, embedding } = baseProduct;

  // Score maps
  const clipScoreMap = new Map<string, number>();
  const clipRawMap = new Map<string, number>();
  const textScoreMap = new Map<string, number>();
  const textRawMap = new Map<string, number>();

  // Timing tracking
  let clipMs = 0;
  let textMs = 0;

  // -------------------------------------------------------------------------
  // Run CLIP and Text searches in parallel for performance
  // -------------------------------------------------------------------------
  const searchPromises: Promise<void>[] = [];

  // 1) CLIP k-NN search (visually similar)
  if (embedding && embedding.length > 0) {
    searchPromises.push(
      runClipSearch(embedding, base.id, clipLimit, clipScoreMap, clipRawMap).then(
        (ms) => {
          clipMs = ms;
        }
      )
    );
  }

  // 2) Text/hybrid search (same item/name/material)
  if (base.title) {
    searchPromises.push(
      runTextSearch(base.title, base.id, textLimit, textScoreMap, textRawMap).then(
        (ms) => {
          textMs = ms;
        }
      )
    );
  }

  // Wait for both searches to complete
  await Promise.all(searchPromises);

  // -------------------------------------------------------------------------
  // 3) Merge candidate IDs and determine source
  // -------------------------------------------------------------------------
  const { allIds, sourceMap, metaClipCount, metaTextCount, metaMergedTotal } = mergeCandiates(
    clipScoreMap,
    textScoreMap
  );

  // -------------------------------------------------------------------------
  // 4) Rank candidates by combined score FIRST
  // -------------------------------------------------------------------------
  const rankedIds = rankCandidatesByScore(allIds, clipScoreMap, textScoreMap, limit);

  // -------------------------------------------------------------------------
  // 5) pHash deduplication on TOP candidates only
  // -------------------------------------------------------------------------
  const pHashStart = Date.now();
  const { filteredIds, pHashDistMap, pHashFiltered } = await filterByPHash(
    rankedIds,
    basePHash,
    usePHashDedup,
    pHashThreshold
  );
  const pHashMs = Date.now() - pHashStart;

  // -------------------------------------------------------------------------
  // 6) Fetch product data and build results
  // -------------------------------------------------------------------------
  const finalIds = filteredIds.slice(0, Math.max(limit * 2, 100));

  if (finalIds.length === 0) {
    return {
      candidates: [],
      meta: {
        baseProductId,
        clipCandidates: metaClipCount,
        textCandidates: metaTextCount,
        mergedTotal: metaMergedTotal,
        pHashFiltered,
        finalCount: 0,
      },
    };
  }

  const candidates = await buildCandidateResults(
    finalIds,
    clipScoreMap,
    textScoreMap,
    textRawMap,
    pHashDistMap,
    sourceMap
  );

  // Sort: both > clip > text, then by combined score
  sortCandidates(candidates);

  const finalCandidates = candidates.slice(0, limit);
  const totalMs = Date.now() - startTime;

  // Log performance metrics in non-production or if slow
  logPerformance(
    baseProductId,
    metaClipCount,
    metaTextCount,
    metaMergedTotal,
    pHashFiltered,
    finalCandidates.length,
    clipMs,
    textMs,
    pHashMs,
    totalMs
  );

  return {
    candidates: finalCandidates,
    meta: {
      baseProductId,
      clipCandidates: metaClipCount,
      textCandidates: metaTextCount,
      mergedTotal: metaMergedTotal,
      pHashFiltered,
      finalCount: finalCandidates.length,
      timings: { clipMs, textMs, pHashMs, totalMs },
    },
  };
}

// ============================================================================
// Internal Helpers
// ============================================================================

interface BaseProductData {
  base: { id: number; title: string; brand: string | null; category: string | null };
  basePHash: string | null;
  embedding: number[] | undefined;
}

/**
 * Create an empty result for error cases
 */
function createEmptyResult(baseProductId: string): CandidateGeneratorResult {
  return {
    candidates: [],
    meta: {
      baseProductId,
      clipCandidates: 0,
      textCandidates: 0,
      mergedTotal: 0,
      pHashFiltered: 0,
      finalCount: 0,
    },
  };
}

/**
 * Fetch base product data from PostgreSQL and OpenSearch
 */
async function fetchBaseProduct(numericId: number): Promise<BaseProductData | null> {
  const prodRes = await pg.query(
    `SELECT id, title, brand, category, image_cdn, p_hash FROM products WHERE id = $1`,
    [numericId]
  );

  if (prodRes.rowCount === 0) {
    return null;
  }

  const base = prodRes.rows[0];
  const basePHash: string | null = base.p_hash;

  // Try to get embedding from OpenSearch document
  let embedding: number[] | undefined;
  try {
    const osGet = await osClient.get({ index: config.opensearch.index, id: String(base.id) });
    if (osGet?.body?._source?.embedding && Array.isArray(osGet.body._source.embedding)) {
      embedding = osGet.body._source.embedding;
    }
  } catch {
    // ignore - document may not exist
  }

  return { base, basePHash, embedding };
}

/**
 * Run CLIP k-NN search for visually similar products
 */
async function runClipSearch(
  embedding: number[],
  baseId: number,
  clipLimit: number,
  clipScoreMap: Map<string, number>,
  clipRawMap: Map<string, number>
): Promise<number> {
  const clipStart = Date.now();
  const fetchLimit = Math.min(clipLimit, 500);

  const clipBody = {
    size: fetchLimit,
    _source: ["product_id"],
    query: {
      bool: {
        must: { knn: { embedding: { vector: embedding, k: fetchLimit } } },
            filter: [{ bool: { must_not: [{ term: { is_hidden: true } }] } }],
      },
    },
  };

  try {
    const resp = await osClient.search({ index: config.opensearch.index, body: clipBody });
    const hits = resp.body.hits.hits || [];
    const maxScore = hits.length > 0 ? hits[0]._score : 1;

    for (const hit of hits) {
      const id = String(hit._source.product_id);
      if (id === String(baseId)) continue;
      clipRawMap.set(id, hit._score);
      clipScoreMap.set(id, Math.round(Math.min(1, hit._score / maxScore) * 1000) / 1000);
    }
  } catch (err) {
    console.warn(`[CandidateGenerator] CLIP search failed for ${baseId}:`, err);
  }

  return Date.now() - clipStart;
}

/**
 * Run text/hybrid search for similar products by name/material
 */
async function runTextSearch(
  title: string,
  baseId: number,
  textLimit: number,
  textScoreMap: Map<string, number>,
  textRawMap: Map<string, number>
): Promise<number> {
  const textStart = Date.now();

  try {
    const parsed = parseQuery(title);
    const textQuery = buildSemanticOpenSearchQuery(parsed, undefined, textLimit);
    // Add hidden filter
    if (!textQuery.query.bool) textQuery.query = { bool: { must: textQuery.query } };
    if (!textQuery.query.bool.filter) textQuery.query.bool.filter = [];
    textQuery.query.bool.filter.push({ bool: { must_not: [{ term: { is_hidden: true } }] } });

    const resp = await osClient.search({ index: config.opensearch.index, body: textQuery });
    const hits = resp.body.hits.hits || [];
    const maxScore = hits.length > 0 ? hits[0]._score : 1;

    for (const hit of hits) {
      const id = String(hit._source.product_id);
      if (id === String(baseId)) continue;
      textRawMap.set(id, hit._score);
      textScoreMap.set(id, Math.round(Math.min(1, hit._score / maxScore) * 1000) / 1000);
    }
  } catch (err) {
    console.warn(`[CandidateGenerator] Text search failed for ${baseId}:`, err);
  }

  return Date.now() - textStart;
}

/**
 * Merge candidates from CLIP and text sources
 */
function mergeCandiates(
  clipScoreMap: Map<string, number>,
  textScoreMap: Map<string, number>
): {
  allIds: Set<string>;
  sourceMap: Map<string, CandidateSource>;
  metaClipCount: number;
  metaTextCount: number;
  metaMergedTotal: number;
} {
  const clipIds = new Set(clipScoreMap.keys());
  const textIds = new Set(textScoreMap.keys());
  const allIds = new Set([...clipIds, ...textIds]);

  const sourceMap = new Map<string, CandidateSource>();
  for (const id of allIds) {
    const inClip = clipIds.has(id);
    const inText = textIds.has(id);
    if (inClip && inText) sourceMap.set(id, "both");
    else if (inClip) sourceMap.set(id, "clip");
    else sourceMap.set(id, "text");
  }

  return {
    allIds,
    sourceMap,
    metaClipCount: clipIds.size,
    metaTextCount: textIds.size,
    metaMergedTotal: allIds.size,
  };
}

/**
 * Rank candidates by combined CLIP + text score
 */
function rankCandidatesByScore(
  allIds: Set<string>,
  clipScoreMap: Map<string, number>,
  textScoreMap: Map<string, number>,
  limit: number
): string[] {
  return Array.from(allIds)
    .map((id) => ({
      id,
      score:
        (clipScoreMap.get(id) ?? 0) * CLIP_WEIGHT + (textScoreMap.get(id) ?? 0) * TEXT_WEIGHT,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(limit * 3, 150)) // Take extra buffer for pHash filtering
    .map((x) => x.id);
}

/**
 * Filter candidates by pHash similarity
 */
async function filterByPHash(
  rankedIds: string[],
  basePHash: string | null,
  usePHashDedup: boolean,
  pHashThreshold: number
): Promise<{
  filteredIds: string[];
  pHashDistMap: Map<string, number>;
  pHashFiltered: number;
}> {
  let pHashDistMap = new Map<string, number>();
  let filteredIds = rankedIds;
  let pHashFiltered = 0;

  if (rankedIds.length > 0 && basePHash) {
    // Fetch pHash for top candidates only (much smaller set)
    const candidateNumericIds = rankedIds.map((id) => parseInt(id, 10));
    try {
      const pHashRes = await pg.query(
        `SELECT id, p_hash FROM products WHERE id = ANY($1) AND p_hash IS NOT NULL`,
        [candidateNumericIds]
      );

      for (const row of pHashRes.rows) {
        const dist = hammingDistance(basePHash, row.p_hash);
        pHashDistMap.set(String(row.id), dist);
      }

      // Filter out near-duplicates if enabled
      if (usePHashDedup) {
        const beforeCount = filteredIds.length;
        filteredIds = filteredIds.filter((id) => {
          const dist = pHashDistMap.get(id);
          // Keep if no pHash or distance > threshold (not a duplicate)
          return dist === undefined || dist > pHashThreshold;
        });
        pHashFiltered = beforeCount - filteredIds.length;
      }
    } catch (err) {
      console.warn(`[CandidateGenerator] pHash lookup failed:`, err);
    }
  }

  return { filteredIds, pHashDistMap, pHashFiltered };
}

/**
 * Build candidate result objects with product data
 */
async function buildCandidateResults(
  finalIds: string[],
  clipScoreMap: Map<string, number>,
  textScoreMap: Map<string, number>,
  textRawMap: Map<string, number>,
  pHashDistMap: Map<string, number>,
  sourceMap: Map<string, CandidateSource>
): Promise<CandidateResult[]> {
  const products = await getProductsByIdsOrdered(finalIds);
  const numericIds = finalIds.map((id) => parseInt(id, 10));
  const imagesByProduct = await getImagesForProducts(numericIds);

  return products.map((p: any) => {
    const id = String(p.id);
    const images = imagesByProduct.get(parseInt(p.id, 10)) || [];

    const clipSim = clipScoreMap.get(id) ?? 0;
    const textSim = textScoreMap.get(id) ?? 0;
    const opensearchScore = textRawMap.get(id) ?? 0;
    const pHashDist = pHashDistMap.get(id);
    const source = sourceMap.get(id) ?? "text";

    const product: ProductResult = {
      ...p,
      images: images.map((img) => ({ id: img.id, url: img.cdn_url, is_primary: img.is_primary })),
      clipSim,
      textSim,
      openSearchScore: opensearchScore,
      pHashDist,
      match_type: source === "both" ? "exact" : "similar",
    };

    return {
      candidateId: id,
      clipSim,
      textSim,
      opensearchScore,
      pHashDist,
      source,
      product,
    };
  });
}

/**
 * Sort candidates: both > clip > text, then by combined score
 */
function sortCandidates(candidates: CandidateResult[]): void {
  const sourceOrder = { both: 0, clip: 1, text: 2 };

  candidates.sort((a, b) => {
    const srcDiff = sourceOrder[a.source] - sourceOrder[b.source];
    if (srcDiff !== 0) return srcDiff;
    const scoreA = a.clipSim * CLIP_WEIGHT + a.textSim * TEXT_WEIGHT;
    const scoreB = b.clipSim * CLIP_WEIGHT + b.textSim * TEXT_WEIGHT;
    return scoreB - scoreA;
  });
}

/**
 * Log performance metrics
 */
function logPerformance(
  baseProductId: string,
  clipCount: number,
  textCount: number,
  mergedTotal: number,
  pHashFiltered: number,
  finalCount: number,
  clipMs: number,
  textMs: number,
  pHashMs: number,
  totalMs: number
): void {
  if (process.env.NODE_ENV !== "production" || totalMs > 1000) {
    console.log(
      `[CandidateGenerator] baseProductId=${baseProductId} ` +
        `clip=${clipCount} text=${textCount} merged=${mergedTotal} ` +
        `pHashFiltered=${pHashFiltered} final=${finalCount} ` +
        `timings: clip=${clipMs}ms text=${textMs}ms pHash=${pHashMs}ms total=${totalMs}ms`
    );
  }
}
