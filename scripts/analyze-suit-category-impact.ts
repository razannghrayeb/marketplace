import { pg } from "../src/lib/core/db";

async function analyzeImpact() {
  try {
    console.log("=== IMPACT ANALYSIS: Suit/Blazer Category Expansion ===\n");

    // Count products in new categories
    const newCategoriesList = [
      "suit-2p",
      "suit-2pnos",
      "suit-txd",
      "suit-sw",
      "men blazer",
      "men suits",
      "men vest",
      "women blazer",
      "lefon blazer",
      "lefon vest",
      "women coat",
      "women vest",
      "women cardigan",
    ];

    const categoryParams = newCategoriesList.map((c) => c.toLowerCase());

    const result = await pg.query(
      `SELECT 
        COUNT(*) as total_products,
        COUNT(DISTINCT LOWER(category)) as distinct_categories
      FROM products 
      WHERE LOWER(TRIM(category)) = ANY($1::text[])`,
      [categoryParams],
    );

    const { total_products, distinct_categories } = result.rows[0];

    console.log("NEW CATEGORIES ADDED:");
    newCategoriesList.forEach((cat) => console.log(`  • ${cat}`));

    console.log(`\nIMPACT:`);
    console.log(`  Products now discoverable: ${total_products}`);
    console.log(`  From ${distinct_categories} distinct categories\n`);

    // Breakdown by category
    const breakdown = await pg.query(
      `SELECT 
        LOWER(TRIM(category)) as category,
        COUNT(*) as product_count
      FROM products 
      WHERE LOWER(TRIM(category)) = ANY($1::text[])
      GROUP BY LOWER(TRIM(category))
      ORDER BY product_count DESC`,
      [categoryParams],
    );

    console.log("BREAKDOWN BY CATEGORY:");
    breakdown.rows.forEach((row) => {
      console.log(`  ${row.category}: ${row.product_count} products`);
    });

    console.log(`\n✓ Total increase: ${total_products} additional products will now appear in suit/blazer searches`);

    process.exit(0);
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  }
}

analyzeImpact();
