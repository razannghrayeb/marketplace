/**
 * OpenSearch Client & Index Management
 * 
 * Manages OpenSearch connection and index configuration.
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

// CLIP ViT-B/32 embedding dimension
const EMBEDDING_DIM = 512;

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
            "knn.algo_param.ef_search": 256,
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
                  "pant,pants,trousers,bottoms",
                  "shirt,top,blouse,tee",
                  "dress,gown,frock",
                  "jacket,coat,blazer,outerwear",
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
            attr_pattern: { type: "keyword" },
            attr_sleeve: { type: "keyword" },
            attr_neckline: { type: "keyword" },
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
            // CLIP image embedding for vector search (primary image)
            embedding: {
              type: "knn_vector",
              dimension: EMBEDDING_DIM,
              method: {
                name: "hnsw",
                space_type: "cosinesimil",
                engine: "faiss",
                parameters: {
                  ef_construction: 128,
                  m: 16,
                },
              },
            },
            // Per-attribute embeddings for multi-vector weighted search
            embedding_color: {
              type: "knn_vector",
              dimension: EMBEDDING_DIM,
              method: {
                name: "hnsw",
                space_type: "cosinesimil",
                engine: "faiss",
                parameters: {
                  ef_construction: 128,
                  m: 16,
                },
              },
            },
            embedding_texture: {
              type: "knn_vector",
              dimension: EMBEDDING_DIM,
              method: {
                name: "hnsw",
                space_type: "cosinesimil",
                engine: "faiss",
                parameters: {
                  ef_construction: 128,
                  m: 16,
                },
              },
            },
            embedding_material: {
              type: "knn_vector",
              dimension: EMBEDDING_DIM,
              method: {
                name: "hnsw",
                space_type: "cosinesimil",
                engine: "faiss",
                parameters: {
                  ef_construction: 128,
                  m: 16,
                },
              },
            },
            embedding_style: {
              type: "knn_vector",
              dimension: EMBEDDING_DIM,
              method: {
                name: "hnsw",
                space_type: "cosinesimil",
                engine: "faiss",
                parameters: {
                  ef_construction: 128,
                  m: 16,
                },
              },
            },
            embedding_pattern: {
              type: "knn_vector",
              dimension: EMBEDDING_DIM,
              method: {
                name: "hnsw",
                space_type: "cosinesimil",
                engine: "faiss",
                parameters: {
                  ef_construction: 128,
                  m: 16,
                },
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
