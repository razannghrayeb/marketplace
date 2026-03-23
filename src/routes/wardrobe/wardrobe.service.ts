/**
 * Wardrobe Items Service
 * CRUD operations for user wardrobe items
 */
import { pg, osClient } from "../../lib/core";
import { processImageForEmbedding, computePHash, uploadImage } from "../../lib/image";

// ============================================================================
// Types
// ============================================================================

export interface WardrobeItem {
  id: number;
  user_id: number;
  source: "uploaded" | "purchased" | "manual" | "linked";
  product_id?: number;
  image_url?: string;
  image_cdn?: string;
  r2_key?: string;
  p_hash?: string;
  name?: string;
  category_id?: number;
  brand?: string;
  dominant_colors?: Array<{ color_id: number; hex: string; percent: number }>;
  pattern_id?: number;
  material_id?: number;
  embedding?: number[];
  attributes_extracted: boolean;
  extraction_version?: string;
  extraction_confidence?: number;
  created_at: Date;
  updated_at: Date;
}

export interface CreateWardrobeItemInput {
  user_id: number;
  source: "uploaded" | "purchased" | "manual" | "linked";
  product_id?: number;
  image_buffer?: Buffer;
  image_url?: string;
  name?: string;
  category_id?: number;
  brand?: string;
  pattern_id?: number;
  material_id?: number;
}

export interface UpdateWardrobeItemInput {
  name?: string;
  category_id?: number;
  brand?: string;
  pattern_id?: number;
  material_id?: number;
  dominant_colors?: Array<{ color_id: number; hex: string; percent: number }>;
}

// ============================================================================
// CRUD Operations
// ============================================================================

/**
 * Create a new wardrobe item
 */
export async function createWardrobeItem(input: CreateWardrobeItemInput): Promise<WardrobeItem> {
  let r2Key: string | null = null;
  let cdnUrl: string | null = null;
  let pHash: string | null = null;
  let embedding: number[] | null = null;

  // Process image if provided
  if (input.image_buffer) {
    const upload = await uploadImage(input.image_buffer);
    r2Key = upload.key;
    cdnUrl = upload.cdnUrl;
    pHash = await computePHash(input.image_buffer);
    embedding = await processImageForEmbedding(input.image_buffer);
  }

  const result = await pg.query<WardrobeItem>(
    `INSERT INTO wardrobe_items 
     (user_id, source, product_id, image_url, image_cdn, r2_key, p_hash, name, category_id, brand, pattern_id, material_id, embedding, attributes_extracted)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING *`,
    [
      input.user_id,
      input.source,
      input.product_id || null,
      input.image_url || cdnUrl,
      cdnUrl,
      r2Key,
      pHash,
      input.name || null,
      input.category_id || null,
      input.brand || null,
      input.pattern_id || null,
      input.material_id || null,
      embedding,
      embedding !== null
    ]
  );

  const item = result.rows[0];

  // Index in OpenSearch for similarity search
  if (embedding && embedding.length > 0) {
    await indexWardrobeItemEmbedding(item.id, input.user_id, embedding);
  }

  return item;
}

/**
 * Get wardrobe item by ID
 */
export async function getWardrobeItem(itemId: number, userId: number): Promise<WardrobeItem | null> {
  const result = await pg.query<WardrobeItem>(
    `SELECT * FROM wardrobe_items WHERE id = $1 AND user_id = $2`,
    [itemId, userId]
  );
  return result.rows[0] || null;
}

/**
 * Get all wardrobe items for a user
 */
export async function getUserWardrobeItems(
  userId: number,
  options: { categoryId?: number; limit?: number; offset?: number } = {}
): Promise<{ items: WardrobeItem[]; total: number }> {
  const { categoryId, limit = 50, offset = 0 } = options;

  let whereClause = "WHERE user_id = $1";
  const params: any[] = [userId];

  if (categoryId) {
    whereClause += ` AND category_id = $${params.length + 1}`;
    params.push(categoryId);
  }

  const countResult = await pg.query(
    `SELECT COUNT(*) as count FROM wardrobe_items ${whereClause}`,
    params
  );

  const result = await pg.query<WardrobeItem>(
    `SELECT * FROM wardrobe_items ${whereClause} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );

  const countRow = countResult.rows[0] as { count?: string | number } | undefined;
  const total = countRow?.count != null ? parseInt(String(countRow.count), 10) : 0;

  return {
    items: result.rows,
    total: isNaN(total) ? 0 : total
  };
}

/**
 * Update wardrobe item
 */
export async function updateWardrobeItem(
  itemId: number,
  userId: number,
  input: UpdateWardrobeItemInput
): Promise<WardrobeItem | null> {
  const sets: string[] = [];
  const params: any[] = [];
  let paramIndex = 1;

  if (input.name !== undefined) {
    sets.push(`name = $${paramIndex++}`);
    params.push(input.name);
  }
  if (input.category_id !== undefined) {
    sets.push(`category_id = $${paramIndex++}`);
    params.push(input.category_id);
  }
  if (input.brand !== undefined) {
    sets.push(`brand = $${paramIndex++}`);
    params.push(input.brand);
  }
  if (input.pattern_id !== undefined) {
    sets.push(`pattern_id = $${paramIndex++}`);
    params.push(input.pattern_id);
  }
  if (input.material_id !== undefined) {
    sets.push(`material_id = $${paramIndex++}`);
    params.push(input.material_id);
  }
  if (input.dominant_colors !== undefined) {
    sets.push(`dominant_colors = $${paramIndex++}`);
    params.push(JSON.stringify(input.dominant_colors));
  }

  if (sets.length === 0) return getWardrobeItem(itemId, userId);

  params.push(itemId, userId);

  const result = await pg.query<WardrobeItem>(
    `UPDATE wardrobe_items SET ${sets.join(", ")}, updated_at = NOW()
     WHERE id = $${paramIndex++} AND user_id = $${paramIndex}
     RETURNING *`,
    params
  );

  return result.rows[0] || null;
}

/**
 * Delete wardrobe item
 */
export async function deleteWardrobeItem(itemId: number, userId: number): Promise<boolean> {
  const result = await pg.query(
    `DELETE FROM wardrobe_items WHERE id = $1 AND user_id = $2`,
    [itemId, userId]
  );
  
  // Remove from OpenSearch
  try {
    await osClient.delete({
      index: "wardrobe_items",
      id: String(itemId),
      refresh: true
    });
  } catch (err) {
    // Ignore if not found
  }

  return (result.rowCount ?? 0) > 0;
}

// ============================================================================
// Embedding Indexing
// ============================================================================

/**
 * Index wardrobe item embedding in OpenSearch
 */
export async function indexWardrobeItemEmbedding(
  itemId: number,
  userId: number,
  embedding: number[]
): Promise<void> {
  try {
    await osClient.index({
      index: "wardrobe_items",
      id: String(itemId),
      body: {
        item_id: itemId,
        user_id: userId,
        embedding,
        indexed_at: new Date().toISOString()
      },
      refresh: true
    });
  } catch (err) {
    console.error("Failed to index wardrobe item embedding:", err);
  }
}

/**
 * Find similar items in user's wardrobe
 */
export async function findSimilarWardrobeItems(
  userId: number,
  embedding: number[],
  limit: number = 10,
  excludeItemId?: number
): Promise<Array<{ item_id: number; score: number }>> {
  try {
    const mustNot: any[] = [];
    if (excludeItemId) {
      mustNot.push({ term: { item_id: excludeItemId } });
    }

    const response = await osClient.search({
      index: "wardrobe_items",
      body: {
        size: limit,
        query: {
          bool: {
            must: {
              knn: {
                embedding: {
                  vector: embedding,
                  k: limit
                }
              }
            },
            filter: [
              { term: { user_id: userId } }
            ],
            must_not: mustNot
          }
        }
      }
    });

    return response.body.hits.hits.map((hit: any) => ({
      item_id: hit._source.item_id,
      score: hit._score
    }));
  } catch (err) {
    console.error("Error finding similar wardrobe items:", err);
    return [];
  }
}

/**
 * Bulk update embeddings for items missing them
 */
export async function backfillMissingEmbeddings(userId: number, batchSize: number = 50): Promise<number> {
  const result = await pg.query<{ id: number; image_cdn: string }>(
    `SELECT id, image_cdn FROM wardrobe_items 
     WHERE user_id = $1 AND embedding IS NULL AND image_cdn IS NOT NULL
     LIMIT $2`,
    [userId, batchSize]
  );

  let processed = 0;

  for (const row of result.rows) {
    try {
      const response = await fetch(row.image_cdn, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) continue;

      const buffer = Buffer.from(await response.arrayBuffer());
      const embedding = await processImageForEmbedding(buffer);

      await pg.query(
        `UPDATE wardrobe_items SET embedding = $1, attributes_extracted = true WHERE id = $2`,
        [embedding, row.id]
      );

      await indexWardrobeItemEmbedding(row.id, userId, embedding);
      processed++;
    } catch (err) {
      console.error(`Failed to backfill embedding for item ${row.id}:`, err);
    }
  }

  return processed;
}
