import { readFile, writeFile } from "fs/promises";
import path from "path";
import { searchText } from "../src/lib/search/fashionSearchFacade";

type ColorMode = "any" | "all";

type EvalExpected = {
  productTypes?: string[];
  colors?: string[];
  colorMode?: ColorMode;
};

type EvalItem = {
  id: string;
  query: string;
  expected: EvalExpected;
};

type EvalMetrics = {
  ExactTypePrecisionAt10: number;
  ColorConstraintAccuracy: number;
  ZeroResultRate: number;
  QueryParseSuccessRate: number;
};

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function parseColorMode(v: any): ColorMode {
  const s = String(v ?? "").toLowerCase();
  return s === "all" ? "all" : "any";
}

async function main() {
  const args = process.argv.slice(2);
  const datasetIdx = args.findIndex((a) => a === "--dataset");
  const baselineIdx = args.findIndex((a) => a === "--baseline");
  const outIdx = args.findIndex((a) => a === "--out");

  const datasetPath =
    datasetIdx >= 0 ? String(args[datasetIdx + 1]) : path.join(__dirname, "eval-search-dataset.json");

  const baselinePath = baselineIdx >= 0 ? String(args[baselineIdx + 1]) : undefined;
  const outPath = outIdx >= 0 ? String(args[outIdx + 1]) : undefined;
  const gate = args.includes("--gate") || String(process.env.SEARCH_EVAL_GATE ?? "").toLowerCase() === "true";
  const minExactDelta = parseFloat(process.env.EVAL_MIN_EXACTTYPE_DELTA ?? "0");
  const minColorDelta = parseFloat(process.env.EVAL_MIN_COLOR_DELTA ?? "0");

  const raw = await readFile(datasetPath, "utf-8");
  const dataset: EvalItem[] = JSON.parse(raw);

  const topK = 10;

  let precisionSum = 0;
  let precisionQueries = 0;

  let colorSum = 0;
  let colorQueries = 0;

  let zeroCount = 0;
  let parseSuccessCount = 0;

  const perQuery: any[] = [];

  for (const item of dataset) {
    const expectedTypes = (item.expected.productTypes ?? []).map((t) => t.toLowerCase());
    const expectedColors = (item.expected.colors ?? []).map((c) => c.toLowerCase());
    const expectedColorMode = parseColorMode(item.expected.colorMode);

    const res = await searchText({
      query: item.query,
      filters: {},
      page: 1,
      limit: topK,
      includeRelated: false,
      relatedLimit: 0,
    });

    const results: any[] = Array.isArray(res.results) ? res.results.slice(0, topK) : [];

    const meta: any = res.meta ?? {};
    const parsedOk = Boolean(meta?.processed_query);
    if (parsedOk) parseSuccessCount += 1;

    if (results.length === 0) zeroCount += 1;

    let correctType = 0;
    if (expectedTypes.length > 0) {
      const expectedPrimary = expectedTypes[0];
      correctType = results.filter((p) => {
        const explain = p.explain ?? {};
        const desired = explain.desiredProductTypes ?? [];
        return (
          (explain.productTypeCompliance ?? 0) >= 0.999 &&
          desired.map((x: any) => String(x).toLowerCase()).includes(expectedPrimary)
        );
      }).length;

      precisionSum += correctType / topK;
      precisionQueries += 1;
    }

    let avgColorCompliance = 0;
    if (expectedColors.length > 0) {
      const denom = Math.max(1, results.length);
      avgColorCompliance =
        results.reduce((sum, p) => sum + clamp01(p.explain?.colorCompliance ?? 0), 0) / denom;

      // If "all" is expected, treat perfect overlap as 1 (otherwise fractional overlaps remain useful)
      // This keeps the metric informative even for partially correct retrievals.
      // (We still compute it from the system's compliance score.)
      colorSum += avgColorCompliance;
      colorQueries += 1;
    }

    perQuery.push({
      id: item.id,
      query: item.query,
      results: results.map((p) => ({
        id: p.id,
        title: p.title,
        color: p.color,
        similarity_score: p.similarity_score,
        explain: p.explain,
      })),
      metrics: {
        correctType,
        avgColorCompliance,
        parsedOk,
        zero: results.length === 0,
        expectedColorMode,
      },
    });
  }

  const metrics: EvalMetrics = {
    ExactTypePrecisionAt10: precisionQueries > 0 ? precisionSum / precisionQueries : 0,
    ColorConstraintAccuracy: colorQueries > 0 ? colorSum / colorQueries : 0,
    ZeroResultRate: dataset.length > 0 ? zeroCount / dataset.length : 0,
    QueryParseSuccessRate: dataset.length > 0 ? parseSuccessCount / dataset.length : 0,
  };

  // Optional baseline diff
  let baseline: EvalMetrics | undefined;
  if (baselinePath) {
    const baselineRaw = await readFile(baselinePath, "utf-8");
    baseline = JSON.parse(baselineRaw);
  }

  console.log("\n=== Search Evaluation ===");
  console.log(JSON.stringify(metrics, null, 2));

  if (baseline) {
    console.log("\n=== Baseline Diff ===");
    const diff = Object.fromEntries(
      Object.entries(metrics).map(([k, v]) => [k, (v as number) - (baseline as any)[k]])
    ) as Record<string, number>;
    console.log(JSON.stringify(diff, null, 2));

    if (gate) {
      const exactDelta = diff.ExactTypePrecisionAt10 ?? 0;
      const colorDelta = diff.ColorConstraintAccuracy ?? 0;
      if (exactDelta < minExactDelta || colorDelta < minColorDelta) {
        console.error(
          `\n[gate] Evaluation gate failed. Required deltas: ExactTypePrecision@10 >= ${minExactDelta}, ColorConstraintAccuracy >= ${minColorDelta}. ` +
            `Observed deltas: ExactTypePrecision@10=${exactDelta}, ColorConstraintAccuracy=${colorDelta}`
        );
        process.exit(1);
      }
      console.log(
        `\n[gate] Evaluation gate passed. ExactTypePrecisionAt10 delta=${diff.ExactTypePrecisionAt10 ?? 0}, ` +
          `ColorConstraintAccuracy delta=${diff.ColorConstraintAccuracy ?? 0}`
      );
    }
  }

  if (outPath) {
    await writeFile(outPath, JSON.stringify({ metrics, perQuery }, null, 2), "utf-8");
    console.log(`\nWrote eval output to: ${outPath}`);
  }
}

main().catch((err) => {
  console.error("[eval-search] failed:", err);
  process.exit(1);
});

