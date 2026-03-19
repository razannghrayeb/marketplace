/**
 * Debug helper: verify `sharp` interop works at runtime by running pHash +
 * (optionally) CLIP embedding for a single product.
 *
 * Usage:
 *   npx tsx scripts/debug-image-sharp.ts --id 8471
 */

import "dotenv/config";
import axios from "axios";
import { pg } from "../src/lib/core";
import { computePHash, processImageForEmbedding, initImageProcessing } from "../src/lib/image";

async function main() {
  const args = process.argv.slice(2);
  let id: number | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--id") id = parseInt(args[++i], 10);
  }
  if (!id) {
    console.error("Missing required arg: --id <number>");
    process.exit(1);
  }

  const res = await pg.query(
    `SELECT id, image_url, title FROM products WHERE id = $1 LIMIT 1`,
    [id]
  );
  const product = res.rows[0];
  if (!product?.image_url) {
    console.error(`No product or image_url found for id=${id}`);
    process.exit(1);
  }

  console.log(`Debug product id=${id}: ${product.title?.slice(0, 80) ?? ""}`);

  const resp = await axios.get(product.image_url, { responseType: "arraybuffer", timeout: 30000 });
  const buf = Buffer.from(resp.data);

  // Ensure CLIP runtime is initialized before embedding test
  try {
    await initImageProcessing();
  } catch {
    // If models are already initialized, this should be fine; otherwise embedding will fail below.
  }

  console.log("Running computePHash()...");
  const ph = await computePHash(buf);
  console.log("pHash:", ph);

  console.log("Running processImageForEmbedding()...");
  const embedding = await processImageForEmbedding(buf);
  console.log("Embedding length:", embedding.length);
}

main().catch((err) => {
  console.error("Debug failed:", err);
  process.exit(1);
});

