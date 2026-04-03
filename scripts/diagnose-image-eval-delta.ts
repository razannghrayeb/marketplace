import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";

type PerQuery = {
  queryId: string;
  queryTitle?: string;
  queryCategory?: string | null;
  queryTypes?: string[];
  topIds: string[];
  sameCategoryRate?: number;
  typeConsistencyRate?: number;
  unrelatedRate?: number;
  finalRelevance01Mean?: number;
  finalRelevance01At1?: number;
};

type EvalFile = {
  sampledQueries: number;
  k: number;
  metrics?: Record<string, number>;
  perQuery: PerQuery[];
};

type ProductLite = {
  id: string;
  color: string | null;
};

function parseArg(name: string, fallback: string): string {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return fallback;
}

function avg(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function pct(x: number): string {
  return `${(x * 100).toFixed(2)}%`;
}

function normalizeColor(c: string | null | undefined): string | null {
  const s = String(c ?? "").trim().toLowerCase();
  if (!s) return null;
  return s;
}

function overlapAtK(a: string[], b: string[], k: number): number {
  const aa = new Set(a.slice(0, k));
  const bb = new Set(b.slice(0, k));
  let inter = 0;
  for (const id of aa) {
    if (bb.has(id)) inter++;
  }
  return inter / Math.max(1, k);
}

function getFinalRelValue(x: PerQuery): number | null {
  if (typeof x.finalRelevance01Mean === "number") return x.finalRelevance01Mean;
  if (typeof x.finalRelevance01At1 === "number") return x.finalRelevance01At1;
  return null;
}

async function maybeLoadProductLite(ids: string[]): Promise<Map<string, ProductLite>> {
  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.DB_URL;
  if (!dbUrl) return new Map();

  const pool = new Pool({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
    max: 2,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 20_000,
  });

  try {
    const res = await pool.query(
      `SELECT id::text AS id, color
       FROM products
       WHERE id = ANY($1::bigint[])`,
      [ids.map((x) => Number(x)).filter((n) => Number.isFinite(n))],
    );
    const m = new Map<string, ProductLite>();
    for (const r of res.rows) {
      m.set(String(r.id), { id: String(r.id), color: r.color ?? null });
    }
    return m;
  } catch {
    return new Map();
  } finally {
    await pool.end().catch(() => {});
  }
}

async function main(): Promise<void> {
  const beforePath = parseArg("--before", "tmp-image-eval-before.json");
  const afterPath = parseArg("--after", "tmp-image-eval-after.json");
  const topN = Number(parseArg("--top", "10"));

  const beforeRaw = await readFile(path.resolve(beforePath), "utf-8");
  const afterRaw = await readFile(path.resolve(afterPath), "utf-8");
  const before = JSON.parse(beforeRaw) as EvalFile;
  const after = JSON.parse(afterRaw) as EvalFile;

  const k = Math.min(before.k || 20, after.k || 20);
  const bMap = new Map(before.perQuery.map((q) => [String(q.queryId), q]));
  const aMap = new Map(after.perQuery.map((q) => [String(q.queryId), q]));
  const commonIds = [...bMap.keys()].filter((id) => aMap.has(id));

  const allIds = new Set<string>();
  for (const id of commonIds) {
    allIds.add(id);
    for (const x of bMap.get(id)?.topIds ?? []) allIds.add(String(x));
    for (const x of aMap.get(id)?.topIds ?? []) allIds.add(String(x));
  }
  const productLite = await maybeLoadProductLite([...allIds]);

  const rows = commonIds.map((id) => {
    const b = bMap.get(id)!;
    const a = aMap.get(id)!;

    const dSame = (a.sameCategoryRate ?? 0) - (b.sameCategoryRate ?? 0);
    const dType = (a.typeConsistencyRate ?? 0) - (b.typeConsistencyRate ?? 0);
    const dUnrel = (a.unrelatedRate ?? 0) - (b.unrelatedRate ?? 0);

    const qColor = normalizeColor(productLite.get(id)?.color ?? null);
    const colorBefore = qColor
      ? b.topIds.slice(0, k).filter((pid) => normalizeColor(productLite.get(String(pid))?.color) === qColor).length / k
      : null;
    const colorAfter = qColor
      ? a.topIds.slice(0, k).filter((pid) => normalizeColor(productLite.get(String(pid))?.color) === qColor).length / k
      : null;

    const bFr = getFinalRelValue(b);
    const aFr = getFinalRelValue(a);
    const dFr = bFr != null && aFr != null ? aFr - bFr : null;

    return {
      id,
      title: a.queryTitle || b.queryTitle || "",
      dSame,
      dType,
      dUnrel,
      overlap: overlapAtK(b.topIds, a.topIds, k),
      colorBefore,
      colorAfter,
      dColor: colorBefore != null && colorAfter != null ? colorAfter - colorBefore : null,
      dFinalRelevance: dFr,
    };
  });

  const dSameAll = avg(rows.map((r) => r.dSame));
  const dTypeAll = avg(rows.map((r) => r.dType));
  const dUnrelAll = avg(rows.map((r) => r.dUnrel));
  const overlapAll = avg(rows.map((r) => r.overlap));

  const colorRows = rows.filter((r) => r.dColor != null) as Array<typeof rows[number] & { dColor: number }>;
  const dColorAll = colorRows.length > 0 ? avg(colorRows.map((r) => r.dColor)) : null;

  const finalRelRows = rows.filter((r) => r.dFinalRelevance != null) as Array<typeof rows[number] & { dFinalRelevance: number }>;
  const dFrAll = finalRelRows.length > 0 ? avg(finalRelRows.map((r) => r.dFinalRelevance)) : null;

  console.log("=".repeat(88));
  console.log("TOP-K BEFORE/AFTER DIAGNOSTICS");
  console.log("=".repeat(88));
  console.log(`Compared queries: ${commonIds.length}`);
  console.log(`K: ${k}`);
  console.log("");

  console.log("Aggregate deltas (after - before):");
  console.log(`  sameCategoryRate@K     : ${pct(dSameAll)} (${before.metrics?.sameCategoryRateAtK?.toFixed(4)} -> ${after.metrics?.sameCategoryRateAtK?.toFixed(4)})`);
  console.log(`  typeConsistencyRate@K  : ${pct(dTypeAll)} (${before.metrics?.typeConsistencyRateAtK?.toFixed(4)} -> ${after.metrics?.typeConsistencyRateAtK?.toFixed(4)})`);
  console.log(`  unrelatedRate@K        : ${pct(dUnrelAll)} (${before.metrics?.unrelatedRateAtK?.toFixed(4)} -> ${after.metrics?.unrelatedRateAtK?.toFixed(4)})`);
  console.log(`  topK overlap           : ${pct(overlapAll)} (stability)`);
  if (dColorAll != null) {
    console.log(`  colorAgreement@K       : ${pct(dColorAll)} (computed from products.color)`);
  } else {
    console.log("  colorAgreement@K       : n/a (missing DB connectivity or query colors)");
  }
  if (dFrAll != null) {
    console.log(`  finalRelevance01 delta : ${dFrAll.toFixed(4)} (after - before)`);
  } else {
    console.log("  finalRelevance01 delta : n/a (not present in snapshot files)");
  }

  const byGain = [...rows].sort((a, b) => (b.dSame + b.dType - b.dUnrel) - (a.dSame + a.dType - a.dUnrel));
  const byDrop = [...rows].sort((a, b) => (a.dSame + a.dType - a.dUnrel) - (b.dSame + b.dType - b.dUnrel));

  console.log("\nTop improvements:");
  for (const r of byGain.slice(0, Math.max(1, topN))) {
    console.log(
      `  q=${r.id} | dSame=${pct(r.dSame)} dType=${pct(r.dType)} dUnrel=${pct(r.dUnrel)} dColor=${r.dColor != null ? pct(r.dColor) : "n/a"} overlap=${pct(r.overlap)} | ${r.title}`,
    );
  }

  console.log("\nTop regressions:");
  for (const r of byDrop.slice(0, Math.max(1, topN))) {
    console.log(
      `  q=${r.id} | dSame=${pct(r.dSame)} dType=${pct(r.dType)} dUnrel=${pct(r.dUnrel)} dColor=${r.dColor != null ? pct(r.dColor) : "n/a"} overlap=${pct(r.overlap)} | ${r.title}`,
    );
  }
}

main().catch((err) => {
  console.error("[diagnose-image-eval-delta] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
