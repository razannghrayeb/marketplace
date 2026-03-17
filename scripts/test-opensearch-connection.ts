/**
 * Quick test to verify OpenSearch connection
 */
import "dotenv/config";
import { osClient } from "../src/lib/core/opensearch.js";

async function test() {
  try {
    console.log("Testing OpenSearch connection...\n");

    // Test cluster health
    const health = await osClient.cluster.health();
    console.log("✓ Cluster health:", {
      status: health.body.status,
      nodes: health.body.number_of_nodes,
      shards: `${health.body.active_shards}/${health.body.active_shards + health.body.unassigned_shards}`,
    });

    // Test cluster info
    const info = await osClient.info();
    console.log("✓ OpenSearch version:", info.body.version.number);

    console.log("\n✓✓✓ OpenSearch connection working! ✓✓✓");
  } catch (error) {
    console.error("\n✗✗✗ OpenSearch connection failed ✗✗✗");
    console.error(error);
    process.exit(1);
  }
}

test();
