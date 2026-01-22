

export const config = {
  port: Number(process.env.PORT || 4000),
  corsOrigin: process.env.CORS_ORIGIN || "*",
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
    node: process.env.OS_NODE || "http://localhost:9200",
    index: process.env.OS_INDEX || "products",
    username: process.env.OS_USERNAME || "",
    password: process.env.OS_PASSWORD || "",
  },
  redis: {
    url: process.env.REDIS_URL || "redis://localhost:6379",
    host: process.env.REDIS_HOST || "localhost",
    port: Number(process.env.REDIS_PORT || 6379),
    password: process.env.REDIS_PASSWORD || undefined,
  },
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
};
