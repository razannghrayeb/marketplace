/**
 * Migration: Create product_images table
 */
import "dotenv/config";
import { pg } from "../src/lib/db";

async function main() {
  console.log("Creating product_images table...");

  await pg.query(`
    CREATE TABLE IF NOT EXISTS product_images (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      r2_key TEXT NOT NULL,
      cdn_url TEXT NOT NULL,
      embedding FLOAT8[],
      p_hash TEXT,
      is_primary BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Create index for faster lookups
  await pg.query(`
    CREATE INDEX IF NOT EXISTS idx_product_images_product_id ON product_images(product_id)
  `);

  // Create unique index for r2_key to prevent duplicates
  await pg.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_product_images_r2_key ON product_images(r2_key)
  `);

  console.log("Created product_images table with indexes.");

  // Add primary_image_id to products for quick access to main image
  const colCheck = await pg.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='primary_image_id'`
  );
  if (colCheck.rowCount === 0) {
    console.log("Adding primary_image_id column to products...");
    await pg.query(`ALTER TABLE products ADD COLUMN primary_image_id INTEGER REFERENCES product_images(id)`);
  }

  console.log("Migration complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
