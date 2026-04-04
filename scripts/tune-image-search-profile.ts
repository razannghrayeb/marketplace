/**
 * Tune image-search ANN/relevance profile with guardrails.
 *
 * Runs `scripts/eval-image-relevance-e2e.ts` under multiple env profiles,
 * then recommends the best profile that improves recall while keeping
 * unrelated-rate regressions bounded.
 *
 * Usage:
 *   npx tsx scripts/tune-image-search-profile.ts
 *   npx tsx scripts/tune-image-search-profile.ts --max-queries 72 --per-category 12 --k 20
 *   npx tsx scripts/tune-image-search-profile.ts --out tmp-image-profile-tune.json
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

type EvalMetrics = {
  selfRecallAtK: number;
  selfRecallAt1: number;
  selfRecallAt5: number;
  sameCategoryRateAtK: number;
  typeConsistencyRateAtK: number;
  unrelatedRateAtK: number;
  unrelatedRateAt5: number;
};

type EvalReport = {
  sampledQueries: number;
  k: number;
  metrics: EvalMetrics;
};

type Profile = {
  name: string;
  description: string;
  env: Record<string, string>;
};

type ScoredProfile = {
  profile: Profile;
  report: EvalReport;
  score: number;
  safeVsBaseline: boolean;
  deltas: {
    selfRecallAt1: number;
    selfRecallAt5: number;
    sameCategoryRateAtK: number;
    unrelatedRateAtK: number;
    unrelatedRateAt5: number;
  };
};

function parseArg(name: string, fallback: string): string {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) return String(process.argv[idx + 1]);
  return fallback;
}

function toNum(raw: string, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function objective(m: EvalMetrics): number {
  // Favor direct identity retrieval + same-category precision, penalize unrelated.
  return (
    0.42 * clamp01(m.selfRecallAt1) +
    0.26 * clamp01(m.selfRecallAt5) +
    0.20 * clamp01(m.sameCategoryRateAtK) +
    0.10 * clamp01(m.typeConsistencyRateAtK) -
    0.22 * clamp01(m.unrelatedRateAtK) -
    0.10 * clamp01(m.unrelatedRateAt5)
  );
}

function runEvalForProfile(params: {
  profile: Profile;
  k: number;
  perCategory: number;
  maxQueries: number;
  tempDir: string;
}): EvalReport {
  const { profile, k, perCategory, maxQueries, tempDir } = params;
  const outPath = path.join(tempDir, `eval-${profile.name}.json`);
  const tsxCli = path.resolve(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  if (!fs.existsSync(tsxCli)) {
    throw new Error(`tsx CLI not found at ${tsxCli}`);
  }
  const cmd = process.execPath;
  const args = [
    tsxCli,
    "scripts/eval-image-relevance-e2e.ts",
    "--k",
    String(k),
    "--per-category",
    String(perCategory),
    "--max-queries",
    String(maxQueries),
    "--out",
    outPath,
  ];

  const env = {
    ...process.env,
    ...profile.env,
  };
  const evalTimeoutMs = (() => {
    const raw = Number(process.env.SEARCH_TUNE_EVAL_TIMEOUT_MS ?? "1800000");
    if (!Number.isFinite(raw)) return 1_800_000;
    return Math.max(120_000, Math.min(3_600_000, Math.floor(raw)));
  })();

  const run = spawnSync(cmd, args, {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
    stdio: "pipe",
    timeout: evalTimeoutMs,
    windowsHide: true,
  });

  if (run.status !== 0) {
    const spawnError = run.error ? String(run.error.message || run.error) : "";
    const stderr = (run.stderr || "").trim();
    const stdout = (run.stdout || "").trim();
    throw new Error(
      `[${profile.name}] eval failed (exit=${run.status}). spawnError=${spawnError || "<none>"} stderr=${stderr || "<empty>"} stdout=${stdout || "<empty>"}`,
    );
  }

  const raw = fs.readFileSync(outPath, "utf8");
  return JSON.parse(raw) as EvalReport;
}

function pct(x: number): string {
  return `${(x * 100).toFixed(2)}%`;
}

function main(): void {
  const k = Math.max(5, Math.min(50, toNum(parseArg("--k", "20"), 20)));
  const perCategory = Math.max(2, Math.min(30, toNum(parseArg("--per-category", "10"), 10)));
  const maxQueries = Math.max(12, Math.min(500, toNum(parseArg("--max-queries", "96"), 96)));
  const outPathArg = parseArg("--out", "").trim();

  const tmpRoot = path.resolve(process.cwd(), "tmp");
  if (!fs.existsSync(tmpRoot)) fs.mkdirSync(tmpRoot, { recursive: true });

  // Baseline = current process env (no overrides)
  const profiles: Profile[] = [
    {
      name: "baseline",
      description: "Current environment",
      env: {},
    },
    {
      name: "recall_balanced",
      description: "Higher ANN candidate pool with conservative thresholds",
      env: {
        SEARCH_IMAGE_RETRIEVAL_K: "700",
        SEARCH_IMAGE_MERCH_CANDIDATE_CAP: "900",
        SEARCH_IMAGE_RELAX_FLOOR: "0.36",
        SEARCH_IMAGE_MIN_RESULTS: "8",
      },
    },
    {
      name: "recall_strong",
      description: "Stronger ANN recall for hard same-category neighbors",
      env: {
        SEARCH_IMAGE_RETRIEVAL_K: "900",
        SEARCH_IMAGE_MERCH_CANDIDATE_CAP: "1100",
        SEARCH_IMAGE_RELAX_FLOOR: "0.35",
        SEARCH_IMAGE_MIN_RESULTS: "10",
      },
    },
    {
      name: "precision_guarded",
      description: "Recall uplift with tighter final relevance gate",
      env: {
        SEARCH_IMAGE_RETRIEVAL_K: "800",
        SEARCH_IMAGE_MERCH_CANDIDATE_CAP: "1000",
        SEARCH_FINAL_ACCEPT_MIN_IMAGE: "0.40",
        SEARCH_IMAGE_MIN_RESULTS: "8",
      },
    },
  ];

  const reports: ScoredProfile[] = [];
  for (const profile of profiles) {
    const report = runEvalForProfile({ profile, k, perCategory, maxQueries, tempDir: tmpRoot });
    reports.push({
      profile,
      report,
      score: objective(report.metrics),
      safeVsBaseline: false,
      deltas: {
        selfRecallAt1: 0,
        selfRecallAt5: 0,
        sameCategoryRateAtK: 0,
        unrelatedRateAtK: 0,
        unrelatedRateAt5: 0,
      },
    });
  }

  const baseline = reports.find((r) => r.profile.name === "baseline");
  if (!baseline) throw new Error("baseline profile missing");

  for (const row of reports) {
    row.deltas = {
      selfRecallAt1: row.report.metrics.selfRecallAt1 - baseline.report.metrics.selfRecallAt1,
      selfRecallAt5: row.report.metrics.selfRecallAt5 - baseline.report.metrics.selfRecallAt5,
      sameCategoryRateAtK:
        row.report.metrics.sameCategoryRateAtK - baseline.report.metrics.sameCategoryRateAtK,
      unrelatedRateAtK:
        row.report.metrics.unrelatedRateAtK - baseline.report.metrics.unrelatedRateAtK,
      unrelatedRateAt5:
        row.report.metrics.unrelatedRateAt5 - baseline.report.metrics.unrelatedRateAt5,
    };

    // Safety guard: do not accept profiles that increase unrelated-rate too much.
    row.safeVsBaseline =
      row.deltas.unrelatedRateAtK <= 0.01 &&
      row.deltas.unrelatedRateAt5 <= 0.01 &&
      row.deltas.sameCategoryRateAtK >= -0.01;
  }

  const ranked = [...reports].sort((a, b) => b.score - a.score);
  const safeRanked = ranked.filter((r) => r.safeVsBaseline);
  const recommended = (safeRanked.length > 0 ? safeRanked : ranked)[0];

  const summary = {
    k,
    perCategory,
    maxQueries,
    baseline: {
      metrics: baseline.report.metrics,
      score: baseline.score,
    },
    recommended: {
      profile: recommended.profile,
      score: recommended.score,
      safeVsBaseline: recommended.safeVsBaseline,
      deltas: recommended.deltas,
      metrics: recommended.report.metrics,
    },
    ranked: ranked.map((r) => ({
      name: r.profile.name,
      description: r.profile.description,
      score: r.score,
      safeVsBaseline: r.safeVsBaseline,
      deltas: r.deltas,
      metrics: r.report.metrics,
      env: r.profile.env,
    })),
  };

  console.log("=".repeat(88));
  console.log("IMAGE SEARCH PROFILE TUNING");
  console.log("=".repeat(88));
  console.log(`Queries: ${baseline.report.sampledQueries}, K=${k}`);
  console.log("");
  for (const r of ranked) {
    console.log(`[${r.profile.name}] score=${r.score.toFixed(4)} safe=${r.safeVsBaseline ? "yes" : "no"}`);
    console.log(
      `  self@1 ${pct(r.report.metrics.selfRecallAt1)} | self@5 ${pct(r.report.metrics.selfRecallAt5)} | sameCat ${pct(r.report.metrics.sameCategoryRateAtK)} | unrelated@K ${pct(r.report.metrics.unrelatedRateAtK)}`,
    );
  }
  console.log("");
  console.log(`Recommended profile: ${recommended.profile.name} (${recommended.safeVsBaseline ? "safe" : "best-effort"})`);
  if (recommended.profile.name !== "baseline") {
    console.log("Apply env overrides:");
    for (const [kEnv, vEnv] of Object.entries(recommended.profile.env)) {
      console.log(`${kEnv}=${vEnv}`);
    }
  } else {
    console.log("Current baseline already best under configured safety guards.");
  }

  if (outPathArg) {
    const outPath = path.resolve(process.cwd(), outPathArg);
    fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
    console.log(`\nSaved report: ${outPath}`);
  }
}

try {
  main();
} catch (err) {
  console.error("[tune-image-search-profile] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
}
