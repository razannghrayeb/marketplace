/**
 * Locality-Sensitive Hashing (LSH) for pHash Similarity
 * 
 * Provides O(1) similarity lookup instead of O(N) full scan.
 * Uses multi-probe LSH with Hamming distance for 64-bit perceptual hashes.
 */

import { pg } from "../core/db";

// ============================================================================
// Types
// ============================================================================

export interface LSHBucket {
  bucket_hash: string;
  band_index: number;
}

export interface SimilarityResult {
  product_id: number;
  p_hash: string;
  hamming_distance: number;
}

export interface ImageSignals {
  has_image: boolean;
  is_original: boolean;
  similar_image_count: number;
  image_quality: "high" | "medium" | "low" | "unknown";
}

// ============================================================================
// LSH Configuration
// ============================================================================

const LSH_CONFIG = {
  numBands: 8,        // Number of bands (hash tables)
  rowsPerBand: 8,     // Rows per band (64 bits / 8 bands = 8 bits per band)
  maxDistance: 10,    // Max Hamming distance to consider similar
};

// ============================================================================
// LSH Functions
// ============================================================================

/**
 * Convert a hex pHash string to a binary string
 */
function pHashToBinary(pHash: string): string {
  return pHash
    .split("")
    .map(c => parseInt(c, 16).toString(2).padStart(4, "0"))
    .join("");
}

/**
 * Compute LSH bucket hashes for a given pHash.
 * Divides the 64-bit hash into bands and hashes each band.
 */
export function computeLSHBuckets(pHash: string): LSHBucket[] {
  const binary = pHashToBinary(pHash);
  const buckets: LSHBucket[] = [];
  
  for (let band = 0; band < LSH_CONFIG.numBands; band++) {
    const start = band * LSH_CONFIG.rowsPerBand;
    const end = start + LSH_CONFIG.rowsPerBand;
    const bandBits = binary.slice(start, end);
    
    // Hash the band bits to create bucket identifier
    const bucketHash = `b${band}_${bandBits}`;
    buckets.push({
      bucket_hash: bucketHash,
      band_index: band,
    });
  }
  
  return buckets;
}

/**
 * Compute Hamming distance between two pHash strings
 */
export function hammingDistance(hash1: string, hash2: string): number {
  if (hash1.length !== hash2.length) {
    return 64; // Max distance for incompatible hashes
  }
  
  let distance = 0;
  for (let i = 0; i < hash1.length; i++) {
    const xor = parseInt(hash1[i], 16) ^ parseInt(hash2[i], 16);
    // Count set bits in XOR result
    distance += xor.toString(2).split("1").length - 1;
  }
  
  return distance;
}

/**
 * Index a product image's pHash into LSH buckets.
 * Call this during image ingestion.
 */
export async function indexImageHash(
  productId: number,
  imageId: number,
  pHash: string
): Promise<void> {
  const buckets = computeLSHBuckets(pHash);
  
  const values = buckets.map((b, idx) => 
    `($1, $2, $3, '${b.bucket_hash}', ${b.band_index})`
  ).join(", ");
  
  await pg.query(
    `INSERT INTO product_image_lsh (product_id, image_id, p_hash, bucket_hash, band_index)
     VALUES ${values}
     ON CONFLICT (image_id, band_index) DO UPDATE SET
       bucket_hash = EXCLUDED.bucket_hash,
       p_hash = EXCLUDED.p_hash`,
    [productId, imageId, pHash]
  );
}

/**
 * Find similar images using LSH buckets.
 * O(1) bucket lookup + O(k) verification where k << N
 */
export async function findSimilarImages(
  pHash: string,
  excludeProductId?: number,
  maxResults: number = 100
): Promise<SimilarityResult[]> {
  const buckets = computeLSHBuckets(pHash);
  const bucketHashes = buckets.map(b => b.bucket_hash);
  
  // Find candidate images that share at least one LSH bucket
  const result = await pg.query<{ product_id: number; p_hash: string }>(
    `SELECT DISTINCT product_id, p_hash
     FROM product_image_lsh
     WHERE bucket_hash = ANY($1)
       AND ($2::int IS NULL OR product_id != $2)
     LIMIT $3`,
    [bucketHashes, excludeProductId ?? null, maxResults * 2]
  );
  
  // Verify candidates with actual Hamming distance
  const verified: SimilarityResult[] = [];
  
  for (const row of result.rows) {
    const distance = hammingDistance(pHash, row.p_hash);
    if (distance <= LSH_CONFIG.maxDistance) {
      verified.push({
        product_id: row.product_id,
        p_hash: row.p_hash,
        hamming_distance: distance,
      });
    }
  }
  
  // Sort by distance and limit
  return verified
    .sort((a, b) => a.hamming_distance - b.hamming_distance)
    .slice(0, maxResults);
}

/**
 * Analyze image originality using LSH (fast O(1) lookup).
 * Replaces the O(N) full table scan.
 */
export async function analyzeImageSignalsFast(
  productId: number,
  pHash: string | null
): Promise<ImageSignals> {
  if (!pHash) {
    return {
      has_image: false,
      is_original: true,
      similar_image_count: 0,
      image_quality: "unknown",
    };
  }
  
  const similar = await findSimilarImages(pHash, productId, 20);
  const similarCount = similar.length;
  
  return {
    has_image: true,
    is_original: similarCount === 0,
    similar_image_count: similarCount,
    image_quality: similarCount > 5 ? "low" : similarCount > 0 ? "medium" : "high",
  };
}

/**
 * Batch index multiple images (for initial migration)
 */
export async function batchIndexImages(
  images: Array<{ product_id: number; image_id: number; p_hash: string }>
): Promise<{ indexed: number; errors: number }> {
  let indexed = 0;
  let errors = 0;
  
  const BATCH_SIZE = 100;
  
  for (let i = 0; i < images.length; i += BATCH_SIZE) {
    const batch = images.slice(i, i + BATCH_SIZE);
    
    try {
      const allBuckets: string[] = [];
      
      for (const img of batch) {
        const buckets = computeLSHBuckets(img.p_hash);
        for (const bucket of buckets) {
          allBuckets.push(
            `(${img.product_id}, ${img.image_id}, '${img.p_hash}', '${bucket.bucket_hash}', ${bucket.band_index})`
          );
        }
      }
      
      if (allBuckets.length > 0) {
        await pg.query(
          `INSERT INTO product_image_lsh (product_id, image_id, p_hash, bucket_hash, band_index)
           VALUES ${allBuckets.join(", ")}
           ON CONFLICT (image_id, band_index) DO NOTHING`
        );
      }
      
      indexed += batch.length;
    } catch (err) {
      console.error("[LSH] Batch index error:", err);
      errors += batch.length;
    }
  }
  
  return { indexed, errors };
}

/**
 * Create LSH index table if it doesn't exist
 */
export async function ensureLSHTable(): Promise<void> {
  await pg.query(`
    CREATE TABLE IF NOT EXISTS product_image_lsh (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL,
      image_id INTEGER NOT NULL,
      p_hash VARCHAR(16) NOT NULL,
      bucket_hash VARCHAR(32) NOT NULL,
      band_index SMALLINT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      
      CONSTRAINT unique_image_band UNIQUE (image_id, band_index)
    );
    
    CREATE INDEX IF NOT EXISTS idx_lsh_bucket ON product_image_lsh (bucket_hash);
    CREATE INDEX IF NOT EXISTS idx_lsh_product ON product_image_lsh (product_id);
  `);
}

/**
 * Pre-compute similarity clusters offline.
 * Groups images into clusters based on LSH buckets.
 */
export async function computeSimilarityClusters(): Promise<{
  clusters: number;
  images: number;
}> {
  // Find all bucket hashes with multiple images
  const clustersResult = await pg.query<{ bucket_hash: string; count: string }>(
    `SELECT bucket_hash, COUNT(DISTINCT product_id) as count
     FROM product_image_lsh
     GROUP BY bucket_hash
     HAVING COUNT(DISTINCT product_id) > 1
     ORDER BY count DESC
     LIMIT 10000`
  );
  
  // Store cluster information for quick lookup
  let clusterCount = 0;
  
  for (const row of clustersResult.rows) {
    const memberCount = parseInt(row.count, 10);
    if (memberCount >= 2) {
      await pg.query(
        `INSERT INTO image_similarity_clusters (bucket_hash, member_count, computed_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (bucket_hash) DO UPDATE SET
           member_count = EXCLUDED.member_count,
           computed_at = NOW()`,
        [row.bucket_hash, memberCount]
      );
      clusterCount++;
    }
  }
  
  const totalImages = await pg.query<{ count: string }>(
    `SELECT COUNT(DISTINCT image_id) as count FROM product_image_lsh`
  );
  
  return {
    clusters: clusterCount,
    images: parseInt(totalImages.rows[0].count, 10),
  };
}

/**
 * Ensure cluster table exists
 */
export async function ensureClusterTable(): Promise<void> {
  await pg.query(`
    CREATE TABLE IF NOT EXISTS image_similarity_clusters (
      id SERIAL PRIMARY KEY,
      bucket_hash VARCHAR(32) UNIQUE NOT NULL,
      member_count INTEGER NOT NULL,
      computed_at TIMESTAMP DEFAULT NOW()
    );
    
    CREATE INDEX IF NOT EXISTS idx_cluster_count ON image_similarity_clusters (member_count DESC);
  `);
}
