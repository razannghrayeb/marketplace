import { Client } from "@opensearch-project/opensearch";
import { config } from "../config";

export const osClient = new Client({
  node: config.opensearch.node,
});

// CLIP ViT-B/32 embedding dimension
const EMBEDDING_DIM = 512;

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
            "knn.algo_param.ef_search": 100,
          },
        },
        mappings: {
          properties: {
            product_id: { type: "keyword" },
            vendor_id: { type: "keyword" },
            title: { type: "text" },
            brand: { type: "keyword" },
            category: { type: "keyword" },
            price_usd: { type: "float" },
            availability: { type: "keyword" },
            is_hidden: { type: "boolean" },
            canonical_id: { type: "keyword" },
            image_cdn: { type: "keyword" },
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
          },
        },
      },
    });
    console.log(`Created OpenSearch index: ${index}`);
  }
}