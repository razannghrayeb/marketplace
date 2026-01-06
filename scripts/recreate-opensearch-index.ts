import { osClient, ensureIndex } from "../src/lib/opensearch";
import { config } from "../src/config";

async function main() {
  const index = config.opensearch.index;
  try {
    const exists = await osClient.indices.exists({ index });
    if (exists.body) {
      console.log(`Deleting existing index: ${index}`);
      await osClient.indices.delete({ index });
    } else {
      console.log(`Index ${index} does not exist.`);
    }

    console.log(`Recreating index: ${index}`);
    await ensureIndex();
    console.log("Done.");
    process.exit(0);
  } catch (err) {
    console.error("Failed to recreate index:", err);
    process.exit(1);
  }
}

main();
