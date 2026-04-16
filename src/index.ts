import "dotenv/config";
import { createServer } from "./server";
import { testConnection } from "./lib/core/db";
import { setupSchedules } from "./lib/scheduler";
import { createWorker } from "./lib/worker";

/**
 * Without DATABASE_URL, `pg` falls back to localhost:5432 and every route that
 * touches the DB fails. Fail fast with a clear fix instead of "listening" on :4000.
 */
function assertDatabaseUrlConfigured(): void {
  if (process.env.SKIP_DATABASE_URL_CHECK === "1") {
    console.warn(
      "[config] SKIP_DATABASE_URL_CHECK=1 — skipping DATABASE_URL check (DB routes may fail).",
    );
    return;
  }
  const url = (process.env.DATABASE_URL || "").trim();
  if (url) return;

  console.error(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  DATABASE_URL is missing or empty

  Create or edit:  ${process.cwd()}\\.env

  1) Copy .env.example to .env
  2) Set DATABASE_URL from Supabase (or any Postgres):
     Dashboard → Project Settings → Database → Connection string → URI
     Tip: use Transaction pooler (:6543) for local API dev.

  Frontend (apps/marketplace) also needs the same DB for login if you use
  NEXT_PUBLIC_API_URL=http://localhost:4000

  Escape hatch (not recommended):  SKIP_DATABASE_URL_CHECK=1
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
  process.exit(1);
}

async function main() {
  assertDatabaseUrlConfigured();
  const ok = await testConnection();
  console.log("Database reachable:", ok);
  if (!ok) {
    console.error(
      "[pg] Fix DATABASE_URL (wrong password, host, or pooler limits) and restart.",
    );
    process.exit(1);
  }

  // Start the job scheduler (registers recurring jobs in Redis)
  await setupSchedules();
  console.log("Scheduler started.");

  // Start the worker (listens for jobs and runs them)
  createWorker();
  console.log("Worker started.");
}

const port = Number(process.env.PORT || 4000);

main().then(() => {
  return createServer();
})
    .then((app) => {
      const server = app.listen(port, () => {
        console.log(`api listening on :${port}`);
      });

      server.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          console.error(
            `\nPort ${port} is already in use (another API process?).\n` +
              `  • Stop the other process, or\n` +
              `  • Use a different port:  PowerShell:  $env:PORT=4010; pnpm dev\n`,
          );
          process.exit(1);
        }
        throw err;
      });

      process.on("SIGINT", () => {
        console.log("Shutting down...");
        server.close(() => process.exit(0));
      });
    })
    .catch((err) => {
      console.error("fatal boot error", err);
      process.exit(1);
    });
