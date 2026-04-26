/**
 * OpenSearch Client & Index Management
 * 
 * Manages OpenSearch connection and index configuration.
 * 
 * EMBEDDING_DIM is derived from the same env var (EXPECTED_EMBEDDING_DIM)
 * that clip.ts validates against, ensuring model ↔ index consistency.
 */
import { Client } from "@opensearch-project/opensearch";
import { config } from "../../config";

/**
 * Extract auth from URL if separate username/password are not provided.
 * Aiven connection strings embed creds: https://user:pass@host:port
 */
function buildOsClientConfig() {
  const nodeUrl = config.opensearch.node;
  let username = config.opensearch.username;
  let password = config.opensearch.password;

  if (!username || !password) {
    try {
      const parsed = new URL(nodeUrl);
      if (parsed.username && parsed.password) {
        username = decodeURIComponent(parsed.username);
        password = decodeURIComponent(parsed.password);
      }
    } catch {
      // URL parsing failed — proceed without extracted creds
    }
  }

  console.log("OS config:", nodeUrl, username, password?.length);

  return {
    node: nodeUrl,
    ...(username && password ? { auth: { username, password } } : {}),
    ssl: { rejectUnauthorized: false },
    maxRetries: 5,
    requestTimeout: 60000,
  };
}

export const osClient = new Client(buildOsClientConfig());

/**
 * Single source of truth for embedding dimension.
 * Shared with clip.ts via the EXPECTED_EMBEDDING_DIM env var.
 * Defaults to 512 (CLIP ViT-B/32).
 */
const EMBEDDING_DIM = parseInt(process.env.EXPECTED_EMBEDDING_DIM || "512", 10);

/**
 * Ensure the products index exists with proper mapping
 */
export async function ensureIndex() {
  const index = config.opensearch.index;
  const exists = await osClient.indices.exists({ index });
  if (!exists.body) {
    await osClient.indices.create({
      index,
      body: {
        settings: {
          index: {
            knn: true,
            "knn.algo_param.ef_search": 64,
          },
          analysis: {
            analyzer: {
              product_analyzer: {
                type: "custom",
                tokenizer: "standard",
                filter: ["lowercase", "product_stemmer", "product_synonyms"],
              },
            },
            filter: {
              product_stemmer: {
                type: "stemmer",
                language: "light_english",
              },
              product_synonyms: {
                type: "synonym",
                synonyms: [
                  "pant,pants,trousers",
                  "shirt,top,blouse,tee",
                  "dress,gown,frock",
                  "jacket,coat,outerwear",
                  "blazer,blazers,sportcoat",
                  "shoe,shoes,sneaker,sneakers,footwear,boot,boots",
                  "bag,handbag,purse,tote",
                  "jeans,denim",
                  "hoodie,hooded sweatshirt,pullover",
                  "tshirt,t-shirt,tee",
                  "sweater,pullover,jumper,knitwear",
                  "skirt,mini skirt,maxi skirt",
                  "shorts,short pants",
                  "sandal,sandals,flip flops",
                  "heel,heels,pumps,stilettos",
                  "cap,hat,beanie",
                  "scarf,scarves,shawl",
                  "cardigan,knit jacket",
                  "vest,waistcoat,gilet",
                  "legging,leggings,tights",
                ],
              },
            },
          },
        },
        mappings: {
          properties: {
            product_id: { type: "keyword" },
            vendor_id: { type: "keyword" },
            title: {
              type: "text",
              analyzer: "product_analyzer",
              fields: {
                keyword: { type: "keyword", ignore_above: 256 },
                raw: { type: "text", analyzer: "standard" },
              },
            },
            description: {
              type: "text",
              analyzer: "product_analyzer",
            },
            brand: {
              type: "keyword",
              fields: {
                search: { type: "text", analyzer: "standard" },
              },
            },
            category: {
              type: "keyword",
              fields: {
                search: { type: "text", analyzer: "product_analyzer" },
              },
            },
            category_canonical: { type: "keyword" },
            // Canonical product-type tokens used for strict garment matching
            // (e.g. hoodie, joggers). Stored as multi-value keyword.
            product_types: { type: "keyword" },
            price_usd: { type: "float" },
            availability: { type: "keyword" },
            is_hidden: { type: "boolean" },
            canonical_id: { type: "keyword" },
            image_cdn: { type: "keyword" },
            // Extracted attributes (keyword for fast filtering/facets)
            attr_color: { type: "keyword" },
            attr_colors: { type: "keyword" },  // Multi-value
            attr_material: { type: "keyword" },
            attr_materials: { type: "keyword" },  // Multi-value
            attr_fit: { type: "keyword" },
            attr_style: { type: "keyword" },
            attr_gender: { type: "keyword" },
            /** Normalized men | women | unisex from title when detectable */
            audience_gender: { type: "keyword" },
            /** adult | kids | baby | teen */
            age_group: { type: "keyword" },
            attr_pattern: { type: "keyword" },
            attr_sleeve: { type: "keyword" },
            attr_neckline: { type: "keyword" },
            attr_colors_text: { type: "keyword" },
            attr_colors_image: { type: "keyword" },
            attr_color_source: { type: "keyword" },
            color_primary_canonical: { type: "keyword" },
            color_secondary_canonical: { type: "keyword" },
            color_accent_canonical: { type: "keyword" },
            color_palette_canonical: { type: "keyword" },
            color_confidence_primary: { type: "float" },
            color_confidence_text: { type: "float" },
            color_confidence_image: { type: "float" },
            norm_confidence: { type: "float" },
            category_confidence: { type: "float" },
            brand_confidence: { type: "float" },
            type_confidence: { type: "float" },
            // Array of product images
            images: {
              type: "nested",
              properties: {
                url: { type: "keyword" },
                p_hash: { type: "keyword" },
                is_primary: { type: "boolean" },
              },
            },
            last_seen_at: { type: "date" },
            // CLIP image embedding for vector search (primary image).
            // HNSW + FP16 scalar quantization: 2x memory reduction, ~2x SIMD speedup,
            // <0.5% recall loss. m=24 (was 48): still high-recall, ~1.5x faster traversal.
            embedding: {
              type: "knn_vector",
              dimension: EMBEDDING_DIM,
              method: {
                name: "hnsw",
                space_type: "cosinesimil",
                engine: "faiss",
                parameters: {
                  ef_construction: 256,
                  m: 24,
                  encoder: { name: "sq", parameters: { type: "fp16" } },
                },
              },
            },
            /** Vector score semantics for `embedding`: v1 legacy OpenSearch score path, v2 cosine-normalized path. */
            embedding_score_version: { type: "keyword" },
            // Garment ROI CLIP vector — HNSW + FP16 SQ, same rationale as `embedding`.
            embedding_garment: {
              type: "knn_vector",
              dimension: EMBEDDING_DIM,
              method: {
                name: "hnsw",
                space_type: "cosinesimil",
                engine: "faiss",
                parameters: {
                  ef_construction: 128,
                  m: 16,
                  encoder: { name: "sq", parameters: { type: "fp16" } },
                },
              },
            },
            /** Vector score semantics for `embedding_garment`: v1 legacy OpenSearch score path, v2 cosine-normalized path. */
            embedding_garment_score_version: { type: "keyword" },
            // Per-attribute embeddings for multi-vector weighted search.
            // IVF + FP16 SQ: these are reranking signals, not primary retrieval — IVF gives
            // 10-50x faster approximate search vs HNSW with acceptable recall at nprobes=8.
            embedding_color: {
              type: "knn_vector",
              dimension: EMBEDDING_DIM,
              method: {
                name: "ivf",
                space_type: "cosinesimil",
                engine: "faiss",
                parameters: {
                  nlist: 128,
                  nprobes: 8,
                  encoder: { name: "sq", parameters: { type: "fp16" } },
                },
              },
            },
            embedding_texture: {
              type: "knn_vector",
              dimension: EMBEDDING_DIM,
              method: {
                name: "ivf",
                space_type: "cosinesimil",
                engine: "faiss",
                parameters: {
                  nlist: 128,
                  nprobes: 8,
                  encoder: { name: "sq", parameters: { type: "fp16" } },
                },
              },
            },
            embedding_material: {
              type: "knn_vector",
              dimension: EMBEDDING_DIM,
              method: {
                name: "ivf",
                space_type: "cosinesimil",
                engine: "faiss",
                parameters: {
                  nlist: 128,
                  nprobes: 8,
                  encoder: { name: "sq", parameters: { type: "fp16" } },
                },
              },
            },
            embedding_style: {
              type: "knn_vector",
              dimension: EMBEDDING_DIM,
              method: {
                name: "ivf",
                space_type: "cosinesimil",
                engine: "faiss",
                parameters: {
                  nlist: 128,
                  nprobes: 8,
                  encoder: { name: "sq", parameters: { type: "fp16" } },
                },
              },
            },
            embedding_pattern: {
              type: "knn_vector",
              dimension: EMBEDDING_DIM,
              method: {
                name: "ivf",
                space_type: "cosinesimil",
                engine: "faiss",
                parameters: {
                  nlist: 128,
                  nprobes: 8,
                  encoder: { name: "sq", parameters: { type: "fp16" } },
                },
              },
            },
            // ====================================================================
            // PART-LEVEL EMBEDDINGS — IVF + FP16 SQ (same rationale as attributes)
            // ====================================================================
            // Sleeve area of tops/dresses
            embedding_part_sleeve: {
              type: "knn_vector",
              dimension: EMBEDDING_DIM,
              method: {
                name: "ivf",
                space_type: "cosinesimil",
                engine: "faiss",
                parameters: { nlist: 128, nprobes: 8, encoder: { name: "sq", parameters: { type: "fp16" } } },
              },
            },
            // Neckline area of tops
            embedding_part_neckline: {
              type: "knn_vector",
              dimension: EMBEDDING_DIM,
              method: {
                name: "ivf",
                space_type: "cosinesimil",
                engine: "faiss",
                parameters: { nlist: 128, nprobes: 8, encoder: { name: "sq", parameters: { type: "fp16" } } },
              },
            },
            // Hem/bottom edge of garments
            embedding_part_hem: {
              type: "knn_vector",
              dimension: EMBEDDING_DIM,
              method: {
                name: "ivf",
                space_type: "cosinesimil",
                engine: "faiss",
                parameters: { nlist: 128, nprobes: 8, encoder: { name: "sq", parameters: { type: "fp16" } } },
              },
            },
            // Waistline area of pants/skirts
            embedding_part_waistline: {
              type: "knn_vector",
              dimension: EMBEDDING_DIM,
              method: {
                name: "ivf",
                space_type: "cosinesimil",
                engine: "faiss",
                parameters: { nlist: 128, nprobes: 8, encoder: { name: "sq", parameters: { type: "fp16" } } },
              },
            },
            // Heel area of shoes
            embedding_part_heel: {
              type: "knn_vector",
              dimension: EMBEDDING_DIM,
              method: {
                name: "ivf",
                space_type: "cosinesimil",
                engine: "faiss",
                parameters: { nlist: 128, nprobes: 8, encoder: { name: "sq", parameters: { type: "fp16" } } },
              },
            },
            // Toe area of shoes
            embedding_part_toe: {
              type: "knn_vector",
              dimension: EMBEDDING_DIM,
              method: {
                name: "ivf",
                space_type: "cosinesimil",
                engine: "faiss",
                parameters: { nlist: 128, nprobes: 8, encoder: { name: "sq", parameters: { type: "fp16" } } },
              },
            },
            // Handle area of bags
            embedding_part_bag_handle: {
              type: "knn_vector",
              dimension: EMBEDDING_DIM,
              method: {
                name: "ivf",
                space_type: "cosinesimil",
                engine: "faiss",
                parameters: { nlist: 128, nprobes: 8, encoder: { name: "sq", parameters: { type: "fp16" } } },
              },
            },
            // Main body area of bags
            embedding_part_bag_body: {
              type: "knn_vector",
              dimension: EMBEDDING_DIM,
              method: {
                name: "ivf",
                space_type: "cosinesimil",
                engine: "faiss",
                parameters: { nlist: 128, nprobes: 8, encoder: { name: "sq", parameters: { type: "fp16" } } },
              },
            },
            // Pattern/texture patch for detailed matching
            embedding_part_pattern_patch: {
              type: "knn_vector",
              dimension: EMBEDDING_DIM,
              method: {
                name: "ivf",
                space_type: "cosinesimil",
                engine: "faiss",
                parameters: { nlist: 128, nprobes: 8, encoder: { name: "sq", parameters: { type: "fp16" } } },
              },
            },
          },
        },
      },
    });
    console.log(`Created OpenSearch index: ${index}`);
  }
}

/**
 * Apply ef_search and other live-tunable kNN settings to the existing index.
 * Safe to run against a live index — no reindex required.
 * Run this once after deploying to fix the ef_search=1024 bottleneck on existing indexes.
 */
export async function applyIndexSpeedSettings(): Promise<void> {
  const index = config.opensearch.index;

  try {
    const before = await osClient.indices.getSettings({ index });
    const idxSettings = before.body?.[index]?.settings?.index ?? {};
    // OpenSearch may return settings as flat dot-notation keys or nested objects
    const cur = idxSettings?.knn?.algo_param?.ef_search
      ?? idxSettings?.["knn.algo_param.ef_search"];
    console.log(`[opensearch] ef_search on ${index} before apply: ${cur ?? "unknown"}`);
  } catch {
    // non-fatal read — proceed with write
  }

  await osClient.indices.putSettings({
    index,
    body: { "index.knn.algo_param.ef_search": 64 },
  });

  try {
    const after = await osClient.indices.getSettings({ index });
    const afterIdxSettings = after.body?.[index]?.settings?.index ?? {};
    const applied = afterIdxSettings?.knn?.algo_param?.ef_search
      ?? afterIdxSettings?.["knn.algo_param.ef_search"];
    console.log(`[opensearch] ef_search on ${index} after apply: ${applied ?? "unknown — verify manually"}`);
    if (String(applied) !== "64") {
      console.warn(`[opensearch] WARNING: ef_search may not have applied — got ${applied}, expected 64`);
    }
  } catch {
    console.warn(`[opensearch] Could not verify ef_search was applied to ${index}`);
  }
}

/**
 * Delete and recreate the index (use with caution)
 */
export async function recreateIndex(): Promise<void> {
  const index = config.opensearch.index;
  const exists = await osClient.indices.exists({ index });
  if (exists.body) {
    await osClient.indices.delete({ index });
    console.log(`Deleted OpenSearch index: ${index}`);
  }
  await ensureIndex();
}

/**
 * Get index stats
 */
export async function getIndexStats(): Promise<{
  docCount: number;
  sizeBytes: number;
}> {
  const index = config.opensearch.index;
  const stats = await osClient.indices.stats({ index });
  return {
    docCount: stats.body._all.primaries.docs.count,
    sizeBytes: stats.body._all.primaries.store.size_in_bytes,
  };
}
