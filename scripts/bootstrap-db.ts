import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import { Pool } from "pg";

function logStep(message: string) {
  console.log(`\n[bootstrap-db] ${message}`);
}

async function readSql(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    throw new Error(`Failed to read SQL file: ${filePath}. ${(error as Error).message}`);
  }
}

function splitSqlStatements(sql: string): string[] {
  // Simple statement splitter for schema/migration files in this repo.
  // Handles semicolon-delimited statements and ignores empty chunks.
  return sql
    .split(/;\s*(?:\r?\n|$)/g)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
    .map((chunk) => `${chunk};`);
}

async function runSqlFile(pool: Pool, filePath: string): Promise<void> {
  const sql = await readSql(filePath);
  const fileName = path.basename(filePath);

  logStep(`Applying ${fileName}`);

  if (fileName === "schema.sql") {
    const statements = splitSqlStatements(sql);
    let applied = 0;
    let skipped = 0;

    for (const statement of statements) {
      try {
        await pool.query(statement);
        applied += 1;
      } catch (error) {
        const pgErr = error as { code?: string; message?: string };
        const isKnownDuplicateFk =
          pgErr.code === "42710" &&
          (pgErr.message || "").includes("fk_products_primary_image");

        if (isKnownDuplicateFk) {
          skipped += 1;
          console.warn(
            "[bootstrap-db] Skipping existing fk_products_primary_image constraint in schema.sql"
          );
          continue;
        }

        throw error;
      }
    }

    console.log(
      `[bootstrap-db] Applied ${fileName} (${applied} statements, ${skipped} skipped)`
    );
    return;
  }

  try {
    await pool.query(sql);
    console.log(`[bootstrap-db] Applied ${fileName}`);
  } catch (error) {
    const pgErr = error as { code?: string; message?: string };

    // schema.sql has one non-idempotent statement:
    // ALTER TABLE products ADD CONSTRAINT fk_products_primary_image ...
    // If rerunning on an existing DB, allow this specific duplicate and continue.
    const isKnownDuplicateFk =
      fileName === "schema.sql" &&
      pgErr.code === "42710" &&
      (pgErr.message || "").includes("fk_products_primary_image");

    if (isKnownDuplicateFk) {
      console.warn(
        "[bootstrap-db] schema.sql already applied (fk_products_primary_image exists). Continuing..."
      );
      return;
    }

    throw error;
  }
}

async function main() {
  const root = process.cwd();
  const schemaPath = path.resolve(root, "db", "schema.sql");
  const migrationsDir = path.resolve(root, "db", "migrations");

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required. Set it before running bootstrap.");
  }

  const migrationFiles = (await fs.readdir(migrationsDir))
    .filter((name) => name.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));

  if (migrationFiles.length === 0) {
    throw new Error("No SQL migration files found in db/migrations.");
  }

  const dryRun = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";

  logStep(`Schema file: ${schemaPath}`);
  logStep(`Found ${migrationFiles.length} migration files`);
  migrationFiles.forEach((f, i) => console.log(`[bootstrap-db]   ${i + 1}. ${f}`));

  if (dryRun) {
    logStep("DRY_RUN enabled. No SQL executed.");
    return;
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    await runSqlFile(pool, schemaPath);

    for (const migration of migrationFiles) {
      const migrationPath = path.resolve(migrationsDir, migration);
      await runSqlFile(pool, migrationPath);
    }

    logStep("Database bootstrap completed successfully.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[bootstrap-db] Failed:", error);
  process.exit(1);
});
