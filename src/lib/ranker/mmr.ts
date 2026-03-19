/**
 * Maximal Marginal Relevance (MMR) for Recommendation Diversity
 * 
 * Implements MMR algorithm to balance relevance and diversity in recommendations.
 * Prevents "echo chamber" effect where all results are visually identical.
 * 
 * MMR(d) = λ * Relevance(d) - (1-λ) * max(Similarity(d, d_selected))
 * 
 * λ = 1.0: Pure relevance ranking (no diversity)
 * λ = 0.0: Maximum diversity (ignore relevance)
 * λ = 0.7: Default balance (70% relevance, 30% diversity penalty)
 */

import type { RankedCandidateResult } from "./pipeline";

// ============================================================================
// Types
// ============================================================================

export interface MMROptions {
  /** Lambda parameter: 0-1, higher = more relevance, lower = more diversity */
  lambda?: number;
  /** Target number of results */
  targetCount?: number;
  /** Minimum score threshold */
  minScore?: number;
  /** Use CLIP embedding for similarity (default) or ranker score */
  similaritySource?: "embedding" | "score";
}

export interface MMRResult {
  candidates: RankedCandidateResult[];
  meta: {
    inputCount: number;
    outputCount: number;
    lambda: number;
    diversityPenalties: number[];
    averageDiversityPenalty: number;
  };
}

// ============================================================================
// Similarity Functions
// ============================================================================

/**
 * Compute cosine similarity between two embedding vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length || a.length === 0) {
    return 0;
  }
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  
  return dotProduct / denominator;
}

/**
 * Compute score-based similarity (simpler fallback)
 */
function scoreSimilarity(scoreA: number, scoreB: number): number {
  const maxScore = Math.max(scoreA, scoreB);
  if (maxScore === 0) return 0;
  
  const diff = Math.abs(scoreA - scoreB);
  return 1 - (diff / maxScore);
}

// ============================================================================
// MMR Implementation
// ============================================================================

/**
 * Apply Maximal Marginal Relevance to rank candidates with diversity
 */
export function applyMMR(
  candidates: RankedCandidateResult[],
  options: MMROptions = {}
): MMRResult {
  const {
    lambda = 0.7,
    targetCount = 20,
    minScore = 0,
    similaritySource = "embedding",
  } = options;
  
  // Filter by minimum score first
  const eligibleCandidates = candidates.filter(c => c.rankerScore >= minScore);
  
  if (eligibleCandidates.length === 0) {
    return {
      candidates: [],
      meta: {
        inputCount: candidates.length,
        outputCount: 0,
        lambda,
        diversityPenalties: [],
        averageDiversityPenalty: 0,
      },
    };
  }
  
  // Greedy MMR selection
  const selected: RankedCandidateResult[] = [];
  const remaining = [...eligibleCandidates];
  const diversityPenalties: number[] = [];
  
  // Select first item (highest relevance)
  const firstIdx = remaining.reduce((best, curr, idx, arr) =>
    curr.rankerScore > arr[best].rankerScore ? idx : best, 0
  );
  selected.push(remaining.splice(firstIdx, 1)[0]);
  diversityPenalties.push(0); // First item has no diversity penalty
  
  // Greedy selection for remaining items
  while (selected.length < targetCount && remaining.length > 0) {
    let bestIdx = 0;
    let bestMMR = -Infinity;
    let bestPenalty = 0;
    
    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];
      
      // Relevance term (normalized ranker score)
      const maxScore = Math.max(...candidates.map(c => c.rankerScore));
      const relevance = maxScore > 0 ? candidate.rankerScore / maxScore : 0;
      
      // Diversity term: max similarity to already selected items
      let maxSimilarity = 0;
      for (const sel of selected) {
        let sim: number;
        if (similaritySource === "embedding" && candidate.product?.embedding && sel.product?.embedding) {
          sim = cosineSimilarity(candidate.product.embedding, sel.product.embedding);
        } else {
          sim = scoreSimilarity(candidate.rankerScore, sel.rankerScore);
        }
        maxSimilarity = Math.max(maxSimilarity, sim);
      }
      
      // MMR score: balance relevance and diversity
      const mmrScore = lambda * relevance - (1 - lambda) * maxSimilarity;
      
      if (mmrScore > bestMMR) {
        bestMMR = mmrScore;
        bestIdx = i;
        bestPenalty = maxSimilarity;
      }
    }
    
    selected.push(remaining.splice(bestIdx, 1)[0]);
    diversityPenalties.push(bestPenalty);
  }
  
  // Update rank positions
  const rankedCandidates = selected.map((c, idx) => ({
    ...c,
    rankPosition: idx + 1,
    mmrApplied: true,
  }));
  
  const avgPenalty = diversityPenalties.length > 0
    ? diversityPenalties.reduce((a, b) => a + b, 0) / diversityPenalties.length
    : 0;
  
  return {
    candidates: rankedCandidates,
    meta: {
      inputCount: candidates.length,
      outputCount: rankedCandidates.length,
      lambda,
      diversityPenalties,
      averageDiversityPenalty: avgPenalty,
    },
  };
}

/**
 * Compute optimal lambda based on result set characteristics
 */
export function computeAdaptiveLambda(
  candidates: RankedCandidateResult[],
  targetDiversity: "low" | "medium" | "high" = "medium"
): number {
  const baseLambda = {
    low: 0.9,      // Mostly relevance
    medium: 0.7,   // Balanced
    high: 0.5,     // More diversity
  }[targetDiversity];
  
  // Adjust based on score distribution
  const scores = candidates.map(c => c.rankerScore);
  const maxScore = Math.max(...scores);
  const minScore = Math.min(...scores);
  const scoreRange = maxScore - minScore;
  
  // If scores are very clustered, increase diversity
  if (scoreRange < 0.1 && candidates.length > 10) {
    return Math.max(0.3, baseLambda - 0.2);
  }
  
  // If scores are very spread, prioritize relevance
  if (scoreRange > 0.5) {
    return Math.min(0.9, baseLambda + 0.1);
  }
  
  return baseLambda;
}

/**
 * Category-aware MMR: penalize same-category items more heavily
 */
export function applyCategoryAwareMMR(
  candidates: RankedCandidateResult[],
  options: MMROptions & { categoryPenalty?: number } = {}
): MMRResult {
  const { categoryPenalty = 0.2, ...mmrOptions } = options;
  
  // Enhance similarity for same-category items
  const enhancedCandidates = candidates.map(c => ({
    ...c,
    _category: c.product?.category || "unknown",
  }));
  
  const selected: RankedCandidateResult[] = [];
  const remaining = [...enhancedCandidates];
  const diversityPenalties: number[] = [];
  
  const lambda = mmrOptions.lambda ?? 0.7;
  const targetCount = mmrOptions.targetCount ?? 20;
  
  // First selection
  if (remaining.length > 0) {
    const firstIdx = remaining.reduce((best, curr, idx, arr) =>
      curr.rankerScore > arr[best].rankerScore ? idx : best, 0
    );
    selected.push(remaining.splice(firstIdx, 1)[0]);
    diversityPenalties.push(0);
  }
  
  // Greedy selection with category awareness
  while (selected.length < targetCount && remaining.length > 0) {
    let bestIdx = 0;
    let bestMMR = -Infinity;
    let bestPenalty = 0;
    
    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];
      
      const maxScore = Math.max(...candidates.map(c => c.rankerScore));
      const relevance = maxScore > 0 ? candidate.rankerScore / maxScore : 0;
      
      let maxSimilarity = 0;
      for (const sel of selected) {
        let baseSim: number;
        if (candidate.product?.embedding && sel.product?.embedding) {
          baseSim = cosineSimilarity(candidate.product.embedding, sel.product.embedding);
        } else {
          baseSim = scoreSimilarity(candidate.rankerScore, sel.rankerScore);
        }
        
        // Extra penalty for same category
        const categoryBonus = (candidate as any)._category === (sel as any)._category
          ? categoryPenalty
          : 0;
        
        maxSimilarity = Math.max(maxSimilarity, baseSim + categoryBonus);
      }
      
      const mmrScore = lambda * relevance - (1 - lambda) * maxSimilarity;
      
      if (mmrScore > bestMMR) {
        bestMMR = mmrScore;
        bestIdx = i;
        bestPenalty = maxSimilarity;
      }
    }
    
    selected.push(remaining.splice(bestIdx, 1)[0]);
    diversityPenalties.push(bestPenalty);
  }
  
  const rankedCandidates = selected.map((c, idx) => ({
    ...c,
    rankPosition: idx + 1,
  }));
  
  const avgPenalty = diversityPenalties.length > 0
    ? diversityPenalties.reduce((a, b) => a + b, 0) / diversityPenalties.length
    : 0;
  
  return {
    candidates: rankedCandidates,
    meta: {
      inputCount: candidates.length,
      outputCount: rankedCandidates.length,
      lambda,
      diversityPenalties,
      averageDiversityPenalty: avgPenalty,
    },
  };
}
