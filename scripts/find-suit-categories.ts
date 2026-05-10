import { pg } from "../src/lib/core/db";

async function querySuitBlazerCategories() {
  try {
    const result = await pg.query(`
      SELECT DISTINCT category
      FROM products
      WHERE 
          LOWER(COALESCE(title, '')) LIKE '%suit%'
          OR LOWER(COALESCE(title, '')) LIKE '%blazer%'
          OR LOWER(COALESCE(title, '')) LIKE '%tuxedo%'
          OR LOWER(COALESCE(title, '')) LIKE '%formal set%'

          OR LOWER(COALESCE(product_url, '')) LIKE '%suit%'
          OR LOWER(COALESCE(product_url, '')) LIKE '%blazer%'
          OR LOWER(COALESCE(product_url, '')) LIKE '%tuxedo%'

          OR LOWER(COALESCE(parent_product_url, '')) LIKE '%suit%'
          OR LOWER(COALESCE(parent_product_url, '')) LIKE '%blazer%'
          OR LOWER(COALESCE(parent_product_url, '')) LIKE '%tuxedo%'

          OR LOWER(COALESCE(description, '')) LIKE '%suit%'
          OR LOWER(COALESCE(description, '')) LIKE '%blazer%'
          OR LOWER(COALESCE(description, '')) LIKE '%tuxedo%'
          OR LOWER(COALESCE(description, '')) LIKE '%formal wear%'
          OR LOWER(COALESCE(description, '')) LIKE '%tailored%'
          OR LOWER(COALESCE(description, '')) LIKE '%lapel%'
          OR LOWER(COALESCE(description, '')) LIKE '%waistcoat%'
          OR LOWER(COALESCE(description, '')) LIKE '%vest%'
      ORDER BY category
    `);
    
    console.log('=== Distinct Categories Found ===\n');
    result.rows.forEach((r, i) => console.log(`${i + 1}. ${r.category}`));
    console.log(`\nTotal: ${result.rows.length} categories\n`);

    // Get product counts per category
    const countResult = await pg.query(`
      SELECT 
        category,
        COUNT(*) as product_count,
        COUNT(DISTINCT LOWER(COALESCE(title, ''))) as unique_titles
      FROM products
      WHERE 
          LOWER(COALESCE(title, '')) LIKE '%suit%'
          OR LOWER(COALESCE(title, '')) LIKE '%blazer%'
          OR LOWER(COALESCE(title, '')) LIKE '%tuxedo%'
          OR LOWER(COALESCE(title, '')) LIKE '%formal set%'

          OR LOWER(COALESCE(product_url, '')) LIKE '%suit%'
          OR LOWER(COALESCE(product_url, '')) LIKE '%blazer%'
          OR LOWER(COALESCE(product_url, '')) LIKE '%tuxedo%'

          OR LOWER(COALESCE(parent_product_url, '')) LIKE '%suit%'
          OR LOWER(COALESCE(parent_product_url, '')) LIKE '%blazer%'
          OR LOWER(COALESCE(parent_product_url, '')) LIKE '%tuxedo%'

          OR LOWER(COALESCE(description, '')) LIKE '%suit%'
          OR LOWER(COALESCE(description, '')) LIKE '%blazer%'
          OR LOWER(COALESCE(description, '')) LIKE '%tuxedo%'
          OR LOWER(COALESCE(description, '')) LIKE '%formal wear%'
          OR LOWER(COALESCE(description, '')) LIKE '%tailored%'
          OR LOWER(COALESCE(description, '')) LIKE '%lapel%'
          OR LOWER(COALESCE(description, '')) LIKE '%waistcoat%'
          OR LOWER(COALESCE(description, '')) LIKE '%vest%'
      GROUP BY category
      ORDER BY product_count DESC
    `);
    
    console.log('=== Categories with Product Counts ===\n');
    countResult.rows.forEach(r => {
      console.log(`${r.category}`);
      console.log(`  Products: ${r.product_count}, Unique Titles: ${r.unique_titles}`);
    });
    
    console.log('\n=== Summary ===');
    const totalProducts = countResult.rows.reduce((sum, r) => sum + r.product_count, 0);
    console.log(`Total products matching: ${totalProducts}`);
    console.log(`Unique categories: ${result.rows.length}`);
    
    process.exit(0);
  } catch(err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

querySuitBlazerCategories();
