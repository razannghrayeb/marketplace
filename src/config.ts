import "dotenv/config";

type ServiceRole = "all" | "api" | "ml";

function getServiceRole(): ServiceRole {
  const role = (process.env.SERVICE_ROLE || "all").toLowerCase();
  if (role === "api" || role === "ml" || role === "all") {
    return role;
  }
  return "all";
}

function getRedisConfig() {
  const url = process.env.REDIS_URL || "redis://localhost:6379";
  const parsed = (() => {
    try {
      return new URL(url);
    } catch {
      return null;
    }
  })();

  const hostFromUrl = parsed?.hostname;
  const portFromUrl = parsed?.port ? Number(parsed.port) : undefined;
  const passwordFromUrl = parsed?.password ? decodeURIComponent(parsed.password) : undefined;
  const tlsFromUrl = parsed?.protocol === "rediss:";

  return {
    url,
    host: process.env.REDIS_HOST || hostFromUrl || "localhost",
    port: Number(process.env.REDIS_PORT || portFromUrl || 6379),
    password: process.env.REDIS_PASSWORD || passwordFromUrl || undefined,
    tls: (process.env.REDIS_TLS || "").toLowerCase() === "true" || tlsFromUrl,
  };
}

export const config = {
  port: Number(process.env.PORT || 4000),
  corsOrigin: process.env.CORS_ORIGIN || "*",
  serviceRole: getServiceRole(),
  mlServiceUrl: process.env.ML_SERVICE_URL || "",
  // used for local data just for testing 
  // postgres: {
  //   host: process.env.PG_HOST || "localhost",
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
    
  },

  opensearch: {
    node: process.env.OS_NODE || "http://opensearch-node:9200",
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
    // Google Cloud Vertex AI Virtual Try-On
    // Auth: gcloud auth application-default login  OR  GOOGLE_APPLICATION_CREDENTIALS=/key.json
    project: process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "",
    location: process.env.TRYON_LOCATION || "us-central1",
    model: process.env.TRYON_MODEL || "virtual-try-on@002",
    timeout: Number(process.env.TRYON_TIMEOUT || 60000),
  },
  jwt: {
    secret: process.env.JWT_SECRET || "change-me-in-production",
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m",
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d",
  },
};
