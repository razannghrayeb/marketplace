import "dotenv/config";
import {
  intentAwareRerankWithDiagnostics,
  type RerankOptions,
} from "../src/lib/ranker/intentReranker";
import type { ParsedIntent } from "../src/lib/prompt/gemeni";
import type { MultiVectorSearchResult } from "../src/lib/search/multiVectorSearch";

function mockIntent(): ParsedIntent {
  return {
    imageIntents: [
      {
        imageIndex: 0,
        primaryAttributes: ["color", "style"],
        extractedValues: { color: ["blue"], style: ["minimalist"] },
        weight: 0.7,
      } as any,
      {
        imageIndex: 1,
        primaryAttributes: ["material", "pattern"],
        extractedValues: { material: ["denim"], pattern: ["solid"] },
        weight: 0.3,
      } as any,
    ],
    constraints: {
      priceMin: 40,
      priceMax: 120,
      mustHave: ["blue", "denim"],
      mustNotHave: ["leather"],
    } as any,
  } as ParsedIntent;
}

function mockResults(): MultiVectorSearchResult[] {
  return [
    {
      productId: "101",
      score: 0.62,
      _rawScores: { vectorScore: 0.82 },
      scoreBreakdown: [
        { attribute: "color", weight: 0.4, similarity: 0.9, contribution: 0.36 },
        { attribute: "style", weight: 0.3, similarity: 0.8, contribution: 0.24 },
        { attribute: "material", weight: 0.2, similarity: 0.4, contribution: 0.08 },
      ],
      product: {
        vendorId: "1",
        title: "Blue minimalist denim jacket",
        brand: "X",
        category: "jackets",
        priceUsd: 89,
        availability: "in_stock",
      },
    },
    {
      productId: "102",
      score: 0.66,
      _rawScores: { vectorScore: 0.88 },
      scoreBreakdown: [
        { attribute: "color", weight: 0.4, similarity: 0.2, contribution: 0.08 },
        { attribute: "style", weight: 0.3, similarity: 0.3, contribution: 0.09 },
        { attribute: "material", weight: 0.2, similarity: 0.9, contribution: 0.18 },
      ],
      product: {
        vendorId: "2",
        title: "Black leather biker jacket",
        brand: "Y",
        category: "jackets",
        priceUsd: 220,
        availability: "out_of_stock",
      },
    },
    {
      productId: "103",
      score: 0.57,
      _rawScores: { vectorScore: 0.79 },
      scoreBreakdown: [
        { attribute: "color", weight: 0.4, similarity: 0.75, contribution: 0.3 },
        { attribute: "style", weight: 0.3, similarity: 0.7, contribution: 0.21 },
        { attribute: "pattern", weight: 0.2, similarity: 0.8, contribution: 0.16 },
      ],
      product: {
        vendorId: "3",
        title: "Blue solid casual overshirt",
        brand: "Z",
        category: "shirts",
        priceUsd: 74,
        availability: "in_stock",
      },
    },
  ];
}

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

function run(): void {
  const intent = mockIntent();
  const results = mockResults();
  const opts: RerankOptions = {
    vectorWeight: 0.6,
    attributeWeight: 0.3,
    priceWeight: 0.1,
    recencyWeight: 0.0,
  };

  const out = intentAwareRerankWithDiagnostics(results, intent, opts);

  assert(out.results.length === 3, "Expected 3 results after rerank");
  assert(out.results[0].productId === "101" || out.results[0].productId === "103", "Top rank should favor blue/minimalist compatible items");
  assert(out.results[out.results.length - 1].productId === "102", "Expected leather/out-of-range candidate to rank last");

  const w = out.diagnostics.weights;
  const wsum = w.vectorWeight + w.attributeWeight + w.priceWeight + w.recencyWeight;
  assert(Math.abs(wsum - 1) < 1e-6, "Rerank weights must normalize to 1");
  assert(out.diagnostics.scoreStats.max <= 1.000001, "Rerank score max should be <= 1");
  assert(out.diagnostics.scoreStats.min >= -0.000001, "Rerank score min should be >= 0");

  console.log("Phase 5+6 reranker evaluation: PASS");
  console.log("Top order:", out.results.map((r) => `${r.productId}:${r.rerankScore.toFixed(4)}`).join(" | "));
  console.log("Diagnostics:", JSON.stringify(out.diagnostics, null, 2));
}

run();
