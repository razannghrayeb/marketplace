"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.osClient = void 0;
exports.ensureIndex = ensureIndex;
exports.recreateIndex = recreateIndex;
exports.getIndexStats = getIndexStats;
/**
 * OpenSearch Client & Index Management
 *
 * Manages OpenSearch connection and index configuration.
 */
const opensearch_1 = require("@opensearch-project/opensearch");
const config_js_1 = require("../../config.js");
console.log("OS config:", config_js_1.config.opensearch.node, config_js_1.config.opensearch.username, config_js_1.config.opensearch.password?.length);
exports.osClient = new opensearch_1.Client({
    node: config_js_1.config.opensearch.node,
    auth: {
        username: config_js_1.config.opensearch.username,
        password: config_js_1.config.opensearch.password,
    },
    ssl: { rejectUnauthorized: false },
});
// CLIP ViT-B/32 embedding dimension
const EMBEDDING_DIM = 512;
/**
 * Ensure the products index exists with proper mapping
 */
async function ensureIndex() {
    const index = config_js_1.config.opensearch.index;
    const exists = await exports.osClient.indices.exists({ index });
    if (!exists.body) {
        await exports.osClient.indices.create({
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
                        // Extracted attributes (keyword for fast filtering/facets)
                        attr_color: { type: "keyword" },
                        attr_colors: { type: "keyword" }, // Multi-value
                        attr_material: { type: "keyword" },
                        attr_materials: { type: "keyword" }, // Multi-value
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
async function recreateIndex() {
    const index = config_js_1.config.opensearch.index;
    const exists = await exports.osClient.indices.exists({ index });
    if (exists.body) {
        await exports.osClient.indices.delete({ index });
        console.log(`Deleted OpenSearch index: ${index}`);
    }
    await ensureIndex();
}
/**
 * Get index stats
 */
async function getIndexStats() {
    const index = config_js_1.config.opensearch.index;
    const stats = await exports.osClient.indices.stats({ index });
    return {
        docCount: stats.body._all.primaries.docs.count,
        sizeBytes: stats.body._all.primaries.store.size_in_bytes,
    };
}
