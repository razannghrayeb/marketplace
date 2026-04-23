/**
 * Feature-flagged search evaluation logging.
 *
 * Enable with SEARCH_EVAL_LOG=1|true|jsonl
 * Optional: SEARCH_EVAL_LOG_FILE=/path/to/eval.jsonl (append one JSON object per line)
 * Optional: SEARCH_EVAL_VARIANT=control|soft_type|... for A/B labeling
 */

import crypto from "crypto";
import fs from "fs";

export type SearchEvalKind = "text_search" | "image_search";

export interface TextSearchEvalPayload {
  kind: "text_search";
  eval_id: string;
  variant: string;
  ts_iso: string;
  raw_query: string;
  took_ms: number;
  open_search_total: number | null;
  result_count: number;
  hit_ids: string[];
  similarity_scores: number[];
  rerank_scores: Array<number | null>;
  /** Per-hit calibrated relevance on the returned page (same order as hit_ids). */
  final_relevance_scores?: Array<number | null>;
  ast: {
    search_query: string;
    product_types: string[];
    categories: string[];
    colors: string[];
    brands: string[];
  };
  flags: {
    hard_ast_category: boolean;
    product_type_dominant?: boolean;
    knn_boost_only?: boolean;
    has_product_type_constraint: boolean;
    relaxed_pipeline: boolean;
    strict_product_type_env: boolean;
    off_domain_blocked?: boolean;
    domain_confidence?: number;
    borderline_fashion?: boolean;
    embedding_fashion_01?: number | null;
    soft_ast_color?: boolean;
    hard_color_filter?: boolean;
    strict_color_type_intent?: boolean;
    expansion_term_count?: number;
    recall_size?: number;
    final_accept_min?: number;
    below_relevance_threshold?: boolean;
    total_above_threshold?: number;
    /** OpenSearch retry / fallback steps applied after the primary bool query. */
    search_retry_trace?: string[];
  };
}

export interface ImageSearchEvalPayload {
  kind: "image_search";
  eval_id: string;
  variant: string;
  ts_iso: string;
  took_ms: number;
  result_count: number;
  hit_ids: string[];
  similarity_scores: number[];
  /** Per-hit calibrated relevance (same order as hit_ids). */
  final_relevance_scores?: Array<number | null>;
  soft_category: boolean;
  predicted_aisles: string[] | null;
  similarity_threshold_used?: number;
  below_relevance_threshold?: boolean;
  /** kNN passed threshold but all hits failed final accept min (image: SEARCH_FINAL_ACCEPT_MIN_IMAGE when hard gate). */
  below_final_relevance_gate?: boolean;
}

export function searchEvalEnabled(): boolean {
  const v = String(process.env.SEARCH_EVAL_LOG ?? "").toLowerCase();
  return v === "1" || v === "true" || v === "json" || v === "jsonl";
}

export function searchEvalVariant(): string {
  return String(process.env.SEARCH_EVAL_VARIANT ?? "default").trim() || "default";
}

export function newSearchEvalId(): string {
  return crypto.randomUUID();
}

function writeEvalLine(line: string): void {
  const file = process.env.SEARCH_EVAL_LOG_FILE?.trim();
  if (file) {
    try {
      fs.appendFileSync(file, line + "\n", "utf8");
    } catch (e) {
      console.warn("[search_eval] append failed:", (e as Error).message);
    }
  }
  console.log("[search_eval] " + line);
}

export function emitTextSearchEval(payload: TextSearchEvalPayload): void {
  if (!searchEvalEnabled()) return;
  writeEvalLine(JSON.stringify(payload));
}

export function emitImageSearchEval(payload: ImageSearchEvalPayload): void {
  if (!searchEvalEnabled()) return;
  writeEvalLine(JSON.stringify(payload));
}
