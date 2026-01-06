import { pg } from "../src/lib/db";

async function main() {
  console.log("Checking for products.image_url column...");
  const res = await pg.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='image_url'`
  );
  if (res.rowCount > 0) {
    console.log("Column products.image_url already exists. Nothing to do.");
    process.exit(0);
  }

  console.log("Adding image_url column to products...");
  await pg.query(`ALTER TABLE products ADD COLUMN image_url TEXT`);
  console.log("Added products.image_url column.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
