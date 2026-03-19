/**
 * Database Connection
 * 
 * PostgreSQL connection pool using pg library.
 */
import { Pool } from "pg";
import dns from "dns";
import { config } from "../../config";

// Force IPv4-first DNS resolution — avoids long IPv6 timeouts on Windows
// when connecting to cloud-hosted databases (Supabase, Neon, etc.)
dns.setDefaultResultOrder("ipv4first");

export const pg = new Pool({
  connectionString: config.database.url,
  ssl: {
    rejectUnauthorized: false,
  },
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 30000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

// Handle pool errors
pg.on("error", (err) => {
  console.error("Unexpected database pool error:", err);
});

/**
 * Test database connection
 */
export async function testConnection(): Promise<boolean> {
  try {
    await pg.query("SELECT 1");
    return true;
  } catch (error) {
    console.error("Database connection test failed:", error);
    return false;
  }
}


/**
 * Close database pool
 */
export async function closePool(): Promise<void> {
  await pg.end();
}

/**
 * Get products by IDs preserving the order of IDs
 */
export async function getProductsByIdsOrdered(ids: (number | string)[]): Promise<any[]> {
  if (ids.length === 0) return [];
  
  const numericIds = ids.map(id => typeof id === 'string' ? parseInt(id, 10) : id);
  
  const result = await pg.query(
    `SELECT p.*, v.name as vendor_name
     FROM products p
     LEFT JOIN vendors v ON v.id = p.vendor_id
     WHERE p.id = ANY($1::int[])`,
    [numericIds]
  );
  
  // Preserve order of input IDs
  const productMap = new Map(result.rows.map(p => [p.id, p]));
  return numericIds.map(id => productMap.get(id)).filter(Boolean);
}
