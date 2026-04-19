/**
 * Ensure OpenSearch Index Schema with Part-Level Embeddings
 * 
 * This script:
 * 1. Creates the index if it doesn't exist (via ensureIndex)
 * 2. Detects if part embedding fields are missing
 * 3. Non-breaking update: adds missing part fields to existing index
 * 
 * Safe to run multiple times. No data loss.
 */

import { osClient, ensureIndex } from "../src/lib/core/opensearch";
import { config } from "../src/config";

const EMBEDDING_DIM = parseInt(process.env.EXPECTED_EMBEDDING_DIM || "512", 10);

const PART_EMBEDDING_FIELDS = [
  "embedding_part_sleeve",
  "embedding_part_neckline",
  "embedding_part_hem",
  "embedding_part_waistline",
  "embedding_part_heel",
  "embedding_part_toe",
  "embedding_part_bag_handle",
  "embedding_part_bag_body",
  "embedding_part_pattern_patch",
];

async function ensurePartEmbeddingFields() {
  const index = config.opensearch.index;

  try {
    // 1. Ensure index exists
    console.log(`[1/3] Ensuring index exists: ${index}`);
    await ensureIndex();
    console.log(`     ✓ Index exists`);

    // 2. Get current mapping
    console.log(`[2/3] Checking for missing part embedding fields`);
    const mapping = await osClient.indices.getMapping({ index });
    const properties = mapping.body[index].mappings.properties;

    const missingFields = PART_EMBEDDING_FIELDS.filter(
      (field) => !properties[field]
    );

    if (missingFields.length === 0) {
      console.log(`     ✓ All 9 part embedding fields already exist`);
      return;
    }

    console.log(`     ⚠ Found ${missingFields.length} missing field(s):`);
    missingFields.forEach((f) => console.log(`       - ${f}`));

    // 3. Add missing fields via non-breaking mapping update
    console.log(`[3/3] Adding missing fields to mapping`);
    const newProperties: Record<string, any> = {};

    missingFields.forEach((field) => {
      newProperties[field] = {
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
      };
    });

    await osClient.indices.putMapping({
      index,
      body: {
        properties: newProperties,
      },
    });

    console.log(`     ✓ Successfully added ${missingFields.length} field(s)`);
    console.log("");
    console.log("✅ Schema update complete. Index is ready for Phase 1.");
    console.log("");
    console.log("Next steps:");
    console.log(`  1. Run reindex: npx tsx scripts/resume-reindex.ts --force`);
    console.log(`  2. Monitor indexing progress (takes 1-2 days for full catalog)`);
    console.log(`  3. Stage rollout: SEARCH_IMAGE_PART_WEIGHT=20 (start at 2%)`);
  } catch (error) {
    console.error("❌ Schema update failed:", error);
    process.exit(1);
  }
}

// Run
ensurePartEmbeddingFields().then(() => {
  process.exit(0);
});
