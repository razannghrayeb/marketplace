import "dotenv/config";
import { osClient } from "../src/lib/core/opensearch";

(async () => {
  try {
    const count = await osClient.count({ index: "products" });
    console.log("Total products in index:", count.body.count);

    const sample = await osClient.search({
      index: "products",
      size: 1,
      body: {
        query: { match_all: {} },
      },
    });

    const hit = sample.body.hits.hits[0];
    if (hit) {
      console.log("\nSample product fields:");
      console.log(Object.keys(hit._source).join(", "));
      console.log("\nHas embedding?", "embedding" in hit._source);
      console.log("Has embedding_score_version?", "embedding_score_version" in hit._source);
    }
  } catch (err: any) {
    console.error("Error:", err.message);
  }
  process.exit(0);
})();
