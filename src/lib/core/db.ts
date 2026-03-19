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

/**
 * Session-mode poolers (PgBouncer, some Cloud SQL / AlloyDB setups) cap clients at pool_size.
 * Node's pg default max=10 × Cloud Run concurrency exhausts that quickly → MaxClientsInSessionMode.
 * Override anytime with PG_POOL_MAX (e.g. 2 if your pooler allows it).
 */
function resolvePoolMax(): number {
  const raw = process.env.PG_POOL_MAX;
  if (raw !== undefined && raw !== "") {
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }
  if (process.env.K_SERVICE) {
    return 1;
  }
  return 10;
}

export const pg = new Pool({
  connectionString: config.database.url,
  max: resolvePoolMax(),
  ssl: {
    rejectUnauthorized: false,
  },
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 30000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

let cachedProductsHasIsHidden: boolean | undefined;

/** Cached once per process; avoids 42703 when prod DB is behind migrations. */
export async function productsTableHasIsHiddenColumn(): Promise<boolean> {
  if (cachedProductsHasIsHidden !== undefined) {
    return cachedProductsHasIsHidden;
  }
  const r = await pg.query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'products'
       AND column_name = 'is_hidden'
     LIMIT 1`
  );
  cachedProductsHasIsHidden = (r.rowCount ?? 0) > 0;
  return cachedProductsHasIsHidden;
}

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
