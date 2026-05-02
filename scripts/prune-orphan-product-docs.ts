/**
 * Prune orphan product documents from the OpenSearch catalog index.
 *
 * Use this after manual DB deletes or any data fix that bypassed the app's
 * normal OpenSearch sync hooks.
 *
 * Usage:
 *   pnpm run os:prune-orphans -- --dry-run
 *   pnpm run os:prune-orphans
 *   pnpm run os:prune-orphans -- --batch-size=1000
 */
import "dotenv/config";

import { pg, osClient } from "../src/lib/core";
import { config } from "../src/config";

interface Args {
  dryRun: boolean;
  batchSize: number;
  scrollTtl: string;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");

  const batchSizeArg = argv.find((arg) => arg.startsWith("--batch-size="));
  const scrollTtlArg = argv.find((arg) => arg.startsWith("--scroll-ttl="));

  const batchSize = batchSizeArg ? Number(batchSizeArg.split("=")[1]) : 500;
  const scrollTtl = scrollTtlArg ? scrollTtlArg.split("=")[1] : "2m";

  return {
    dryRun,
    batchSize: Number.isFinite(batchSize) && batchSize > 0 ? Math.floor(batchSize) : 500,
    scrollTtl: scrollTtl || "2m",
  };
}

function extractHitIds(response: any): string[] {
  const hits = response?.body?.hits?.hits;
  if (!Array.isArray(hits)) return [];
  return hits.map((hit: any) => String(hit?._id ?? "")).filter((id: string) => id.length > 0);
}

async function deleteMissingDocs(index: string, docIds: string[], dryRun: boolean): Promise<number> {
  if (docIds.length === 0) return 0;

  const numericIds = docIds
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id));

  if (numericIds.length === 0) return 0;

  const dbResult = await pg.query<{ id: number }>(
    `SELECT id FROM products WHERE id = ANY($1::int[])`,
    [numericIds],
  );

  const existingIds = new Set(dbResult.rows.map((row) => String(row.id)));
  const orphanIds = docIds.filter((id) => !existingIds.has(id));

  if (orphanIds.length === 0) return 0;

  if (dryRun) {
    console.log(`[dry-run] would delete ${orphanIds.length} orphan docs`, orphanIds.slice(0, 20));
    return orphanIds.length;
  }

  const body: Array<Record<string, unknown>> = [];
  for (const id of orphanIds) {
    body.push({ delete: { _index: index, _id: id } });
  }

  const response = await osClient.bulk({ body, refresh: false });
  const errors = response?.body?.errors === true;

  if (errors) {
    const items = response?.body?.items;
    const failed = Array.isArray(items)
      ? items.filter((item: any) => item?.delete?.error)
      : [];
    if (failed.length > 0) {
      console.warn(`[prune-orphans] ${failed.length} delete(s) reported errors in bulk response`);
    }
  }

  return orphanIds.length;
}

async function main() {
  const args = parseArgs();
  const index = config.opensearch.index;
  let scrollId: string | undefined;
  let totalSeen = 0;
  let totalDeleted = 0;

  try {
    let response = await osClient.search({
      index,
      scroll: args.scrollTtl,
      size: args.batchSize,
      body: {
        query: { match_all: {} },
        sort: ["_doc"],
        _source: false,
      },
    });

    scrollId = response?.body?._scroll_id;

    while (true) {
      const ids = extractHitIds(response);
      if (ids.length === 0) break;

      totalSeen += ids.length;
      totalDeleted += await deleteMissingDocs(index, ids, args.dryRun);

      if (!scrollId) break;

      response = await osClient.scroll({
        scroll_id: scrollId,
        scroll: args.scrollTtl,
      });
      scrollId = response?.body?._scroll_id ?? scrollId;
    }

    if (!args.dryRun && totalDeleted > 0) {
      await osClient.indices.refresh({ index });
    }

    console.log(
      JSON.stringify(
        {
          index,
          totalSeen,
          totalDeleted,
          dryRun: args.dryRun,
          note: "Delete stale OpenSearch product docs whose DB row is missing",
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error("[prune-orphans] failed:", error);
    process.exitCode = 1;
  } finally {
    if (scrollId) {
      try {
        await osClient.clearScroll({ scroll_id: scrollId });
      } catch {
        // best effort only
      }
    }
    try {
      await pg.end();
    } catch {
      // best effort only
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});