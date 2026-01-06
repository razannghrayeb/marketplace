/**
 * Migration: Canonicals, Price History, Product Flags
 * 
 * Creates tables for:
 * - canonical_products: Groups of duplicate/similar products
 * - price_history: Historical price snapshots
 * - Adds flags to products table (hidden, flagged, canonical_id)
 */
import "dotenv/config";
import { pg } from "../src/lib/db";

async function main() {
  console.log("Running canonicals migration...\n");

  // ============================================================================
  // 1. Canonical Products Table
  // ============================================================================
  console.log("Creating canonical_products table...");
  await pg.query(`
    CREATE TABLE IF NOT EXISTS canonical_products (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      brand TEXT,
      category TEXT,
      representative_image_url TEXT,
      representative_p_hash TEXT,
      product_count INTEGER DEFAULT 0,
      min_price_cents INTEGER,
      max_price_cents INTEGER,
      avg_price_cents INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Index for searching canonicals
  await pg.query(`
    CREATE INDEX IF NOT EXISTS idx_canonical_products_brand ON canonical_products(brand)
  `);
  await pg.query(`
    CREATE INDEX IF NOT EXISTS idx_canonical_products_category ON canonical_products(category)
  `);
  await pg.query(`
    CREATE INDEX IF NOT EXISTS idx_canonical_products_p_hash ON canonical_products(representative_p_hash)
  `);

  // ============================================================================
  // 2. Price History Table
  // ============================================================================
  console.log("Creating price_history table...");
  await pg.query(`
    CREATE TABLE IF NOT EXISTS price_history (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      price_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'LBP',
      sale_price_cents INTEGER,
      availability BOOLEAN NOT NULL DEFAULT true,
      recorded_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Indexes for price history queries
  await pg.query(`
    CREATE INDEX IF NOT EXISTS idx_price_history_product_id ON price_history(product_id)
  `);
  await pg.query(`
    CREATE INDEX IF NOT EXISTS idx_price_history_recorded_at ON price_history(recorded_at DESC)
  `);
  await pg.query(`
    CREATE INDEX IF NOT EXISTS idx_price_history_product_date ON price_history(product_id, recorded_at DESC)
  `);

  // ============================================================================
  // 3. Product Flags & Canonical Reference
  // ============================================================================
  console.log("Adding columns to products table...");

  // Add canonical_id column
  const canonicalCol = await pg.query(`
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='products' AND column_name='canonical_id'
  `);
  if (canonicalCol.rowCount === 0) {
    await pg.query(`
      ALTER TABLE products 
      ADD COLUMN canonical_id INTEGER REFERENCES canonical_products(id) ON DELETE SET NULL
    `);
  }

  // Add is_hidden flag
  const hiddenCol = await pg.query(`
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='products' AND column_name='is_hidden'
  `);
  if (hiddenCol.rowCount === 0) {
    await pg.query(`ALTER TABLE products ADD COLUMN is_hidden BOOLEAN DEFAULT false`);
  }

  // Add is_flagged flag (for manual review)
  const flaggedCol = await pg.query(`
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='products' AND column_name='is_flagged'
  `);
  if (flaggedCol.rowCount === 0) {
    await pg.query(`ALTER TABLE products ADD COLUMN is_flagged BOOLEAN DEFAULT false`);
  }

  // Add flag_reason for tracking why flagged
  const flagReasonCol = await pg.query(`
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='products' AND column_name='flag_reason'
  `);
  if (flagReasonCol.rowCount === 0) {
    await pg.query(`ALTER TABLE products ADD COLUMN flag_reason TEXT`);
  }

  // Add p_hash directly to products for faster dedup (cached from primary image)
  const pHashCol = await pg.query(`
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='products' AND column_name='p_hash'
  `);
  if (pHashCol.rowCount === 0) {
    await pg.query(`ALTER TABLE products ADD COLUMN p_hash TEXT`);
  }

  // Index for canonical lookups
  await pg.query(`
    CREATE INDEX IF NOT EXISTS idx_products_canonical_id ON products(canonical_id)
  `);
  await pg.query(`
    CREATE INDEX IF NOT EXISTS idx_products_is_hidden ON products(is_hidden) WHERE is_hidden = true
  `);
  await pg.query(`
    CREATE INDEX IF NOT EXISTS idx_products_is_flagged ON products(is_flagged) WHERE is_flagged = true
  `);
  await pg.query(`
    CREATE INDEX IF NOT EXISTS idx_products_p_hash ON products(p_hash) WHERE p_hash IS NOT NULL
  `);

  // ============================================================================
  // 4. Job Schedules Table (for tracking scheduled tasks)
  // ============================================================================
  console.log("Creating job_schedules table...");
  await pg.query(`
    CREATE TABLE IF NOT EXISTS job_schedules (
      id SERIAL PRIMARY KEY,
      job_name TEXT NOT NULL UNIQUE,
      cron_expression TEXT NOT NULL,
      last_run_at TIMESTAMPTZ,
      next_run_at TIMESTAMPTZ,
      is_enabled BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Insert default job schedules
  await pg.query(`
    INSERT INTO job_schedules (job_name, cron_expression, is_enabled)
    VALUES 
      ('nightly-crawl', '0 2 * * *', true),
      ('price-snapshot', '0 */6 * * *', true),
      ('canonical-recompute', '0 3 * * *', true)
    ON CONFLICT (job_name) DO NOTHING
  `);

  // ============================================================================
  // 5. Sync p_hash from product_images to products
  // ============================================================================
  console.log("Syncing p_hash from product_images to products...");
  await pg.query(`
    UPDATE products p
    SET p_hash = pi.p_hash
    FROM product_images pi
    WHERE pi.product_id = p.id 
      AND pi.is_primary = true 
      AND pi.p_hash IS NOT NULL
      AND p.p_hash IS NULL
  `);

  console.log("\n✓ Migration complete!");
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
