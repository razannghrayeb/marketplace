import { pg } from '../src/lib/core/db.js';

async function getOuterwearCategories() {
  try {
    const result = await pg.query(`
      SELECT DISTINCT category 
      FROM products 
      WHERE category IS NOT NULL 
        AND (category ILIKE '%blazer%' 
          OR category ILIKE '%suit%' 
          OR category ILIKE '%coat%' 
          OR category ILIKE '%jacket%' 
          OR category ILIKE '%vest%' 
          OR category ILIKE '%outerwear%'
          OR category ILIKE '%parka%'
          OR category ILIKE '%cardigan%')
      ORDER BY category
    `);
    
    console.log('Found categories:');
    result.rows.forEach(r => console.log(`  - ${r.category}`));
    console.log(`\nTotal: ${result.rows.length} categories`);
    
    // Count products per category
    const countResult = await pg.query(`
      SELECT category, COUNT(*) as count
      FROM products 
      WHERE category IS NOT NULL 
        AND (category ILIKE '%blazer%' 
          OR category ILIKE '%suit%' 
          OR category ILIKE '%coat%' 
          OR category ILIKE '%jacket%' 
          OR category ILIKE '%vest%' 
          OR category ILIKE '%outerwear%'
          OR category ILIKE '%parka%'
          OR category ILIKE '%cardigan%')
      GROUP BY category
      ORDER BY count DESC
    `);
    
    console.log('\n\nCategories with product counts:');
    countResult.rows.forEach(r => console.log(`  ${r.category}: ${r.count} products`));
    
    process.exit(0);
  } catch(err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

getOuterwearCategories();
