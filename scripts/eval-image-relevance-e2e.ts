/**
 * End-to-end image-search relevance evaluation.
 *
 * Unlike raw kNN eval, this exercises the full `searchByImageWithSimilarity`
 * pipeline (relevance gating, rerank, filters, rescue rules).
 *
 * Usage:
 *   npx tsx scripts/eval-image-relevance-e2e.ts
 *   npx tsx scripts/eval-image-relevance-e2e.ts --k 20 --per-category 8 --max-queries 48 --out tmp-image-eval-e2e.json
 */

import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { osClient } from "../src/lib/core";
import { config } from "../src/config";
import { searchByImageWithSimilarity } from "../src/routes/products/products.service";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

type EvalQuery = {
  id: string;
  embedding: number[];
  categoryCanonical: string;
  productTypes: string[];
  title: string;
};

type EvalHit = {
  id: string;
  categoryCanonical: string;
  productTypes: string[];
};

function parseArg(name: string, fallback: string): string {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) return String(process.argv[idx + 1]);
  return fallback;
}

function toNum(v: string, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function overlap(a: string[], b: string[]): boolean {
  if (!a.length || !b.length) return false;
  const bs = new Set(b.map((x) => x.toLowerCase().trim()));
  for (const x of a) {
    if (bs.has(String(x).toLowerCase().trim())) return true;
  }
  return false;
}

async function collectQueries(perCategory: number, maxQueries: number): Promise<EvalQuery[]> {
  const categories = ["tops", "bottoms", "footwear", "dresses", "outerwear", "accessories"];
  const out: EvalQuery[] = [];

  for (const cat of categories) {
    const r = await osClient.search({
      index: config.opensearch.index,
      body: {
        size: perCategory,
        _source: ["product_id", "title", "embedding", "category_canonical", "product_types"],
        query: {
          bool: {
            filter: [
              { term: { is_hidden: false } },
              { term: { category_canonical: cat } },
              { exists: { field: "embedding" } },
            ],
          },
        },
      },
    });

    const hits = (r.body?.hits?.hits ?? []) as any[];
    for (const h of hits) {
      const src = h?._source ?? {};
      if (!Array.isArray(src.embedding) || src.embedding.length === 0) continue;
      out.push({
        id: String(src.product_id),
        embedding: src.embedding,
        categoryCanonical: String(src.category_canonical ?? "").toLowerCase(),
        productTypes: Array.isArray(src.product_types)
          ? src.product_types.map((x: unknown) => String(x).toLowerCase())
          : [],
        title: String(src.title ?? ""),
      });
      if (out.length >= maxQueries) return out;
    }
  }

  return out.slice(0, maxQueries);
}

async function toEvalHits(ids: string[]): Promise<EvalHit[]> {
  if (!ids.length) return [];
  const r = await osClient.search({
    index: config.opensearch.index,
    body: {
      size: ids.length,
      _source: ["product_id", "category_canonical", "product_types"],
      query: { terms: { product_id: ids } },
    },
  });
  const byId = new Map<string, EvalHit>();
  for (const h of r.body?.hits?.hits ?? []) {
    const s = h?._source ?? {};
    byId.set(String(s.product_id), {
      id: String(s.product_id),
      categoryCanonical: String(s.category_canonical ?? "").toLowerCase(),
      productTypes: Array.isArray(s.product_types)
        ? s.product_types.map((x: unknown) => String(x).toLowerCase())
        : [],
    });
  }
  return ids.map((id) => byId.get(id)).filter(Boolean) as EvalHit[];
}

async function e2eSearchIds(embedding: number[], k: number): Promise<string[]> {
  const res = await searchByImageWithSimilarity({
    imageEmbedding: embedding,
    filters: {},
    limit: k,
    includeRelated: false,
    similarityThreshold: config.clip.imageSimilarityThreshold,
    relaxThresholdWhenEmpty: true,
  } as any);

  return (res.results ?? []).map((p: any) => String(p.id)).slice(0, k);
}

async function main(): Promise<void> {
  const k = Math.max(5, Math.min(50, toNum(parseArg("--k", "20"), 20)));
  const perCategory = Math.max(2, Math.min(30, toNum(parseArg("--per-category", "8"), 8)));
  const maxQueries = Math.max(6, Math.min(240, toNum(parseArg("--max-queries", "48"), 48)));
  const outPath = parseArg("--out", "");

  const queries = await collectQueries(perCategory, maxQueries);
  if (!queries.length) {
    console.error("No evaluation queries found (need embedded docs in OpenSearch).");
    process.exit(1);
  }

  let selfHit = 0;
  let selfAt1 = 0;
  let selfAt5 = 0;
  let sameCategorySum = 0;
  let typeConsistencySum = 0;
  let unrelatedSum = 0;
  let unrelatedAt5Sum = 0;
  const perQuery: any[] = [];

  for (const q of queries) {
    const ids = await e2eSearchIds(q.embedding, k);
    const hits = await toEvalHits(ids);
    if (ids.includes(q.id)) selfHit += 1;
    if (ids[0] === q.id) selfAt1 += 1;
    if (ids.slice(0, Math.min(5, ids.length)).includes(q.id)) selfAt5 += 1;

    let sameCat = 0;
    let typeOk = 0;
    let unrelated = 0;
    for (const h of hits) {
      const catMatch = h.categoryCanonical === q.categoryCanonical;
      const typeMatch = overlap(h.productTypes, q.productTypes);
      if (catMatch) sameCat += 1;
      if (typeMatch) typeOk += 1;
      if (!catMatch && !typeMatch) unrelated += 1;
    }
    const top5 = hits.slice(0, Math.min(5, hits.length));
    const top5Unrelated = top5.filter(
      (h) => h.categoryCanonical !== q.categoryCanonical && !overlap(h.productTypes, q.productTypes),
    ).length;
    unrelatedAt5Sum += top5.length > 0 ? top5Unrelated / top5.length : 0;

    const denom = Math.max(1, hits.length);
    sameCategorySum += sameCat / denom;
    typeConsistencySum += typeOk / denom;
    unrelatedSum += unrelated / denom;

    perQuery.push({
      queryId: q.id,
      queryTitle: q.title,
      queryCategory: q.categoryCanonical,
      queryTypes: q.productTypes,
      topIds: ids,
      selfHit: ids.includes(q.id),
      sameCategoryRate: sameCat / denom,
      typeConsistencyRate: typeOk / denom,
      unrelatedRate: unrelated / denom,
    });
  }

  const n = queries.length;
  const report = {
    sampledQueries: n,
    k,
    metrics: {
      selfRecallAtK: selfHit / n,
      selfRecallAt1: selfAt1 / n,
      selfRecallAt5: selfAt5 / n,
      sameCategoryRateAtK: sameCategorySum / n,
      typeConsistencyRateAtK: typeConsistencySum / n,
      unrelatedRateAtK: unrelatedSum / n,
      unrelatedRateAt5: unrelatedAt5Sum / n,
    },
    perQuery,
  };

  console.log(JSON.stringify(report, null, 2));
  if (outPath) fs.writeFileSync(path.resolve(process.cwd(), outPath), JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

