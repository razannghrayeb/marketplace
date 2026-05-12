import { osClient } from "../core/opensearch";
import { processImageForEmbedding, computeAndGenerateQueryPartEmbeddings, extractGarmentCenterCropBuffer } from "../image/processor";
import { attributeEmbeddings } from "./attributeEmbeddings";
import { cosineSimilarity01 } from "../image/clip";
import { config } from "../../config";

type AltPipelineOptions = {
  candidateK?: number;
  visualThreshold?: number; // 0..1
  size?: number;
};

/**
 * Alternative image search pipeline for A/B testing.
 * - computes global embedding first
 * - retrieves nearest products by global embedding
 * - if top match is visually similar enough, computes attribute+part embeddings
 * - fetches doc-side attribute vectors for the candidate set and reranks
 */
export async function altImageSearch(
  imageBuffer: Buffer,
  opts: AltPipelineOptions = {},
): Promise<{ productId: string; visualSim: number; attrSims?: Record<string, number>; finalScore: number; rawHit?: any }[]> {
  const candidateK = Number(opts.candidateK ?? Number(process.env.ALT_PIPELINE_CANDIDATE_K ?? 300));
  const size = Number(opts.size ?? 20);
  const visualThreshold = Number(opts.visualThreshold ?? Number(process.env.ALT_PIPELINE_SIMILARITY_THRESHOLD ?? 0.82));

  // 1) Preprocess + global embedding
  const bufForClip = await extractGarmentCenterCropBuffer(imageBuffer).catch(() => imageBuffer);
  const globalEmbed = await processImageForEmbedding(bufForClip);

  // 2) Global kNN retrieval (OpenSearch)
  const knnField = process.env.ALT_PIPELINE_GLOBAL_KNN_FIELD || "embedding";
  const osResp = await osClient.search({
    index: config.opensearch.index,
    body: {
      size: candidateK,
      query: {
        bool: {
          must: [
            { knn: { [knnField]: { vector: globalEmbed, k: candidateK } } },
          ],
        },
      },
      _source: ["product_id", "embedding", "embedding_color", "embedding_style", "embedding_pattern", "embedding_texture", "embedding_material"],
    },
  });

  const hits: any[] = osResp.body?.hits?.hits ?? [];
  if (hits.length === 0) return [];

  // 3) Compute visual similarity (cosine on stored embedding when available)
  const scored = hits.map((h: any) => {
    const pid = String(h._source?.product_id ?? h._id ?? "");
    const docEmb: number[] | undefined = Array.isArray(h._source?.embedding) ? h._source.embedding : undefined;
    const visualSim = docEmb ? Math.max(0, Math.min(1, cosineSimilarity01(globalEmbed, docEmb))) : (typeof h._score === "number" ? Math.max(0, Math.min(1, h._score)) : 0);
    return { hit: h, productId: pid, visualSim };
  });

  // Sort by visualSim desc
  scored.sort((a, b) => b.visualSim - a.visualSim);

  // If top similarity below threshold, return global-ranked set (no attributes)
  const topVisual = scored[0]?.visualSim ?? 0;
  if (topVisual < visualThreshold) {
    return scored.slice(0, size).map((s) => ({ productId: s.productId, visualSim: s.visualSim, finalScore: s.visualSim, rawHit: s.hit }));
  }

  // Determine candidate pool for attribute refinement (configurable)
  const candidatePool = Number(process.env.ALT_PIPELINE_ATTRIBUTE_CANDIDATE_POOL ?? Math.max(size * 5, 100));
  const candidateIds = scored.slice(0, candidatePool).map((s) => String(s.productId)).filter(Boolean);

  // 4) Compute attribute embeddings in parallel (essential ones) AFTER we know the candidate pool
  const attrNames = ["color", "style", "pattern"] as const;
  const attrPromises = attrNames.map((a) => attributeEmbeddings.generateImageAttributeEmbedding(imageBuffer, a).catch(() => [] as number[]));
  const [colorQ, styleQ, patternQ] = await Promise.all(attrPromises) as number[][];

  // 5) Compute part embeddings (may be empty)
  const partEmbeddings = await computeAndGenerateQueryPartEmbeddings(imageBuffer).catch(() => ({} as Record<string, number[]>));
  const uniqueIds = [...new Set(candidateIds)];

  const mgetResp = await (osClient as any).mget({ index: config.opensearch.index, body: { ids: uniqueIds }, _source: ["embedding_color", "embedding_style", "embedding_pattern", "embedding_texture", "embedding_material"] });
  const docs = mgetResp.body?.docs ?? [];
  const docMap = new Map<string, any>();
  for (const d of docs) if (d?.found) docMap.set(String(d._id), d._source || {});

  // 7) Compute per-candidate attribute similarities and final score
  const wVisual = Number(process.env.ALT_PIPELINE_VISUAL_WEIGHT ?? 0.6);
  const rawWColor = Number(process.env.SEARCH_IMAGE_RERANK_COLOR_WEIGHT ?? 220);
  const rawWStyle = Number(process.env.SEARCH_IMAGE_RERANK_STYLE_WEIGHT ?? 60);
  const rawWPattern = Number(process.env.SEARCH_IMAGE_RERANK_PATTERN_WEIGHT ?? 40);
  const rawSum = rawWColor + rawWStyle + rawWPattern;
  const wColor = rawSum > 0 ? rawWColor / rawSum : 1 / 3;
  const wStyle = rawSum > 0 ? rawWStyle / rawSum : 1 / 3;
  const wPattern = rawSum > 0 ? rawWPattern / rawSum : 1 / 3;

  const out = scored.slice(0, Math.min(uniqueIds.length, candidateK)).map((s) => {
    const pid = s.productId;
    const src = docMap.get(pid) ?? s.hit._source ?? {};
    const colorDoc = Array.isArray(src.embedding_color) ? src.embedding_color : undefined;
    const styleDoc = Array.isArray(src.embedding_style) ? src.embedding_style : undefined;
    const patternDoc = Array.isArray(src.embedding_pattern) ? src.embedding_pattern : undefined;

    const colorSim = colorDoc && colorQ && colorQ.length > 0 ? Math.max(0, Math.min(1, cosineSimilarity01(colorQ, colorDoc))) : 0;
    const styleSim = styleDoc && styleQ && styleQ.length > 0 ? Math.max(0, Math.min(1, cosineSimilarity01(styleQ, styleDoc))) : 0;
    const patternSim = patternDoc && patternQ && patternQ.length > 0 ? Math.max(0, Math.min(1, cosineSimilarity01(patternQ, patternDoc))) : 0;

    const attrScore = wColor * colorSim + wStyle * styleSim + wPattern * patternSim;
    const finalScore = Math.max(0, Math.min(1, wVisual * s.visualSim + (1 - wVisual) * attrScore));

    return {
      productId: pid,
      visualSim: s.visualSim,
      attrSims: { color: colorSim, style: styleSim, pattern: patternSim },
      finalScore,
      rawHit: s.hit,
    };
  });

  // 8) Return top N by finalScore
  out.sort((a, b) => b.finalScore - a.finalScore);
  return out.slice(0, size);
}

export default altImageSearch;
