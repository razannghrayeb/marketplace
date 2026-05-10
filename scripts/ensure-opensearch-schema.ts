/**
 * Ensure OpenSearch Index Schema with Part-Level Embeddings and scalar ranking fields.
 *
 * Safe to run multiple times. It only adds missing mappings; it does not delete data.
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

const SCALAR_FIELDS: Record<string, any> = {
  product_quality_score: { type: "float" },
};

async function ensureOpenSearchSchema() {
  const index = config.opensearch.index;

  try {
    console.log(`[1/3] Ensuring index exists: ${index}`);
    await ensureIndex();
    console.log("     Index exists");

    console.log("[2/3] Checking for missing part embedding/scalar fields");
    const mapping = await osClient.indices.getMapping({ index });
    const properties = mapping.body[index].mappings.properties;

    const missingPartFields = PART_EMBEDDING_FIELDS.filter((field) => !properties[field]);
    const missingScalarFields = Object.keys(SCALAR_FIELDS).filter((field) => !properties[field]);

    if (missingPartFields.length === 0 && missingScalarFields.length === 0) {
      console.log("     All part embedding and scalar fields already exist");
      return;
    }

    console.log(`     Missing fields: ${missingPartFields.length + missingScalarFields.length}`);
    missingPartFields.forEach((field) => console.log(`       - ${field}`));
    missingScalarFields.forEach((field) => console.log(`       - ${field}`));

    console.log("[3/3] Adding missing fields to mapping");
    const newProperties: Record<string, any> = {};

    for (const field of missingPartFields) {
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
    }

    for (const field of missingScalarFields) {
      newProperties[field] = SCALAR_FIELDS[field];
    }

    await osClient.indices.putMapping({
      index,
      body: {
        properties: newProperties,
      },
    });

    console.log(`     Successfully added ${Object.keys(newProperties).length} field(s)`);
    console.log("");
    console.log("Schema update complete.");
    console.log("");
    console.log("Next steps:");
    console.log("  1. Run reindex/backfill so existing docs receive product_quality_score");
    console.log("  2. Run diagnose-image-pipeline-health.ts or a field count to verify coverage");
  } catch (error) {
    console.error("Schema update failed:", error);
    process.exit(1);
  }
}

ensureOpenSearchSchema().then(() => {
  process.exit(0);
});
