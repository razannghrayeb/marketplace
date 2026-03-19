import fs from 'fs/promises';
import path from 'path';
import { Pool } from 'pg';
import { pg as appPg } from '../src/lib/core/db';
import { config } from '../src/config';

async function run() {
  let pool: Pool | null = null;
  try {
    const migrationsDir = path.resolve(process.cwd(), 'db', 'migrations');
    const migrationFiles = (await fs.readdir(migrationsDir))
      .filter((file) => file.endsWith('.sql'))
      .sort((left, right) => left.localeCompare(right));

    if (migrationFiles.length === 0) {
      throw new Error('No migration files found in db/migrations');
    }

    // Get migration file from CLI arg or default to latest
    const migrationArg = process.argv[2];
    const migrationFile = migrationArg || migrationFiles[migrationFiles.length - 1];
    const filePath = path.resolve(migrationsDir, migrationFile);
    const sql = await fs.readFile(filePath, 'utf8');

    // Determine target DB connection info
    let targetDb = process.env.DATABASE_URL || config.database.url;
    if (!targetDb) {
      const host = process.env.PG_HOST || '0.0.0.0';
      const port = process.env.PG_PORT || 5432;
      const user = process.env.PG_USER || 'postgres';
      const password = process.env.PG_PASSWORD || 'postgres';
      const database = process.env.PG_DATABASE || 'fashion';
      targetDb = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
    }

    // Parse DB URL to get database name
    const parsed = new URL(targetDb);
    const targetDbName = parsed.pathname.replace('/', '') || 'fashion';

    // Try to create database if it doesn't exist by connecting to `postgres` maintenance DB
    const adminDbUrl = new URL(targetDb);
    adminDbUrl.pathname = '/postgres';

    const adminPool = new Pool({ connectionString: adminDbUrl.toString() });
    try {
      const check = await adminPool.query('SELECT 1 FROM pg_database WHERE datname = $1', [targetDbName]);
      if (check.rowCount === 0) {
        console.log(`Database ${targetDbName} does not exist — creating...`);
        // CREATE DATABASE cannot be parameterized for identifier; sanitize basic characters
        if (!/^[a-zA-Z0-9_\-]+$/.test(targetDbName)) {
          throw new Error('Unsafe database name: ' + targetDbName);
        }
        await adminPool.query(`CREATE DATABASE "${targetDbName}"`);
        console.log(`Database ${targetDbName} created.`);
      } else {
        console.log(`Database ${targetDbName} already exists.`);
      }
    } finally {
      await adminPool.end();
    }

    // Now connect to the target DB and apply migration
    pool = new Pool({ connectionString: targetDb });
    console.log('Applying migration:', filePath);
    await pool.query(sql);
    console.log('Migration applied successfully.');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  } finally {
    try {
      if (pool && pool !== (appPg as unknown as Pool)) {
        await pool.end();
      } else {
        await (appPg as any).end();
      }
    } catch (_) {}
  }
}

run();
