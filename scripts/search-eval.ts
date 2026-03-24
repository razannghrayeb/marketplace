/**
 * Offline text search evaluation: run a query list, print JSON report.
 *
 * Usage:
 *   pnpm run search:eval
 *   pnpm run search:eval -- scripts/search-eval-queries.example.json
 *   pnpm run search:eval -- scripts/search-eval-queries.example.json scripts/search-eval-labels.example.json
 *
 * Requires DATABASE_URL, OS_NODE / OS_INDEX (and other search deps) in env.
 */

import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

type EvalQuery = { q: string; k?: number };

type LabelsMap = Record<string, string[]>;

function normalizeKey(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ");
}

function precisionAtK(retrieved: string[], relevant: Set<string>, k: number): number {
  if (k <= 0) return 0;
  const top = retrieved.slice(0, k);
  if (top.length === 0) return 0;
  let hits = 0;
  for (const id of top) {
    if (relevant.has(id)) hits += 1;
  }
  return hits / k;
}

function recallAtK(retrieved: string[], relevant: Set<string>, k: number): number {
  if (relevant.size === 0) return 0;
  const top = new Set(retrieved.slice(0, k));
  let hits = 0;
  for (const id of relevant) {
    if (top.has(id)) hits += 1;
  }
  return hits / relevant.size;
}

async function main(): Promise<void> {
  const queriesPath =
    process.argv[2] || path.join(process.cwd(), "scripts", "search-eval-queries.example.json");
  const labelsPath = process.argv[3];

  if (!fs.existsSync(queriesPath)) {
    console.error("Queries file not found:", queriesPath);
    process.exit(1);
  }

  const queries: EvalQuery[] = JSON.parse(fs.readFileSync(queriesPath, "utf8"));
  const rawLabels: LabelsMap =
    labelsPath && fs.existsSync(labelsPath) ? JSON.parse(fs.readFileSync(labelsPath, "utf8")) : {};

  const labelsByNorm = new Map<string, Set<string>>();
  for (const [key, ids] of Object.entries(rawLabels)) {
    labelsByNorm.set(normalizeKey(key), new Set(ids.map(String)));
  }

  const { textSearch } = await import("../src/routes/search/search.service");

  const report: {
    variant: string;
    queries: Array<{
      q: string;
      k: number;
      took_ms: number;
      total: number;
      hit_ids: string[];
      precision_at_k: number | null;
      recall_at_k: number | null;
    }>;
    aggregate: { mean_took_ms: number; mean_p_at_k: number | null; mean_r_at_k: number | null };
  } = {
    variant: process.env.SEARCH_EVAL_VARIANT || "default",
    queries: [],
    aggregate: { mean_took_ms: 0, mean_p_at_k: null, mean_r_at_k: null },
  };

  let sumP = 0;
  let sumR = 0;
  let nP = 0;
  let sumT = 0;

  for (const item of queries) {
    const k = item.k ?? 20;
    const res = await textSearch(item.q, undefined, {
      limit: k,
      offset: 0,
      includeRelated: false,
    });
    const hitIds = res.results.map((p) => String(p.id));
    const rel = labelsByNorm.get(normalizeKey(item.q));
    let precision_at_k: number | null = null;
    let recall_at_k: number | null = null;
    if (rel && rel.size > 0) {
      precision_at_k = precisionAtK(hitIds, rel, k);
      recall_at_k = recallAtK(hitIds, rel, k);
      sumP += precision_at_k;
      sumR += recall_at_k;
      nP += 1;
    }
    sumT += res.tookMs;
    report.queries.push({
      q: item.q,
      k,
      took_ms: res.tookMs,
      total: res.total,
      hit_ids: hitIds,
      precision_at_k,
      recall_at_k,
    });
  }

  const n = report.queries.length || 1;
  report.aggregate.mean_took_ms = Math.round(sumT / n);
  report.aggregate.mean_p_at_k = nP > 0 ? sumP / nP : null;
  report.aggregate.mean_r_at_k = nP > 0 ? sumR / nP : null;

  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
