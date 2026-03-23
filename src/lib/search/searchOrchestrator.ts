/**
 * Single coordinator for end-to-end image retrieval across all entry modes.
 * HTTP controllers parse input only; they delegate here for the full pipeline.
 */

import { validateImage } from "../image";
import { searchImage } from "./fashionSearchFacade";
import {
  multiImageSearch,
  multiVectorWeightedSearch,
  type MultiImageSearchRequest,
} from "../../routes/search/search.service";
import { getImageAnalysisService } from "../../routes/products/image-analysis.service";
import type {
  BaseSearchResponse,
  DetectionGroupResult,
  RankedProductResult,
  SearchDiagnostics,
  SearchRequestContext,
} from "./searchTypes";
import { OPENSEARCH_GLOBAL_EMBEDDING_FIELD } from "./opensearchVectorFields";

function emptyDiagnostics(partial?: Partial<SearchDiagnostics>): SearchDiagnostics {
  return { ...partial };
}

async function validateSearchContext(ctx: SearchRequestContext): Promise<{ error?: string }> {
  if (ctx.mode === "single_image" && ctx.precomputedEmbeddings?.global?.length) {
    const g = ctx.precomputedEmbeddings.global;
    if (!Array.isArray(g) || g.length < 8) {
      return { error: "Invalid precomputedEmbeddings.global" };
    }
    return {};
  }
  if (!ctx.images.length) {
    return { error: "At least one image buffer is required" };
  }
  for (const buf of ctx.images) {
    const v = await validateImage(buf);
    if (!v.valid) {
      return { error: v.error || "Invalid image" };
    }
  }
  return {};
}

/**
 * Unified entry: validates buffers, runs mode-specific pipeline, returns normalized shell.
 */
export async function executeSearch(ctx: SearchRequestContext): Promise<BaseSearchResponse> {
  const start = Date.now();
  const opts = ctx.options ?? {};
  const limit = opts.limit ?? 50;

  const validation = await validateSearchContext(ctx);
  if (validation.error) {
    return {
      mode: ctx.mode,
      total: 0,
      tookMs: Date.now() - start,
      diagnostics: emptyDiagnostics(),
      meta: { error: validation.error },
    };
  }

  switch (ctx.mode) {
    case "single_image": {
      const pre = ctx.precomputedEmbeddings;
      const buf = ctx.images[0];
      const unified = await searchImage({
        imageBuffer: buf,
        imageEmbedding: pre?.global,
        imageEmbeddingGarment: pre?.garment,
        limit,
        includeRelated: opts.includeRelated ?? false,
        filters: ctx.filters as any,
        similarityThreshold: opts.similarityThreshold,
        pHash: opts.pHash,
        predictedCategoryAisles: opts.predictedCategoryAisles,
        knnField: opts.knnField,
        forceHardCategoryFilter: opts.forceHardCategoryFilter,
        relaxThresholdWhenEmpty: opts.relaxThresholdWhenEmpty ?? true,
      });
      const results = (unified.results ?? []) as unknown as RankedProductResult[];
      return {
        mode: "single_image",
        results,
        total: unified.total ?? results.length,
        tookMs: Date.now() - start,
        diagnostics: emptyDiagnostics({
          embeddingsUsed: [OPENSEARCH_GLOBAL_EMBEDDING_FIELD],
        }),
        meta: unified.meta,
        related: unified.related,
      };
    }

    case "multi_image": {
      const prompt = ctx.prompt?.trim() || "";
      if (!prompt) {
        return {
          mode: "multi_image",
          total: 0,
          tookMs: Date.now() - start,
          diagnostics: emptyDiagnostics({ intentFallback: true }),
          meta: { error: "prompt required" },
        };
      }
      const req: MultiImageSearchRequest = {
        images: ctx.images,
        userPrompt: prompt,
        limit,
        rerankWeights: opts.rerankWeights as any,
      };
      const out = await multiImageSearch(req);
      return {
        mode: "multi_image",
        results: (out.results ?? []) as RankedProductResult[],
        total: out.total ?? 0,
        tookMs: Date.now() - start,
        explanation: out.explanation,
        compositeQuery: out.compositeQuery,
        diagnostics: emptyDiagnostics({
          attributesUsed: extractAttrHints(out.compositeQuery),
          geminiDegraded: Boolean((out.meta as Record<string, unknown> | undefined)?.gemini_degraded),
          searchResultCacheHit: Boolean(
            (out.meta as Record<string, unknown> | undefined)?.search_result_cache_hit,
          ),
        }),
        meta: out.meta,
      };
    }

    case "multi_vector": {
      const prompt = ctx.prompt?.trim() ?? "";
      if (!prompt && (!ctx.attributeWeights || Object.keys(ctx.attributeWeights).length === 0)) {
        return {
          mode: "multi_vector",
          total: 0,
          tookMs: Date.now() - start,
          diagnostics: emptyDiagnostics(),
          meta: { error: "prompt or attributeWeights required" },
        };
      }
      const out = await multiVectorWeightedSearch({
        images: ctx.images,
        userPrompt: prompt || "multi-vector",
        limit,
        attributeWeights: ctx.attributeWeights,
        explainScores: opts.explainScores,
        rerankWeights: opts.rerankWeights as any,
        useExplicitAttributeWeightsOnly: Boolean(
          ctx.attributeWeights && Object.keys(ctx.attributeWeights).length > 0,
        ),
      });
      return {
        mode: "multi_vector",
        results: (out.results ?? []) as unknown as RankedProductResult[],
        total: out.total ?? 0,
        tookMs: Date.now() - start,
        diagnostics: emptyDiagnostics({
          embeddingsUsed: Object.keys(ctx.attributeWeights ?? {}),
          geminiDegraded: Boolean(out.meta?.gemini_degraded),
          searchResultCacheHit: Boolean(
            (out.meta as { search_result_cache_hit?: boolean } | undefined)?.search_result_cache_hit,
          ),
        }),
        meta: out.meta,
      };
    }

    case "detected_items": {
      const svc = getImageAnalysisService();
      const filename = opts.originalFilename ?? "orchestrator.jpg";
      const baseShop = {
        store: opts.storeImage === true,
        findSimilar: true as const,
        confidence: opts.detectionConfidence ?? 0.25,
        similarityThreshold: opts.similarityThreshold ?? 0.63,
        similarLimitPerItem: opts.limitPerDetection ?? opts.limit ?? 10,
        filterByDetectedCategory: opts.filterByDetectedCategory !== false,
        groupByDetection: opts.groupByDetection !== false,
        includeEmptyDetectionGroups: opts.includeEmptyDetectionGroups === true,
        mainGarmentOnly: opts.mainGarmentOnly === true,
      };

      const raw =
        opts.selective != null
          ? await svc.analyzeWithSelection(ctx.images[0], filename, {
              ...baseShop,
              ...opts.selective,
            })
          : await svc.analyzeAndFindSimilar(ctx.images[0], filename, baseShop);

      const groups: DetectionGroupResult[] = (raw.similarProducts?.byDetection ?? []).map(
        (row: any) => ({
          detection: row.detection,
          category: row.category,
          products: (row.products ?? []) as RankedProductResult[],
          count: row.count,
          detectionIndex: row.detectionIndex,
          source: row.source,
          originalIndex: row.originalIndex,
        }),
      );

      return {
        mode: "detected_items",
        groups,
        total: raw.similarProducts?.totalProducts ?? 0,
        tookMs: Date.now() - start,
        diagnostics: emptyDiagnostics({
          detectionFallback:
            !raw.detection?.items?.length ||
            raw.detection?.items?.some((d: any) => d.label === "full_image"),
        }),
        meta: {
          outfitCoherence: raw.outfitCoherence,
          detection: raw.detection,
          threshold: raw.similarProducts?.threshold,
          shopTheLookStats: raw.similarProducts?.shopTheLookStats,
        },
      };
    }

    default:
      return {
        mode: ctx.mode,
        total: 0,
        tookMs: Date.now() - start,
        diagnostics: emptyDiagnostics(),
        meta: { error: "unknown mode" },
      };
  }
}

function extractAttrHints(composite: unknown): string[] | undefined {
  if (!composite || typeof composite !== "object") return undefined;
  const c = composite as Record<string, unknown>;
  const expl = c.explanation;
  if (typeof expl === "string" && expl.length > 0) return [expl];
  return undefined;
}
