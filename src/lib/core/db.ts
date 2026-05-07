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
 * Session-mode poolers (PgBouncer, Supabase pooler on :5432) cap clients at pool_size.
 * Node's pg default max=10 × many instances → MaxClientsInSessionMode.
 * Override anytime with PG_POOL_MAX (e.g. 1 for Supabase session mode).
 */
function resolvePoolMax(): number {
  const raw = process.env.PG_POOL_MAX?.trim();
  if (raw !== undefined && raw !== "") {
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  const dbUrl = process.env.DATABASE_URL || "";
  // Supabase transaction pooler (6543) can handle more; session pooler (5432) cannot.
  const isSupabaseSessionPooler =
    /pooler\.supabase\.com/i.test(dbUrl) &&
    !/:6543\b/.test(dbUrl) &&
    !/transaction/i.test(dbUrl);

  if (isSupabaseSessionPooler || /pgbouncer=true/i.test(dbUrl)) {
    return 1;
  }

  if (process.env.K_SERVICE) {
    return 1;
  }

  if (process.env.NODE_ENV === "production") {
    return 10;
  }

  return 10;
}

/** True for PgBouncer / Supabase session pool "max clients" style errors */
export function isPgCapacityError(err: unknown): boolean {
  const msg = String((err as Error)?.message || "").toLowerCase();
  return (
    msg.includes("maxclientsinsessionmode") ||
    msg.includes("max clients reached") ||
    msg.includes("too many connections")
  );
}

/**
 * Retry a DB operation when the pooler rejects new sessions (transient under load).
 */
export async function queryWithPgCapacityRetry<T>(
  label: string,
  fn: () => Promise<T>,
  opts?: { attempts?: number; baseDelayMs?: number },
): Promise<T> {
  const attempts = opts?.attempts ?? 8;
  const baseDelayMs = opts?.baseDelayMs ?? 400;
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isPgCapacityError(err) || i === attempts) {
        throw err;
      }
      const delay = Math.min(30_000, baseDelayMs * i);
      console.warn(
        `[pg] ${label}: pooler capacity (${i}/${attempts}) — retry in ${delay}ms`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
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
let cachedProductsHasCanonicalId: boolean | undefined;
let cachedProductsHasGender: boolean | undefined;

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

/** Cached once per process. */
export async function productsTableHasCanonicalIdColumn(): Promise<boolean> {
  if (cachedProductsHasCanonicalId !== undefined) {
    return cachedProductsHasCanonicalId;
  }
  const r = await pg.query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'products'
       AND column_name = 'canonical_id'
     LIMIT 1`
  );
  cachedProductsHasCanonicalId = (r.rowCount ?? 0) > 0;
  return cachedProductsHasCanonicalId;
}

/** Cached once per process; `gender` added in migration 013_products_gender.sql. */
export async function productsTableHasGenderColumn(): Promise<boolean> {
  if (cachedProductsHasGender !== undefined) {
    return cachedProductsHasGender;
  }
  const r = await pg.query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'products'
       AND column_name = 'gender'
     LIMIT 1`
  );
  cachedProductsHasGender = (r.rowCount ?? 0) > 0;
  return cachedProductsHasGender;
}

// Handle pool errors
pg.on("error", (err) => {
  console.error("Unexpected database pool error:", err);
});

/**
 * Serialize a float embedding for pgvector `vector` columns.
 * node-pg binds JS arrays as PostgreSQL float8[]; its text form is not valid for the `vector` type.
 * Use the returned value as a query parameter and cast the placeholder, e.g. `$1::vector`.
 */
export function toPgVectorParam(embedding: number[] | null | undefined): string | null {
  if (embedding == null || embedding.length === 0) return null;
  return `[${embedding.join(",")}]`;
}

/** Short hints for common Supabase/pg auth failures (no secrets logged). */
function databaseConnectionHints(err: unknown): string[] {
  const e = err as { code?: string; message?: string };
  const code = e?.code ?? "";
  const msg = String(e?.message ?? "").toLowerCase();
  const url = process.env.DATABASE_URL?.trim() ?? "";
  const hints: string[] = [];

  if (!url) {
    hints.push("DATABASE_URL is missing or empty — set it in .env (Supabase: Settings → Database → connection string).");
    return hints;
  }

  if (
    code === "ECONNREFUSED" ||
    msg.includes("econnrefused") ||
    msg.includes("connect econnrefused")
  ) {
    hints.push(
      "Nothing accepted the connection at the host:port in DATABASE_URL — Postgres not running locally, wrong port, or firewall/VPN.",
    );
    hints.push(
      "If the host is 127.0.0.1:5432, start local Postgres or switch DATABASE_URL to your Supabase pooler URI.",
    );
  }

  if (code === "08006" || msg.includes("authentication") || msg.includes("password")) {
    hints.push(
      "Check password: copy the database password from Supabase (not the anon/service API keys).",
    );
    hints.push(
      "If the password has @ # % + etc., URL-encode it inside DATABASE_URL.",
    );
    hints.push(
      "Pooler: use the exact user from the dashboard (often postgres.<project-ref> on pooler hosts). Wrong user causes auth failures.",
    );
    hints.push(
      "Try transaction pooler port 6543 vs direct 5432 if one fails; set PG_POOL_MAX=1 for session pooler (:5432 pooler).",
    );
  }

  if (code === "ENOTFOUND" || msg.includes("getaddrinfo")) {
    hints.push("DNS/host typo in DATABASE_URL, or offline VPN/firewall blocking the DB host.");
  }

  return hints;
}

/**
 * Test database connection
 */
export async function testConnection(): Promise<boolean> {
  try {
    await pg.query("SELECT 1");
    return true;
  } catch (error) {
    console.error("Database connection test failed:", error);
    const hints = databaseConnectionHints(error);
    if (hints.length > 0) {
      console.error("[pg] Troubleshooting:\n  - " + hints.join("\n  - "));
    }
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
     WHERE p.id = ANY($1::bigint[])`,
    [numericIds]
  );
  
  // Preserve order of input IDs
  // Postgres may return `p.id` as a string (e.g. "8491") while `numericIds`
  // are numbers. Normalize keys to string to preserve order reliably.
  const productMap = new Map(result.rows.map(p => [String(p.id), p]));
  return numericIds.map(id => productMap.get(String(id))).filter(Boolean);
}

/**
 * Lightweight projection for search result cards.
 *
 * Avoid `SELECT p.*` on real-time search paths: product descriptions and other
 * enrichment blobs can be large, and the UI only needs card/list metadata here.
 */
export async function getSearchProductsByIdsOrdered(ids: (number | string)[]): Promise<any[]> {
  if (ids.length === 0) return [];

  const numericIds = ids
    .map((id) => (typeof id === "string" ? parseInt(id, 10) : id))
    .filter((id) => Number.isFinite(id));
  if (numericIds.length === 0) return [];

  // Hydration step: fetch only essential Shop page fields
  const result = await pg.query(
    `SELECT
       p.id,
       p.title,
       p.brand,
       p.category,
       p.color,
       COALESCE(p.currency, 'USD') AS currency,
       p.price_cents,
       p.sales_price_cents,
       p.image_url,
       p.image_cdn
     FROM products p
     WHERE p.id = ANY($1::bigint[])`,
    [numericIds],
  );

  const productMap = new Map(result.rows.map((p) => [String(p.id), p]));
  return numericIds.map((id) => productMap.get(String(id))).filter(Boolean);
}
