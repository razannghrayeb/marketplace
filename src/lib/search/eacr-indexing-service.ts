/**
 * E-ACR v3 Indexing Service
 * 
 * Parallel indexing pipeline that indexes products into E-ACR alongside OpenSearch.
 * Enables A/B testing of E-ACR vs OpenSearch on recall and latency metrics.
 * 
 * Usage:
 *   - Call addProduct() when a product is indexed in OpenSearch
 *   - Call search() to query the E-ACR index
 *   - Call getMetrics() to compare recall/latency vs OpenSearch
 */

import { EACRv3Engine, SearchResult } from "./eacr-v3-engine";
import { pg, osClient } from "../core";
import { config } from "../../config";

export interface ProductEmbedding {
  productId: string;
  embedding: number[];
  title: string;
  category: string;
  color: string;
  availability: boolean;
  timestamp: number;
}

export interface EACRSearchResult {
  productId: string;
  distance: number;
  title?: string;
  category?: string;
  rank: number;
}

export interface IndexMetrics {
  totalProducts: number;
  totalClusters: number;
  avgClusterSize: number;
  clusterDrift: number;
  lastUpdateMs: number;
  avgQueryLatencyMs: number;
  recall10: number;
  recallAt100: number;
}

/**
 * E-ACR Indexing Service: manages parallel indexing with E-ACR
 */
export class EACRIndexingService {
  private engine: EACRv3Engine;
  private productMetadata: Map<
    string,
    {
      title: string;
      category: string;
      color: string;
      availability: boolean;
    }
  > = new Map();
  private indexedProductIds: Set<string> = new Set();
  private metrics: IndexMetrics = {
    totalProducts: 0,
    totalClusters: 0,
    avgClusterSize: 0,
    clusterDrift: 0,
    lastUpdateMs: 0,
    avgQueryLatencyMs: 0,
    recall10: 0,
    recallAt100: 0,
  };

  constructor(numClusters: number = 256) {
    this.engine = new EACRv3Engine(numClusters);
  }

  /**
   * Index a product with its embedding
   */
  async addProduct(product: ProductEmbedding) {
    try {
      // Add to E-ACR engine
      this.engine.addVector(product.productId, product.embedding, product.timestamp);
      this.indexedProductIds.add(product.productId);

      // Store metadata for search results
      this.productMetadata.set(product.productId, {
        title: product.title,
        category: product.category,
        color: product.color,
        availability: product.availability,
      });

      this.updateMetrics();
    } catch (err) {
      console.error(`Failed to index product ${product.productId}:`, err);
    }
  }

  /**
   * Batch index products
   */
  async addProductsBatch(products: ProductEmbedding[]) {
    const startTime = Date.now();

    for (const product of products) {
      this.engine.addVector(product.productId, product.embedding, product.timestamp);
      this.indexedProductIds.add(product.productId);
      this.productMetadata.set(product.productId, {
        title: product.title,
        category: product.category,
        color: product.color,
        availability: product.availability,
      });
    }

    this.metrics.lastUpdateMs = Date.now() - startTime;
    this.updateMetrics();
  }

  /**
   * Search the E-ACR index
   */
  search(queryEmbedding: number[], k: number = 10): EACRSearchResult[] {
    const engineResults = this.engine.search(queryEmbedding, k);
    return engineResults.map((result) => {
      const metadata = this.productMetadata.get(result.id) || {
        title: "Unknown",
        category: "Unknown",
        color: "Unknown",
        availability: false,
      };
      return {
        productId: result.id,
        distance: result.distance,
        title: metadata.title,
        category: metadata.category,
        rank: result.rank,
      };
    });
  }

  /**
   * Compare E-ACR results with OpenSearch results (for A/B testing)
   */
  async compareWithOpenSearch(
    queryEmbedding: number[],
    k: number = 10
  ): Promise<{
    eacrResults: EACRSearchResult[];
    osResults: any[];
    recall10: number;
    recallAt100: number;
  }> {
    // E-ACR search
    const eacrResults = this.search(queryEmbedding, Math.max(k, 100));

    // OpenSearch search (same query via vector search)
    const osResults = await this.searchOpenSearch(queryEmbedding, Math.max(k, 100));

    // Calculate recall@10 and recall@100
    const eacrIds10 = new Set(eacrResults.slice(0, 10).map((r: any) => r.productId as string)) as Set<string>;
    const osIds10 = new Set(osResults.slice(0, 10).map((r: any) => r.productId as string)) as Set<string>;
    const recall10 = this.calculateRecall(eacrIds10, osIds10);

    const eacrIds100 = new Set(eacrResults.slice(0, 100).map((r: any) => r.productId as string)) as Set<string>;
    const osIds100 = new Set(osResults.slice(0, 100).map((r: any) => r.productId as string)) as Set<string>;
    const recallAt100 = this.calculateRecall(eacrIds100, osIds100);

    this.metrics.recall10 = recall10;
    this.metrics.recallAt100 = recallAt100;

    return { eacrResults, osResults, recall10, recallAt100 };
  }

  /**
   * Search OpenSearch for comparison
   */
  private async searchOpenSearch(queryEmbedding: number[], k: number = 100) {
    const INDEX = config.opensearch.index;

    try {
      const resp = await osClient.search({
        index: INDEX,
        size: k,
        body: {
          query: {
            knn: {
              embedding: {
                vector: queryEmbedding,
                k,
              },
            },
          },
        },
      });

      return resp.body.hits.hits.map((hit: any) => ({
        productId: hit._id,
        score: hit._score,
        title: hit._source?.title,
      }));
    } catch (err) {
      console.error("OpenSearch search failed:", err);
      return [];
    }
  }

  /**
   * Calculate recall: intersection / union
   */
  private calculateRecall(set1: Set<string>, set2: Set<string>): number {
    if (set2.size === 0) return 0;
    let intersection = 0;
    for (const item of set1) {
      if (set2.has(item)) intersection++;
    }
    return intersection / set2.size;
  }

  /**
   * Get current index metrics
   */
  getMetrics(): IndexMetrics {
    return { ...this.metrics };
  }

  /**
   * Update internal metrics from engine
   */
  private updateMetrics() {
    const engineStats = this.engine.getStats();
    this.metrics.totalProducts = engineStats.totalVectors;
    this.metrics.totalClusters = engineStats.totalClusters;
    this.metrics.avgClusterSize = engineStats.avgClusterSize;
    this.metrics.clusterDrift = engineStats.clusterDrift;
    this.metrics.avgQueryLatencyMs = engineStats.queryLatencyMs;
  }

  /**
   * Get comparison report between E-ACR and OpenSearch
   */
  async getComparisonReport(): Promise<{
    indexedProducts: number;
    metrics: IndexMetrics;
    recommendation: string;
  }> {
    const report = {
      indexedProducts: this.indexedProductIds.size,
      metrics: this.getMetrics(),
      recommendation: "",
    };

    // Recommendation logic
    if (this.metrics.recall10 > 0.95 && this.metrics.avgQueryLatencyMs < 10) {
      report.recommendation =
        "✅ E-ACR v3 outperforms OpenSearch on both recall and latency. Ready for production.";
    } else if (this.metrics.recall10 > 0.95) {
      report.recommendation =
        "⚠️ E-ACR v3 has perfect recall but latency is high. Optimize for production use.";
    } else if (this.metrics.avgQueryLatencyMs < 5) {
      report.recommendation =
        "⚠️ E-ACR v3 is fast but recall is lower. Fine-tune clustering parameters.";
    } else {
      report.recommendation =
        "❌ E-ACR v3 needs optimization. Monitor metrics and adjust parameters.";
    }

    return report;
  }

  /**
   * Save E-ACR index to disk
   */
  saveIndex(filepath: string) {
    this.engine.save(filepath);
    console.log(`E-ACR index saved to ${filepath}`);
  }

  /**
   * Load E-ACR index from disk
   */
  loadIndex(filepath: string) {
    this.engine.load(filepath);
    console.log(`E-ACR index loaded from ${filepath}`);
  }
}

/**
 * Global singleton instance
 */
let eacrService: EACRIndexingService | null = null;

/**
 * Initialize E-ACR service
 */
export function initializeEACRService(numClusters: number = 256): EACRIndexingService {
  if (!eacrService) {
    eacrService = new EACRIndexingService(numClusters);
  }
  return eacrService;
}

/**
 * Get E-ACR service instance
 */
export function getEACRService(): EACRIndexingService {
  if (!eacrService) {
    throw new Error(
      "E-ACR service not initialized. Call initializeEACRService() first."
    );
  }
  return eacrService;
}
