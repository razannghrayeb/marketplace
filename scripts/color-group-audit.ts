import { pg } from "../src/lib/core/db";
import { inferColorGroupFromRaw, normalizeColorTokensFromRaw } from "../src/lib/color/queryColorFilter";

type Row = { color: string | null; count: string };

async function main(): Promise<void> {
  const res = await pg.query<Row>(
    `
      SELECT color, COUNT(*)::text AS count
      FROM products
      GROUP BY color
      ORDER BY COUNT(*) DESC
    `,
  );

  let totalDistinct = 0;
  let totalRows = 0;
  let mappedDistinct = 0;
  let mappedRows = 0;
  let unknownDistinct = 0;
  let unknownRows = 0;

  const byGroup = new Map<string, { distinct: number; rows: number }>();
  const topUnknown: Array<{ color: string; count: number }> = [];

  for (const r of res.rows) {
    const raw = r.color;
    const count = Number(r.count ?? 0);
    totalDistinct += 1;
    totalRows += count;

    const group = inferColorGroupFromRaw(raw);
    const tokens = normalizeColorTokensFromRaw(raw);
    const isMapped = group !== "unknown" || tokens.length > 0;

    const agg = byGroup.get(group) ?? { distinct: 0, rows: 0 };
    agg.distinct += 1;
    agg.rows += count;
    byGroup.set(group, agg);

    if (isMapped) {
      mappedDistinct += 1;
      mappedRows += count;
    } else {
      unknownDistinct += 1;
      unknownRows += count;
      topUnknown.push({ color: String(raw ?? ""), count });
    }
  }

  topUnknown.sort((a, b) => b.count - a.count);

  const groupBreakdown = [...byGroup.entries()]
    .sort((a, b) => b[1].rows - a[1].rows)
    .map(([group, stats]) => ({
      group,
      distinct: stats.distinct,
      rows: stats.rows,
      distinctPct: totalDistinct > 0 ? Number(((stats.distinct * 100) / totalDistinct).toFixed(2)) : 0,
      rowsPct: totalRows > 0 ? Number(((stats.rows * 100) / totalRows).toFixed(2)) : 0,
    }));

  const report = {
    totalDistinct,
    totalRows,
    mappedDistinct,
    mappedRows,
    unknownDistinct,
    unknownRows,
    mappedDistinctPct: totalDistinct > 0 ? Number(((mappedDistinct * 100) / totalDistinct).toFixed(2)) : 0,
    mappedRowsPct: totalRows > 0 ? Number(((mappedRows * 100) / totalRows).toFixed(2)) : 0,
    unknownDistinctPct: totalDistinct > 0 ? Number(((unknownDistinct * 100) / totalDistinct).toFixed(2)) : 0,
    unknownRowsPct: totalRows > 0 ? Number(((unknownRows * 100) / totalRows).toFixed(2)) : 0,
    groups: groupBreakdown,
    topUnknown: topUnknown.slice(0, 100),
  };

  console.log(JSON.stringify(report, null, 2));
  await pg.end();
}

main().catch(async (err) => {
  console.error("[color-group-audit] failed:", err);
  try {
    await pg.end();
  } catch {
    // ignore
  }
  process.exit(1);
});

