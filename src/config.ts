import fs from "fs";
import path from "path";
import dotenv from "dotenv";

/**
 * Load an env file only when it exists.
 *
 * Local testing:
 * - create `.env.local` and set `NODE_ENV=local` (or `ENV_FILE=.env.local`)
 *
 * Cloud deploy:
 * - Cloud Run injects environment variables directly, usually no `.env.*` file exists
 * - we avoid failing the server if the file isn't present
 */
function loadDotEnv(): void {
  const envFile =
    process.env.ENV_FILE ||
    (process.env.NODE_ENV ? `.env.${process.env.NODE_ENV}` : "");

  const candidates: string[] = [];
  if (envFile) candidates.push(envFile);
  candidates.push(".env");

  for (const candidate of candidates) {
    const resolved = path.resolve(process.cwd(), candidate);
    if (fs.existsSync(resolved)) {
      dotenv.config({ path: resolved, override: false });
      return;
    }
  }
}

loadDotEnv();

function finiteEnvNumber(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined || String(raw).trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function getRedisConfig() {
  return {
    restUrl: process.env.UPSTASH_REDIS_REST_URL || "",
    restToken: process.env.UPSTASH_REDIS_REST_TOKEN || "",
  };
}

export const config = {
  port: Number(process.env.PORT || 4000),
  corsOrigin: process.env.CORS_ORIGIN || "*",
  // used for local data just for testing 
  // postgres: {
  //   host: process.env.PG_HOST || "0.0.0.0",
  //   port: Number(process.env.PG_PORT || 4444),//note 5432
  //   user: process.env.PG_USER || "postgres",
  //   password: process.env.PG_PASSWORD || "postgres",
  //   database: process.env.PG_DATABASE || "fashion",
  // },

  // Supabase
    supabase: {
    url: process.env.SUPABASE_URL!,
    anonKey: process.env.SUPABASE_ANON_KEY || "",
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    storageBucket: process.env.SUPABASE_STORAGE_BUCKET || "product-images",
  },
  // Supabase Postgres
  database: {
    url: process.env.DATABASE_URL!,
    ssl: { rejectUnauthorized: false },
  },

  opensearch: {
    node: process.env.OS_NODE || "https://avnadmin:AVNS_seqtyHr-NLC1nO4M5Yt@os-270aa11c-lau-6d81.j.aivencloud.com:12588",
    index: process.env.OS_INDEX || "products",
    username: process.env.OS_USERNAME || "",
    password: process.env.OS_PASSWORD || "",
  },
  redis: getRedisConfig(),
  r2: {
    accountId: process.env.R2_ACCOUNT_ID || "",
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
    bucket: process.env.R2_BUCKET || "fashion-images",
    publicBaseUrl: process.env.R2_PUBLIC_BASE_URL || "",
  },
  clip: {
    // Model type: "fashion-clip" (recommended) | "vit-l-14" | "vit-b-32"
    // Fashion-CLIP is fine-tuned for apparel and captures fabric textures, styles better
    modelType: process.env.CLIP_MODEL_TYPE || "fashion-clip",
    // Similarity thresholds (image kNN + text hybrid min_score caps); text gate default aligns with SEARCH_FINAL_ACCEPT_MIN_TEXT
    similarityThreshold: Number(process.env.CLIP_SIMILARITY_THRESHOLD || 0.6),
    /** Image-only kNN gate; stricter default so loose "fashion similar" matches are dropped. */
    imageSimilarityThreshold: finiteEnvNumber(
      process.env.CLIP_IMAGE_SIMILARITY_THRESHOLD,
      0.72,
      0.35,
      0.95,
    ),
    duplicateThreshold: Number(process.env.CLIP_DUPLICATE_THRESHOLD || 0.92),
    /**
     * `match_type: "exact"` when normalized similarity ≥ this (image + text hybrid UI).
     * Fashion CLIP scores rarely reach 0.8 unless near-duplicates; tune with prod p85.
     */
    matchTypeExactMin: finiteEnvNumber(
      process.env.CLIP_MATCH_TYPE_EXACT_MIN,
      0.68,
      0.5,
      0.95,
    ),
  },
  search: {
    /** OpenSearch candidates before rerank (tune with SEARCH_RECALL_WINDOW). */
    recallWindow: finiteEnvNumber(process.env.SEARCH_RECALL_WINDOW, 500, 50, 2000),
    recallMax: finiteEnvNumber(process.env.SEARCH_RECALL_MAX, 600, 100, 2000),
    /** Text acceptance gate (defaults to legacy SEARCH_FINAL_ACCEPT_MIN when set). */
    finalAcceptMinText: finiteEnvNumber(
      process.env.SEARCH_FINAL_ACCEPT_MIN_TEXT ?? process.env.SEARCH_FINAL_ACCEPT_MIN,
      0.6,
      0.35,
      0.95,
    ),
    /** Image / vision acceptance gate — products below this `finalRelevance01` are omitted. */
    finalAcceptMinImage: finiteEnvNumber(
      process.env.SEARCH_FINAL_ACCEPT_MIN_IMAGE,
      0.6,
      0.3,
      0.95,
    ),
    /** Backward-compat alias used by older call sites; maps to text gate. */
    finalAcceptMin: finiteEnvNumber(
      process.env.SEARCH_FINAL_ACCEPT_MIN_TEXT ?? process.env.SEARCH_FINAL_ACCEPT_MIN,
      0.6,
      0.35,
      0.95,
    ),
    filterHardMinConfidence: finiteEnvNumber(process.env.SEARCH_FILTER_HARD_MIN_CONFIDENCE, 0.55, 0.35, 0.95),
    domainEmbeddingRejectBelow: finiteEnvNumber(process.env.SEARCH_DOMAIN_EMBEDDING_REJECT_BELOW, 0.3, 0.15, 0.55),
    /** max = divide by top hit score (default); tanh = Math.tanh(raw/scale) for calibration across queries */
    similarityNormalize:
      String(process.env.SEARCH_SIMILARITY_NORMALIZE ?? "max").toLowerCase() === "tanh"
        ? ("tanh" as const)
        : ("max" as const),
    similarityTanhScale: finiteEnvNumber(process.env.SEARCH_SIMILARITY_TANH_SCALE, 10, 1, 50),
    /** hard = drop hits below text gate (SEARCH_FINAL_ACCEPT_MIN_TEXT); soft = keep reranked order, no min gate */
    relevanceGateMode:
      String(process.env.SEARCH_RELEVANCE_GATE_MODE ?? "soft").toLowerCase() === "soft"
        ? ("soft" as const)
        : ("hard" as const),
    /**
     * In `soft` mode, we still want to avoid extremely low `finalRelevance01`
     * products. If there are any candidates above this floor, prefer them;
     * otherwise fall back to the full candidate set to avoid returning zero results.
     */
    softFinalRelevanceFloorMin: finiteEnvNumber(
      process.env.SEARCH_SOFT_FINAL_RELEVANCE_FLOOR_MIN,
      0.03,
      0,
      1,
    ),
    /**
     * With SEARCH_USE_XGB_RANKER: score a recall prefix before pagination (default on).
     * Set SEARCH_XGB_RERANK_FULL_RECALL=false for legacy page-only tie-break (after slice).
     */
    xgbRerankFullRecall: (() => {
      const v = String(process.env.SEARCH_XGB_RERANK_FULL_RECALL ?? "").toLowerCase().trim();
      if (v === "0" || v === "false" || v === "off" || v === "no") return false;
      return true;
    })(),
    /** Hard cap on XGB batch size; head window is at least max(this, offset+limit) when full-recall is on. */
    xgbFullRecallMax: finiteEnvNumber(process.env.SEARCH_XGB_FULL_RECALL_MAX, 500, 20, 2000),
    /**
     * pHash Hamming max for treating two primary images as near-duplicates (lower = keep more distinct listings).
     * SEARCH_DEDUPE_IMAGE_HAMMING_MAX (default 7; was 10).
     */
    dedupeImageHammingMax: finiteEnvNumber(process.env.SEARCH_DEDUPE_IMAGE_HAMMING_MAX, 7, 4, 14),
    /** Key segment for QueryAST Redis cache (future: per-request locale). */
    queryAstCacheLocale: process.env.SEARCH_QUERY_AST_LOCALE?.trim() || "default",
    /** TTL for SEARCH_QUERY_AST_REDIS serialized AST (seconds). */
    queryAstRedisTtlSec: finiteEnvNumber(process.env.SEARCH_QUERY_AST_REDIS_TTL_SEC, 600, 60, 3600),
    /**
     * When SEARCH_KNN_TEXT_IN_MUST would place kNN in must, demote to should-boost if fashion
     * embedding score vs prototype is below threshold (proactive zero-hit avoidance).
     */
    knnDemoteLowFashionEmb: (() => {
      const v = String(process.env.SEARCH_KNN_DEMOTE_LOW_FASHION_EMB ?? "").toLowerCase().trim();
      return v === "1" || v === "true";
    })(),
    knnDemoteFashionEmbMax: finiteEnvNumber(process.env.SEARCH_KNN_DEMOTE_FASHION_EMB_MAX, 0.52, 0.35, 0.65),
    /** Hard gender filter also matches unisex audience fields (default on). */
    genderUnisexOr: (() => {
      const v = String(process.env.SEARCH_GENDER_UNISEX_OR ?? "1").toLowerCase().trim();
      return v !== "0" && v !== "false" && v !== "off" && v !== "no";
    })(),
    /**
     * When true (or client sends ?rankingDebug=1), product search responses include `meta.ranking_debug`
     * and per-item `explain` / `finalRelevance01` remain populated for staging analysis.
     */
    searchRankingDebug: (() => {
      const v = String(process.env.SEARCH_RANKING_DEBUG ?? "").toLowerCase().trim();
      return v === "1" || v === "true";
    })(),
    /** Lower bound for image kNN relax paths; must match products.service `imageRelaxSimilarityFloor`. */
    searchImageRelaxFloor: finiteEnvNumber(process.env.SEARCH_IMAGE_RELAX_FLOOR, 0.66, 0.35, 0.92),
    /** Cap BLIP caption wait for POST /products/search/image (ms). */
    blipCaptionTimeoutMs: finiteEnvNumber(process.env.SEARCH_BLIP_CAPTION_TIMEOUT_MS, 900, 200, 8000),
  },
  tryon: {
    // Google Cloud Vertex AI — Virtual Try-On (publishers/google/models/...:predict)
    // https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/virtual-try-on-api
    project: process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "",
    location: process.env.TRYON_LOCATION || "us-central1",
    model: process.env.TRYON_MODEL || "virtual-try-on-001",
    timeout: Number(process.env.TRYON_TIMEOUT || 60000),
    /** Quality vs latency; must be > 0 (Google default 32) */
    baseSteps: Math.max(1, Number(process.env.TRYON_BASE_STEPS || 32)),
    addWatermark: process.env.TRYON_ADD_WATERMARK?.trim().toLowerCase() !== "false",
    personGeneration:
      (process.env.TRYON_PERSON_GENERATION as "dont_allow" | "allow_adult" | "allow_all") ||
      "allow_adult",
    safetySetting:
      (process.env.TRYON_SAFETY_SETTING as
        | "block_low_and_above"
        | "block_medium_and_above"
        | "block_only_high"
        | "block_none") || "block_medium_and_above",
    /** Optional gs://bucket/prefix — when set, API may write outputs there (see Google docs) */
    storageUri: process.env.TRYON_STORAGE_URI?.trim() || "",
    /** e.g. image/png or image/jpeg; empty = API default */
    outputMimeType: process.env.TRYON_OUTPUT_MIME?.trim() || "",
  },
  jwt: {
    secret: process.env.JWT_SECRET || "change-me-in-production",
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m",
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d",
  },
};
