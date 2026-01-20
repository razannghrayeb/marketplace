/**
 * Create OpenSearch index for wardrobe items embeddings
 * Enables k-NN similarity search on user wardrobe
 */
import { osClient } from "../src/lib/core";

const WARDROBE_INDEX = "wardrobe_items";

interface IndexSettings {
  settings: {
    index: {
      knn: boolean;
      "knn.space_type": string;
    };
    number_of_shards: number;
    number_of_replicas: number;
  };
  mappings: {
    properties: Record<string, any>;
  };
}

async function createWardrobeIndex() {
  console.log(`Creating ${WARDROBE_INDEX} index...`);

  // Check if index exists
  const exists = await osClient.indices.exists({ index: WARDROBE_INDEX });
  
  if (exists.body) {
    console.log(`Index ${WARDROBE_INDEX} already exists`);
    const shouldDelete = process.argv.includes("--force");
    if (shouldDelete) {
      console.log("Deleting existing index...");
      await osClient.indices.delete({ index: WARDROBE_INDEX });
    } else {
      console.log("Use --force to delete and recreate");
      return;
    }
  }

  const indexSettings: IndexSettings = {
    settings: {
      index: {
        knn: true,
        "knn.space_type": "cosinesimil",
      },
      number_of_shards: 1,
      number_of_replicas: 0,
    },
    mappings: {
      properties: {
        item_id: { type: "integer" },
        user_id: { type: "integer" },
        embedding: {
          type: "knn_vector",
          dimension: 512,
          method: {
            name: "hnsw",
            space_type: "cosinesimil",
            engine: "nmslib",
            parameters: {
              ef_construction: 128,
              m: 24,
            },
          },
        },
        category_id: { type: "integer" },
        brand: { type: "keyword" },
        indexed_at: { type: "date" },
      },
    },
  };

  await osClient.indices.create({
    index: WARDROBE_INDEX,
    body: indexSettings,
  });

  console.log(`Index ${WARDROBE_INDEX} created successfully`);
}

createWardrobeIndex()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Error creating wardrobe index:", err);
    process.exit(1);
  });
