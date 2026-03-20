import fs from "fs";
import path from "path";
import dotenv from "dotenv";

type ServiceRole = "all" | "api" | "ml";

function getServiceRole(): ServiceRole {
  const role = (process.env.SERVICE_ROLE || "all").toLowerCase();
  if (role === "api" || role === "ml" || role === "all") {
    return role;
  }
  return "all";
}

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

function getRedisConfig() {
  return {
    restUrl: process.env.UPSTASH_REDIS_REST_URL || "",
    restToken: process.env.UPSTASH_REDIS_REST_TOKEN || "",
  };
}

export const config = {
  port: Number(process.env.PORT || 4000),
  corsOrigin: process.env.CORS_ORIGIN || "*",
  serviceRole: getServiceRole(),
  mlServiceUrl: process.env.ML_SERVICE_URL || "",
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
    // Similarity thresholds
    similarityThreshold: Number(process.env.CLIP_SIMILARITY_THRESHOLD || 0.7),
    duplicateThreshold: Number(process.env.CLIP_DUPLICATE_THRESHOLD || 0.92),
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
