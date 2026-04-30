/**
 * E-ACR Backfill Script
 * 
 * Load existing products from Postgres + OpenSearch embeddings into E-ACR v3 for comparison.
 * This enables A/B testing of E-ACR vs OpenSearch on your current product catalog.
 * 
 * Run: npx ts-node -r dotenv/config scripts/backfill-eacr-index.ts
 * Dry:  npx ts-node -r dotenv/config scripts/backfill-eacr-index.ts --dry-run
 * Save: npx ts-node -r dotenv/config scripts/backfill-eacr-index.ts --save-path ./data/eacr-index.json
 */

import "dotenv/config";
import { pg, osClient } from "../src/lib/core";
import { config } from "../src/config";
import { initializeEACRService } from "../src/lib/search/eacr-indexing-service";
import * as fs from "fs";
import * as path from "path";

const INDEX = process.argv.includes("--index")
  ? process.argv[process.argv.indexOf("--index") + 1]
  : "products_dedup_v1"; // Default to deduplicated index
const BATCH_SIZE = 100;
const CHECKPOINT_FILE = "./data/backfill-checkpoint.json";
const MAX_RETRIES = 5;

interface ProductDoc {
  id: string;
  title: string;
  category: string;
  color: string;
  availability: boolean;
  embedding: number[];
}

interface Checkpoint {
  fetchedCount: number;
  indexedCount: number;
  products: ProductDoc[];
  timestamp: number;
}

/**
 * Load checkpoint if it exists
 */
function loadCheckpoint(): Checkpoint | null {
  try {
    if (fs.existsSync(CHECKPOINT_FILE)) {
      const data = fs.readFileSync(CHECKPOINT_FILE, "utf-8");
      const checkpoint = JSON.parse(data);
      console.log(`✅ Loaded checkpoint: ${checkpoint.fetchedCount} fetched, ${checkpoint.indexedCount} indexed`);
      return checkpoint;
    }
  } catch (err) {
    console.error(`Failed to load checkpoint:`, err);
  }
  return null;
}

/**
 * Save checkpoint progress
 */
function saveCheckpoint(checkpoint: Checkpoint) {
  try {
    // Ensure data directory exists
    const dir = path.dirname(CHECKPOINT_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2));
    console.log(`💾 Checkpoint saved: ${checkpoint.fetchedCount} fetched, ${checkpoint.indexedCount} indexed`);
  } catch (err) {
    console.error(`Failed to save checkpoint:`, err);
  }
}

/**
 * Clear checkpoint after success
 */
function clearCheckpoint() {
  try {
    if (fs.existsSync(CHECKPOINT_FILE)) {
      fs.unlinkSync(CHECKPOINT_FILE);
      console.log(`🗑️  Checkpoint cleared`);
    }
  } catch (err) {
    console.error(`Failed to clear checkpoint:`, err);
  }
}

/**
 * Fetch products from OpenSearch with embeddings (with retry logic)
 */
async function fetchProductsFromOpenSearch(): Promise<ProductDoc[]> {
  const products: ProductDoc[] = [];
  let batch = 0;

  // Support starting from a specific offset (for resume)
  const fromOffset = process.argv.includes("--from-offset")
    ? parseInt(process.argv[process.argv.indexOf("--from-offset") + 1])
    : 0;

  const searchWithRetry = async (body: Record<string, any>) => {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await osClient.search({
          index: INDEX,
          size: BATCH_SIZE,
          _source: ["title", "category", "attr_color", "availability", "embedding"],
          body,
        });
      } catch (err: any) {
        console.error(`  Search attempt ${attempt + 1}/${MAX_RETRIES} failed:`, err.message);
        if (attempt < MAX_RETRIES - 1) {
          const backoffMs = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s, 8s, 16s
          console.log(`  Retrying in ${backoffMs}ms...`);
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          continue;
        }
        throw err;
      }
    }

    throw new Error("Search failed after retries");
  };

  let total = 0;
  let docIndex = 0; // Track overall document position in sorted order
  let searchAfter: any[] | undefined;
  let loggedTotal = false;

  
  if (fromOffset > 0) {
    console.log(`📍 Starting from offset ${fromOffset}. Skipping first ${fromOffset} documents...`);
  }

  while (true) {
    const body: Record<string, any> = {
      query: { match_all: {} },
      // Stable sort key required for reliable search_after pagination.
      sort: [{ _id: "asc" }],
    };
    if (searchAfter) {
      body.search_after = searchAfter;
    }

    const resp = await searchWithRetry(body);
    const hits = resp.body.hits.hits as Array<any>;

    if (!loggedTotal) {
      total = resp.body.hits.total?.value ?? resp.body.hits.total ?? 0;
      console.log(`Found ${total} documents in ${INDEX}. Fetching embeddings...`);
      loggedTotal = true;
    }

    if (!hits.length) {
      break;
    }

    for (const hit of hits) {
      docIndex++;
      
      // Skip documents until we reach fromOffset
      if (docIndex <= fromOffset) {
        continue;
      }
      
      const source = hit._source;
      if (source.embedding && Array.isArray(source.embedding)) {
        products.push({
          id: hit._id,
          title: source.title || "Unknown",
          category: source.category || "Unknown",
          color: source.attr_color || source.color || "Unknown",
          availability: source.availability === true,
          embedding: source.embedding,
        });
      }
    }

    batch++;
    const progress = Math.min(docIndex, total);
    console.log(`  Fetched ${progress}/${total} products...`);

    searchAfter = hits[hits.length - 1]?.sort;
  }

  console.log(`Total products with embeddings: ${products.length}`);
  return products;
}

/**
 * Index products into E-ACR
 */
async function indexProductsIntoEACR(
  products: ProductDoc[]
): Promise<{ indexed: number; failed: number }> {
  const eacr = initializeEACRService(256);
  let indexed = 0;
  let failed = 0;

  for (let i = 0; i < products.length; i += BATCH_SIZE) {
    const batch = products.slice(i, i + BATCH_SIZE);

    try {
      await eacr.addProductsBatch(
        batch.map((p) => ({
          productId: p.id,
          embedding: p.embedding,
          title: p.title,
          category: p.category,
          color: p.color,
          availability: p.availability,
          timestamp: Date.now(),
        }))
      );

      indexed += batch.length;
      const progress = Math.min(i + batch.length, products.length);
      const percentage = ((progress / products.length) * 100).toFixed(1);
      console.log(
        `  Indexed ${progress}/${products.length} (${percentage}%) - Avg batch time: ${eacr
          .getMetrics()
          .lastUpdateMs.toFixed(2)}ms`
      );
    } catch (err) {
      console.error(`Error indexing batch at offset ${i}:`, err);
      failed += batch.length;
    }
  }

  console.log(`\nIndexing complete:`);
  console.log(`  Successfully indexed: ${indexed}`);
  console.log(`  Failed: ${failed}`);

  return { indexed, failed };
}

/**
 * Run comparison tests
 */
async function runComparisonTests(eacrService: any, testProductIds: string[]) {
  console.log(`\nRunning comparison tests on ${testProductIds.length} random products...`);

  let recall10Sum = 0;
  let recall100Sum = 0;
  let eacrLatencySum = 0;

  for (let i = 0; i < Math.min(testProductIds.length, 10); i++) {
    const docId = testProductIds[Math.floor(Math.random() * testProductIds.length)];

    // Get the document's embedding from OpenSearch
    try {
      const doc = await osClient.get({ index: INDEX, id: docId });
      if (doc.body._source.embedding) {
        const comparison = await eacrService.compareWithOpenSearch(doc.body._source.embedding, 100);
        recall10Sum += comparison.recall10;
        recall100Sum += comparison.recallAt100;
        eacrLatencySum += eacrService.getMetrics().avgQueryLatencyMs;

        console.log(
          `  Test ${i + 1}: Recall@10=${(comparison.recall10 * 100).toFixed(1)}% Recall@100=${(
            comparison.recallAt100 * 100
          ).toFixed(1)}%`
        );
      }
    } catch (err) {
      console.error(`Error testing product ${docId}:`, err);
    }
  }

  const avgRecall10 = (recall10Sum / Math.min(testProductIds.length, 10)) * 100;
  const avgRecall100 = (recall100Sum / Math.min(testProductIds.length, 10)) * 100;
  const avgLatency = eacrLatencySum / Math.min(testProductIds.length, 10);

  console.log(`\nComparison Results:`);
  console.log(`  Average Recall@10: ${avgRecall10.toFixed(1)}%`);
  console.log(`  Average Recall@100: ${avgRecall100.toFixed(1)}%`);
  console.log(`  Average Query Latency: ${avgLatency.toFixed(2)}ms`);
}

/**
 * Save index for later use
 */
function saveIndex(filepath: string, eacrService: any) {
  console.log(`\nSaving E-ACR index to ${filepath}...`);
  try {
    eacrService.saveIndex(filepath);
    console.log("✅ Index saved successfully");
  } catch (err) {
    console.error("❌ Failed to save index:", err);
  }
}

/**
 * Main
 */
async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const savePath = process.argv.includes("--save-path")
    ? process.argv[process.argv.indexOf("--save-path") + 1]
    : null;
  const runTests = process.argv.includes("--test");

  try {
    console.log("E-ACR Backfill Script");
    console.log("====================\n");

    if (dryRun) {
      console.log("🔍 DRY RUN MODE - No data will be written\n");
    }

    // Check for checkpoint and resume if available
    let checkpoint = loadCheckpoint();
    let products: ProductDoc[] = checkpoint?.products || [];

    // Fetch products (continue from checkpoint if available)
    console.log("Step 1: Fetching products from OpenSearch...");
    if (checkpoint) {
      console.log(`📍 Resuming from checkpoint (${checkpoint.fetchedCount} products already fetched)...`);
    }
    const newProducts = await fetchProductsFromOpenSearch();
    products = [...products, ...newProducts];

    if (products.length === 0) {
      console.log("No products found. Exiting.");
      process.exit(0);
    }

    // Update checkpoint
    checkpoint = {
      fetchedCount: products.length,
      indexedCount: checkpoint?.indexedCount || 0,
      products,
      timestamp: Date.now(),
    };
    saveCheckpoint(checkpoint);

    if (dryRun) {
      console.log(`\n✅ Dry run complete. Would index ${products.length} products. Use without --dry-run to actually index.`);
      process.exit(0);
    }

    // Index into E-ACR
    console.log("\nStep 2: Indexing products into E-ACR...");
    const result = await indexProductsIntoEACR(products);

    // Update checkpoint with indexed count
    checkpoint.indexedCount = result.indexed;
    saveCheckpoint(checkpoint);

    const eacr = initializeEACRService();

    // Run comparison tests if requested
    if (runTests && result.indexed > 0) {
      console.log("\nStep 3: Running comparison tests...");
      await runComparisonTests(eacr, products.map((p) => p.id));
    }

    // Save index if requested
    if (savePath) {
      console.log("\nStep 4: Saving index...");
      saveIndex(savePath, eacr);
    }

    // Print final metrics
    console.log("\nFinal Metrics:");
    const metrics = eacr.getMetrics();
    console.log(`  Total Products: ${metrics.totalProducts}`);
    console.log(`  Total Clusters: ${metrics.totalClusters}`);
    console.log(`  Avg Cluster Size: ${metrics.avgClusterSize.toFixed(1)}`);
    console.log(`  Cluster Drift: ${metrics.clusterDrift.toFixed(4)}`);
    console.log(`  Avg Query Latency: ${metrics.avgQueryLatencyMs.toFixed(2)}ms`);
    console.log(`  Avg Update Latency: ${metrics.lastUpdateMs.toFixed(2)}ms per product`);

    // Clear checkpoint on success
    clearCheckpoint();

    console.log("\n✅ Backfill complete!");
    process.exit(0);
  } catch (err) {
    console.error("Fatal error:", err);
    process.exit(1);
  }
}

main();
