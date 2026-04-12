/**
 * Automatic Wardrobe Sync Service
 *
 * Automatically syncs purchases to user's wardrobe.
 * When a user completes a purchase, this service:
 * 1. Detects if the item is wearable (not accessories, bags, etc.)
 * 2. Auto-categorizes using AI image recognition
 * 3. Adds to wardrobe with purchase metadata
 * 4. Generates CLIP embeddings for similarity search
 */

import { pg, toPgVectorParam } from '../core/db';
import { getYOLOv8Client, type Detection } from '../image/yolov8Client';
import { mapDetectionToCategory } from '../detection/categoryMapper';
import { processImageForEmbedding } from '../image/processor';

// ============================================================================
// Types
// ============================================================================

export interface PurchaseItem {
  productId: number;
  orderId: string;
  userId: number;
  imageUrl?: string;
  imageBuffer?: Buffer;
  title: string;
  brand?: string;
  price: number;
  purchasedAt: Date;
}

export interface AutoSyncResult {
  success: boolean;
  wardrobeItemId?: number;
  skipped?: boolean;
  reason?: string;
  detectedCategory?: string;
  confidence?: number;
}

export interface AutoSyncConfig {
  minConfidence: number;          // Minimum detection confidence (default: 0.7)
  syncAccessories: boolean;       // Whether to sync accessories (default: false)
  syncBags: boolean;              // Whether to sync bags (default: false)
  enableAutoCategory: boolean;    // Enable AI categorization (default: true)
  skipIfExists: boolean;          // Skip if item already in wardrobe (default: true)
}

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_CONFIG: AutoSyncConfig = {
  minConfidence: 0.7,
  syncAccessories: false,
  syncBags: false,
  enableAutoCategory: true,
  skipIfExists: true,
};

// Wearable categories (items that should go in wardrobe)
const WEARABLE_CATEGORIES = new Set([
  'top', 'shirt', 'blouse', 't-shirt', 'tee', 'tank top', 'crop top', 'cami',
  'bottom', 'pants', 'jeans', 'trousers', 'shorts', 'skirt', 'leggings',
  'dress', 'gown', 'maxi dress', 'mini dress', 'midi dress', 'sundress',
  'outerwear', 'jacket', 'coat', 'blazer', 'cardigan', 'sweater', 'hoodie',
  'footwear', 'shoes', 'sneakers', 'boots', 'heels', 'sandals', 'flats',
  'activewear', 'sportswear', 'swimwear', 'bikini', 'swimsuit',
]);

const ACCESSORY_CATEGORIES = new Set([
  'jewelry', 'necklace', 'bracelet', 'earrings', 'ring', 'watch',
  'belt', 'scarf', 'hat', 'cap', 'beanie', 'sunglasses',
  'gloves', 'socks', 'tie', 'bow tie',
]);

const BAG_CATEGORIES = new Set([
  'bag', 'handbag', 'purse', 'clutch', 'tote', 'backpack', 'crossbody',
  'messenger bag', 'shoulder bag', 'satchel', 'wallet',
]);

// ============================================================================
// Main Sync Function
// ============================================================================

/**
 * Automatically sync a purchased item to user's wardrobe
 */
export async function syncPurchaseToWardrobe(
  purchase: PurchaseItem,
  config: Partial<AutoSyncConfig> = {}
): Promise<AutoSyncResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  try {
    // Step 1: Check if item already exists in wardrobe
    if (cfg.skipIfExists) {
      const exists = await checkWardrobeExists(purchase.userId, purchase.productId);
      if (exists) {
        return {
          success: true,
          skipped: true,
          reason: 'Item already in wardrobe',
        };
      }
    }

    // Step 2: Get image for AI analysis
    let imageBuffer: Buffer | undefined;
    if (purchase.imageBuffer) {
      imageBuffer = purchase.imageBuffer;
    } else if (purchase.imageUrl) {
      imageBuffer = await fetchImageBuffer(purchase.imageUrl);
    } else {
      // No image available, skip AI detection
      return await syncWithoutDetection(purchase);
    }

    // Step 3: Run AI detection to categorize
    let detectedCategory: string | undefined;
    let confidence: number = 0;

    if (cfg.enableAutoCategory && imageBuffer) {
      const detection = await detectAndCategorizeItem(imageBuffer, cfg.minConfidence);

      if (detection) {
        detectedCategory = detection.category;
        confidence = detection.confidence;

        // Step 4: Check if item should be synced based on category
        const shouldSync = shouldSyncCategory(
          detectedCategory,
          cfg.syncAccessories,
          cfg.syncBags
        );

        if (!shouldSync) {
          return {
            success: true,
            skipped: true,
            reason: `Category '${detectedCategory}' not configured for auto-sync`,
            detectedCategory,
            confidence,
          };
        }
      } else {
        // Low confidence or detection failed
        return {
          success: false,
          reason: 'AI detection confidence too low',
          confidence,
        };
      }
    }

    // Step 5: Generate CLIP embedding
    const embedding = imageBuffer ? await processImageForEmbedding(imageBuffer) : null;

    // Step 6: Create wardrobe item
    const wardrobeItemId = await createWardrobeEntry({
      userId: purchase.userId,
      productId: purchase.productId,
      orderId: purchase.orderId,
      name: purchase.title,
      brand: purchase.brand,
      category: detectedCategory,
      imageUrl: purchase.imageUrl,
      purchasePrice: purchase.price,
      purchasedAt: purchase.purchasedAt,
      embedding,
      source: 'auto_sync',
      autoDetectionConfidence: confidence,
    });

    return {
      success: true,
      wardrobeItemId,
      detectedCategory,
      confidence,
    };

  } catch (error) {
    console.error('[AutoSync] Error syncing purchase:', error);
    return {
      success: false,
      reason: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Batch sync multiple purchases
 */
export async function batchSyncPurchases(
  purchases: PurchaseItem[],
  config: Partial<AutoSyncConfig> = {}
): Promise<AutoSyncResult[]> {
  const results: AutoSyncResult[] = [];

  for (const purchase of purchases) {
    const result = await syncPurchaseToWardrobe(purchase, config);
    results.push(result);
  }

  return results;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if product already exists in user's wardrobe
 */
async function checkWardrobeExists(userId: number, productId: number): Promise<boolean> {
  const result = await pg.query(
    `SELECT 1 FROM wardrobe_items WHERE user_id = $1 AND product_id = $2 LIMIT 1`,
    [userId, productId]
  );
  return result.rowCount !== null && result.rowCount > 0;
}

/**
 * Fetch image from URL
 */
async function fetchImageBuffer(imageUrl: string): Promise<Buffer> {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Detect and categorize fashion item using AI
 */
async function detectAndCategorizeItem(
  imageBuffer: Buffer,
  minConfidence: number
): Promise<{ category: string; confidence: number } | null> {
  try {
    // Run YOLO detection using client
    const client = getYOLOv8Client();
    const response = await client.detectFromBuffer(imageBuffer);

    if (!response.detections || response.detections.length === 0) {
      return null;
    }

    // Get highest confidence detection
    const bestDetection = response.detections.reduce((best, current) =>
      current.confidence > best.confidence ? current : best
    );

    if (bestDetection.confidence < minConfidence) {
      return null;
    }

    // Map YOLO label to our category system
    const categoryMapping = mapDetectionToCategory(bestDetection.label, bestDetection.confidence, {
      box_normalized: (bestDetection as any).box_normalized,
    });

    return {
      category: categoryMapping.productCategory,
      confidence: categoryMapping.confidence,
    };
  } catch (error) {
    console.error('[AutoSync] Detection error:', error);
    return null;
  }
}

/**
 * Determine if category should be synced to wardrobe
 */
function shouldSyncCategory(
  category: string,
  syncAccessories: boolean,
  syncBags: boolean
): boolean {
  const normalizedCategory = category.toLowerCase();

  // Check if it's a wearable
  if (WEARABLE_CATEGORIES.has(normalizedCategory)) {
    return true;
  }

  // Check accessories
  if (ACCESSORY_CATEGORIES.has(normalizedCategory)) {
    return syncAccessories;
  }

  // Check bags
  if (BAG_CATEGORIES.has(normalizedCategory)) {
    return syncBags;
  }

  // Default: don't sync unknown categories
  return false;
}

/**
 * Sync without AI detection (fallback)
 */
async function syncWithoutDetection(purchase: PurchaseItem): Promise<AutoSyncResult> {
  const wardrobeItemId = await createWardrobeEntry({
    userId: purchase.userId,
    productId: purchase.productId,
    orderId: purchase.orderId,
    name: purchase.title,
    brand: purchase.brand,
    purchasePrice: purchase.price,
    purchasedAt: purchase.purchasedAt,
    source: 'auto_sync',
  });

  return {
    success: true,
    wardrobeItemId,
    reason: 'Synced without AI detection',
  };
}

/**
 * Create wardrobe entry in database
 */
async function createWardrobeEntry(data: {
  userId: number;
  productId?: number;
  orderId?: string;
  name: string;
  brand?: string;
  category?: string;
  imageUrl?: string;
  purchasePrice?: number;
  purchasedAt?: Date;
  embedding?: number[] | null;
  source: string;
  autoDetectionConfidence?: number;
}): Promise<number> {
  const result = await pg.query(
    `INSERT INTO wardrobe_items (
      user_id, product_id, order_id, name, brand, category,
      image_url, purchase_price, purchased_at, embedding,
      source, auto_detection_confidence, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::vector, $11, $12, NOW())
    RETURNING id`,
    [
      data.userId,
      data.productId || null,
      data.orderId || null,
      data.name,
      data.brand || null,
      data.category || null,
      data.imageUrl || null,
      data.purchasePrice || null,
      data.purchasedAt || null,
      toPgVectorParam(data.embedding ?? null),
      data.source,
      data.autoDetectionConfidence || null,
    ]
  );

  return result.rows[0].id;
}

/**
 * Get user's auto-sync settings
 */
export async function getUserAutoSyncSettings(userId: number): Promise<AutoSyncConfig> {
  const result = await pg.query(
    `SELECT auto_sync_config FROM user_preferences WHERE user_id = $1`,
    [userId]
  );

  if (result.rowCount === 0) {
    return DEFAULT_CONFIG;
  }

  const storedConfig = result.rows[0].auto_sync_config;
  return storedConfig ? { ...DEFAULT_CONFIG, ...storedConfig } : DEFAULT_CONFIG;
}

/**
 * Update user's auto-sync settings
 */
export async function updateUserAutoSyncSettings(
  userId: number,
  config: Partial<AutoSyncConfig>
): Promise<void> {
  await pg.query(
    `INSERT INTO user_preferences (user_id, auto_sync_config, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id)
     DO UPDATE SET auto_sync_config = $2, updated_at = NOW()`,
    [userId, JSON.stringify(config)]
  );
}
