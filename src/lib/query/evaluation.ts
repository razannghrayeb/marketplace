/**
 * Evaluation Metrics for Composite Query System
 * 
 * Provides tools for measuring search quality:
 * - Precision@k, Recall@k, NDCG
 * - Attribute match accuracy
 * - User satisfaction metrics
 */

export interface RelevanceJudgment {
  queryId: string;
  productId: number;
  relevance: number; // 0-3 scale: 0=irrelevant, 1=somewhat, 2=relevant, 3=perfect
  attributeMatch: {
    color: number; // 0-1
    material: number;
    silhouette: number;
    style: number;
    overall: number;
  };
}

export interface SearchEvaluation {
  queryId: string;
  results: Array<{
    productId: number;
    rank: number;
    score: number;
  }>;
  groundTruth: RelevanceJudgment[];
}

export interface EvaluationMetrics {
  precision_at_k: Record<number, number>; // k -> precision
  recall_at_k: Record<number, number>;
  ndcg: number;
  map: number; // Mean Average Precision
  mrr: number; // Mean Reciprocal Rank
  attributeAccuracy: {
    color: number;
    material: number;
    silhouette: number;
    style: number;
    overall: number;
  };
  confidence: number;
}

/**
 * Calculate Precision@k
 * Measures: Of the top K results, what fraction are relevant?
 */
export function precisionAtK(
  results: number[],
  relevantIds: Set<number>,
  k: number
): number {
  const topK = results.slice(0, k);
  const relevantInTopK = topK.filter(id => relevantIds.has(id)).length;
  return relevantInTopK / k;
}

/**
 * Calculate Recall@k
 * Measures: Of all relevant items, what fraction appear in top K?
 */
export function recallAtK(
  results: number[],
  relevantIds: Set<number>,
  k: number
): number {
  if (relevantIds.size === 0) return 0;
  const topK = results.slice(0, k);
  const relevantInTopK = topK.filter(id => relevantIds.has(id)).length;
  return relevantInTopK / relevantIds.size;
}

/**
 * Calculate NDCG (Normalized Discounted Cumulative Gain)
 * Measures: Ranking quality with graded relevance
 */
export function ndcg(
  results: number[],
  judgments: Map<number, number>,
  k?: number
): number {
  const resultsToUse = k ? results.slice(0, k) : results;

  // Calculate DCG
  const dcg = resultsToUse.reduce((sum, productId, idx) => {
    const relevance = judgments.get(productId) || 0;
    return sum + relevance / Math.log2(idx + 2); // idx+2 because log2(1)=0
  }, 0);

  // Calculate IDCG (ideal DCG)
  const idealOrder = Array.from(judgments.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, resultsToUse.length);

  const idcg = idealOrder.reduce((sum, [_, relevance], idx) => {
    return sum + relevance / Math.log2(idx + 2);
  }, 0);

  return idcg > 0 ? dcg / idcg : 0;
}

/**
 * Calculate Mean Average Precision (MAP)
 */
export function meanAveragePrecision(
  results: number[],
  relevantIds: Set<number>
): number {
  if (relevantIds.size === 0) return 0;

  let sum = 0;
  let relevantCount = 0;

  for (let i = 0; i < results.length; i++) {
    if (relevantIds.has(results[i])) {
      relevantCount++;
      sum += relevantCount / (i + 1);
    }
  }

  return sum / relevantIds.size;
}

/**
 * Calculate Mean Reciprocal Rank (MRR)
 */
export function meanReciprocalRank(
  results: number[],
  relevantIds: Set<number>
): number {
  for (let i = 0; i < results.length; i++) {
    if (relevantIds.has(results[i])) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

/**
 * Calculate attribute matching accuracy
 */
export function attributeAccuracy(
  results: number[],
  judgments: RelevanceJudgment[],
  k: number = 10
): EvaluationMetrics['attributeAccuracy'] {
  const topK = results.slice(0, k);
  const relevantJudgments = judgments.filter(j => topK.includes(j.productId));

  if (relevantJudgments.length === 0) {
    return { color: 0, material: 0, silhouette: 0, style: 0, overall: 0 };
  }

  const sum = relevantJudgments.reduce(
    (acc, j) => ({
      color: acc.color + j.attributeMatch.color,
      material: acc.material + j.attributeMatch.material,
      silhouette: acc.silhouette + j.attributeMatch.silhouette,
      style: acc.style + j.attributeMatch.style,
      overall: acc.overall + j.attributeMatch.overall,
    }),
    { color: 0, material: 0, silhouette: 0, style: 0, overall: 0 }
  );

  return {
    color: sum.color / relevantJudgments.length,
    material: sum.material / relevantJudgments.length,
    silhouette: sum.silhouette / relevantJudgments.length,
    style: sum.style / relevantJudgments.length,
    overall: sum.overall / relevantJudgments.length,
  };
}

/**
 * Comprehensive evaluation
 */
export function evaluateSearch(evaluation: SearchEvaluation): EvaluationMetrics {
  const resultIds = evaluation.results.map(r => r.productId);
  
  // Build relevance map
  const relevanceMap = new Map<number, number>();
  const relevantIds = new Set<number>();

  for (const judgment of evaluation.groundTruth) {
    relevanceMap.set(judgment.productId, judgment.relevance);
    if (judgment.relevance >= 2) {
      relevantIds.add(judgment.productId);
    }
  }

  // Calculate all metrics
  const precision_at_k: Record<number, number> = {};
  const recall_at_k: Record<number, number> = {};
  const kValues = [1, 3, 5, 10, 20, 50];

  for (const k of kValues) {
    precision_at_k[k] = precisionAtK(resultIds, relevantIds, k);
    recall_at_k[k] = recallAtK(resultIds, relevantIds, k);
  }

  return {
    precision_at_k,
    recall_at_k,
    ndcg: ndcg(resultIds, relevanceMap),
    map: meanAveragePrecision(resultIds, relevantIds),
    mrr: meanReciprocalRank(resultIds, relevantIds),
    attributeAccuracy: attributeAccuracy(resultIds, evaluation.groundTruth, 10),
    confidence: evaluation.groundTruth.length > 0 ? 1.0 : 0.0,
  };
}

/**
 * Compare two search systems A/B
 */
export function compareSearchSystems(
  evaluationsA: SearchEvaluation[],
  evaluationsB: SearchEvaluation[]
): {
  systemA: EvaluationMetrics;
  systemB: EvaluationMetrics;
  winner: 'A' | 'B' | 'tie';
  improvements: Record<string, number>;
} {
  const metricsA = evaluationsA.map(evaluateSearch);
  const metricsB = evaluationsB.map(evaluateSearch);

  const avgA = averageMetrics(metricsA);
  const avgB = averageMetrics(metricsB);

  // Determine winner based on NDCG (primary metric)
  const ndcgDiff = avgB.ndcg - avgA.ndcg;
  const winner =
    Math.abs(ndcgDiff) < 0.01 ? 'tie' : ndcgDiff > 0 ? 'B' : 'A';

  return {
    systemA: avgA,
    systemB: avgB,
    winner,
    improvements: {
      ndcg: ((avgB.ndcg - avgA.ndcg) / avgA.ndcg) * 100,
      map: ((avgB.map - avgA.map) / avgA.map) * 100,
      mrr: ((avgB.mrr - avgA.mrr) / avgA.mrr) * 100,
      'precision@10': ((avgB.precision_at_k[10] - avgA.precision_at_k[10]) / avgA.precision_at_k[10]) * 100,
    },
  };
}

/**
 * Average metrics across multiple evaluations
 */
function averageMetrics(metrics: EvaluationMetrics[]): EvaluationMetrics {
  if (metrics.length === 0) {
    throw new Error('No metrics to average');
  }

  const sum = metrics.reduce(
    (acc, m) => ({
      precision_at_k: Object.fromEntries(
        Object.entries(m.precision_at_k).map(([k, v]) => [
          k,
          (acc.precision_at_k[Number(k)] || 0) + v,
        ])
      ),
      recall_at_k: Object.fromEntries(
        Object.entries(m.recall_at_k).map(([k, v]) => [
          k,
          (acc.recall_at_k[Number(k)] || 0) + v,
        ])
      ),
      ndcg: acc.ndcg + m.ndcg,
      map: acc.map + m.map,
      mrr: acc.mrr + m.mrr,
      attributeAccuracy: {
        color: acc.attributeAccuracy.color + m.attributeAccuracy.color,
        material: acc.attributeAccuracy.material + m.attributeAccuracy.material,
        silhouette: acc.attributeAccuracy.silhouette + m.attributeAccuracy.silhouette,
        style: acc.attributeAccuracy.style + m.attributeAccuracy.style,
        overall: acc.attributeAccuracy.overall + m.attributeAccuracy.overall,
      },
      confidence: acc.confidence + m.confidence,
    }),
    {
      precision_at_k: {},
      recall_at_k: {},
      ndcg: 0,
      map: 0,
      mrr: 0,
      attributeAccuracy: { color: 0, material: 0, silhouette: 0, style: 0, overall: 0 },
      confidence: 0,
    }
  );

  const n = metrics.length;

  return {
    precision_at_k: Object.fromEntries(
      Object.entries(sum.precision_at_k).map(([k, v]) => [k, v / n])
    ),
    recall_at_k: Object.fromEntries(
      Object.entries(sum.recall_at_k).map(([k, v]) => [k, v / n])
    ),
    ndcg: sum.ndcg / n,
    map: sum.map / n,
    mrr: sum.mrr / n,
    attributeAccuracy: {
      color: sum.attributeAccuracy.color / n,
      material: sum.attributeAccuracy.material / n,
      silhouette: sum.attributeAccuracy.silhouette / n,
      style: sum.attributeAccuracy.style / n,
      overall: sum.attributeAccuracy.overall / n,
    },
    confidence: sum.confidence / n,
  };
}

/**
 * Print evaluation report
 */
export function printEvaluationReport(metrics: EvaluationMetrics): string {
  const lines = [
    '=== Search Evaluation Report ===',
    '',
    'Ranking Metrics:',
    `  NDCG:           ${metrics.ndcg.toFixed(4)}`,
    `  MAP:            ${metrics.map.toFixed(4)}`,
    `  MRR:            ${metrics.mrr.toFixed(4)}`,
    '',
    'Precision@k:',
    ...Object.entries(metrics.precision_at_k).map(
      ([k, v]) => `  P@${k}:  ${v.toFixed(4)}`
    ),
    '',
    'Recall@k:',
    ...Object.entries(metrics.recall_at_k).map(
      ([k, v]) => `  R@${k}:  ${v.toFixed(4)}`
    ),
    '',
    'Attribute Match Accuracy:',
    `  Color:          ${metrics.attributeAccuracy.color.toFixed(4)}`,
    `  Material:       ${metrics.attributeAccuracy.material.toFixed(4)}`,
    `  Silhouette:     ${metrics.attributeAccuracy.silhouette.toFixed(4)}`,
    `  Style:          ${metrics.attributeAccuracy.style.toFixed(4)}`,
    `  Overall:        ${metrics.attributeAccuracy.overall.toFixed(4)}`,
    '',
    `Confidence:       ${metrics.confidence.toFixed(4)}`,
    '================================',
  ];

  return lines.join('\n');
}
