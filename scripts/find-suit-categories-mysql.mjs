import { createPool } from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function querySuitBlazerCategories() {
  let conn;
  try {
    const pool = await createPool({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });

    conn = await pool.getConnection();
    
    const [rows] = await conn.query(`
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
    rows.forEach((r, i) => console.log(`${i + 1}. ${r.category}`));
    console.log(`\nTotal: ${rows.length} categories\n`);

    // Get product counts per category
    const [countRows] = await conn.query(`
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
    countRows.forEach(r => {
      console.log(`${r.category}`);
      console.log(`  Products: ${r.product_count}, Unique Titles: ${r.unique_titles}`);
    });
    
    conn.release();
    process.exit(0);
  } catch(err) {
    console.error('Error:', err.message);
    if(conn) conn.release();
    process.exit(1);
  }
}

querySuitBlazerCategories();
