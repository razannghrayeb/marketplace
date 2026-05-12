/**
 * Fashion-CLIP zero-shot style classifier.
 *
 * Computes soft probability distributions over aesthetic / occasion / formality
 * from a product image embedding by cosine-similarity to pre-computed text
 * prompt embeddings.
 *
 * Why: replaces the hard-label rules (CATEGORY_STYLE_MAP, calibrateSourceStyle…)
 * with a continuous signal. Used as a *low-weight additive* boost in the rerank
 * (not a replacement) so that bad inference can never drag results below
 * baseline. Default-OFF via STYLE_CLIP_INFERENCE_ENABLED env flag.
 *
 * Safety design:
 *   - Single one-time initialisation (prompt embeddings are computed once and
 *     cached for the process lifetime).
 *   - Persistent init failure is sticky: we don't retry inside the same process
 *     so a transient CLIP outage doesn't pile up requests.
 *   - All public functions return null/empty distributions on any failure;
 *     callers must handle absence gracefully.
 *   - No side effects: no DB writes, no schema changes.
 */

import { getTextEmbedding, cosineSimilarity } from "../image";

export type Aesthetic =
  | "classic"
  | "modern"
  | "bohemian"
  | "minimalist"
  | "streetwear"
  | "romantic"
  | "edgy"
  | "sporty";

export type Occasion =
  | "formal"
  | "semi-formal"
  | "casual"
  | "active"
  | "party"
  | "beach";

export interface StyleAttributeDistribution {
  /** Softmax over the 8 aesthetics — entries sum to ~1. */
  aesthetic: Record<Aesthetic, number>;
  /** Softmax over the 6 occasions — entries sum to ~1. */
  occasion: Record<Occasion, number>;
  /** Expected formality on a 1-10 scale (linear blend of "casual/smart-casual/business/formal" probs). */
  formality: number;
  /** Top aesthetic label (argmax) — convenient for code that still wants a single label. */
  topAesthetic: Aesthetic;
  /** Top occasion label (argmax). */
  topOccasion: Occasion;
  /** Margin of the top aesthetic vs second-best — useful as a confidence proxy. */
  aestheticMargin: number;
}

const AESTHETIC_PROMPTS: Record<Aesthetic, string> = {
  classic: "a classic, timeless, elegant outfit",
  modern: "a modern, contemporary, sleek outfit",
  bohemian: "a bohemian, boho, flowy outfit",
  minimalist: "a minimalist, clean, simple outfit",
  streetwear: "a streetwear, urban, casual cool outfit",
  romantic: "a romantic, feminine, soft outfit",
  edgy: "an edgy, bold, rock-inspired outfit",
  sporty: "a sporty, athletic, activewear outfit",
};

const OCCASION_PROMPTS: Record<Occasion, string> = {
  formal: "outfit for a formal event, gala, black tie",
  "semi-formal": "outfit for a business meeting, cocktail event, smart casual",
  casual: "outfit for everyday casual wear, weekend, errands",
  active: "outfit for the gym, workout, athletic activity",
  party: "outfit for a party, night out, club",
  beach: "outfit for the beach, pool, vacation",
};

// Ordinal anchors for formality estimation. We project the candidate's image
// onto these four anchors and compute an expected formality score on 1-10.
const FORMALITY_ANCHORS: Array<{ prompt: string; score: number }> = [
  { prompt: "a casual, relaxed outfit", score: 2 },
  { prompt: "a smart casual outfit", score: 5 },
  { prompt: "a business professional outfit", score: 7 },
  { prompt: "a formal black tie outfit", score: 9.5 },
];

interface CachedEmbeddings {
  aesthetic: Array<{ key: Aesthetic; vec: number[] }>;
  occasion: Array<{ key: Occasion; vec: number[] }>;
  formality: Array<{ score: number; vec: number[] }>;
}

let cachedEmbeddings: CachedEmbeddings | null = null;
let initPromise: Promise<CachedEmbeddings | null> | null = null;
let initFailedPermanently = false;

export function isStyleClipInferenceEnabled(): boolean {
  return String(process.env.STYLE_CLIP_INFERENCE_ENABLED || "").toLowerCase() === "true";
}

/** One-time prompt-embedding init. Returns null if CLIP text encoder is unavailable. */
async function ensurePromptEmbeddings(): Promise<CachedEmbeddings | null> {
  if (cachedEmbeddings) return cachedEmbeddings;
  if (initFailedPermanently) return null;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const aestheticEntries = Object.entries(AESTHETIC_PROMPTS) as Array<[Aesthetic, string]>;
      const occasionEntries = Object.entries(OCCASION_PROMPTS) as Array<[Occasion, string]>;

      const aesthetic: CachedEmbeddings["aesthetic"] = [];
      for (const [key, prompt] of aestheticEntries) {
        const vec = await getTextEmbedding(prompt);
        if (!Array.isArray(vec) || vec.length === 0) {
          throw new Error(`Empty embedding for aesthetic prompt: ${key}`);
        }
        aesthetic.push({ key, vec });
      }

      const occasion: CachedEmbeddings["occasion"] = [];
      for (const [key, prompt] of occasionEntries) {
        const vec = await getTextEmbedding(prompt);
        if (!Array.isArray(vec) || vec.length === 0) {
          throw new Error(`Empty embedding for occasion prompt: ${key}`);
        }
        occasion.push({ key, vec });
      }

      const formality: CachedEmbeddings["formality"] = [];
      for (const anchor of FORMALITY_ANCHORS) {
        const vec = await getTextEmbedding(anchor.prompt);
        if (!Array.isArray(vec) || vec.length === 0) {
          throw new Error(`Empty embedding for formality anchor: ${anchor.prompt}`);
        }
        formality.push({ score: anchor.score, vec });
      }

      cachedEmbeddings = { aesthetic, occasion, formality };
      console.log("[styleAttributesClip] prompt embeddings cached", {
        aesthetic: aesthetic.length,
        occasion: occasion.length,
        formality: formality.length,
      });
      return cachedEmbeddings;
    } catch (err) {
      console.warn("[styleAttributesClip] init failed; classifier disabled for process lifetime:", err);
      initFailedPermanently = true;
      return null;
    }
  })();

  return initPromise;
}

/**
 * Softmax with temperature. Lower temperature = sharper distribution.
 * Cosine similarities for CLIP usually fall in [-0.2, 0.5]; tau=0.05 gives
 * useful separation without collapsing to one-hot.
 */
function softmax(scores: number[], tau: number = 0.05): number[] {
  if (scores.length === 0) return [];
  const max = Math.max(...scores);
  const exps = scores.map((s) => Math.exp((s - max) / Math.max(0.001, tau)));
  const sum = exps.reduce((a, b) => a + b, 0);
  return sum > 0 ? exps.map((e) => e / sum) : scores.map(() => 1 / scores.length);
}

/**
 * Classify a product image embedding into aesthetic / occasion / formality.
 * Returns null when CLIP text encoder is unavailable or embedding is malformed.
 */
export async function classifyStyleAttributesFromEmbedding(
  imageEmbedding: number[] | null | undefined,
): Promise<StyleAttributeDistribution | null> {
  if (!Array.isArray(imageEmbedding) || imageEmbedding.length === 0) return null;
  const embeddings = await ensurePromptEmbeddings();
  if (!embeddings) return null;

  try {
    // Dimension sanity check — guards against mixed-model scenarios where the
    // anchor was indexed with a different CLIP variant than what's loaded now.
    const dim = imageEmbedding.length;
    if (
      embeddings.aesthetic[0]?.vec.length !== dim ||
      embeddings.occasion[0]?.vec.length !== dim ||
      embeddings.formality[0]?.vec.length !== dim
    ) {
      console.warn("[styleAttributesClip] embedding dim mismatch; skipping", {
        anchor: dim,
        prompt: embeddings.aesthetic[0]?.vec.length,
      });
      return null;
    }

    const aestheticScores = embeddings.aesthetic.map((p) => cosineSimilarity(imageEmbedding, p.vec));
    const occasionScores = embeddings.occasion.map((p) => cosineSimilarity(imageEmbedding, p.vec));
    const formalityScores = embeddings.formality.map((p) => cosineSimilarity(imageEmbedding, p.vec));

    const aestheticProbs = softmax(aestheticScores);
    const occasionProbs = softmax(occasionScores);
    const formalityProbs = softmax(formalityScores, 0.04);

    const aestheticDist: Record<Aesthetic, number> = {} as Record<Aesthetic, number>;
    embeddings.aesthetic.forEach((p, i) => {
      aestheticDist[p.key] = aestheticProbs[i] ?? 0;
    });
    const occasionDist: Record<Occasion, number> = {} as Record<Occasion, number>;
    embeddings.occasion.forEach((p, i) => {
      occasionDist[p.key] = occasionProbs[i] ?? 0;
    });
    const expectedFormality =
      embeddings.formality.reduce((acc, anchor, i) => acc + anchor.score * (formalityProbs[i] ?? 0), 0);

    // Top label + margin
    const sortedAesthetic = embeddings.aesthetic
      .map((p, i) => ({ key: p.key, prob: aestheticProbs[i] ?? 0 }))
      .sort((a, b) => b.prob - a.prob);
    const sortedOccasion = embeddings.occasion
      .map((p, i) => ({ key: p.key, prob: occasionProbs[i] ?? 0 }))
      .sort((a, b) => b.prob - a.prob);
    const aestheticMargin = (sortedAesthetic[0]?.prob ?? 0) - (sortedAesthetic[1]?.prob ?? 0);

    return {
      aesthetic: aestheticDist,
      occasion: occasionDist,
      formality: Math.max(1, Math.min(10, expectedFormality)),
      topAesthetic: (sortedAesthetic[0]?.key ?? "classic") as Aesthetic,
      topOccasion: (sortedOccasion[0]?.key ?? "casual") as Occasion,
      aestheticMargin,
    };
  } catch (err) {
    console.warn("[styleAttributesClip] classify failed:", err);
    return null;
  }
}

/**
 * Score how well a candidate (with a *labeled* aesthetic — e.g. from
 * buildStyleProfile) aligns with a source's *probability distribution* over
 * aesthetics. Returns a value in [0,1].
 *
 * This is "soft scoring": instead of a binary match/mismatch on aesthetic,
 * we read the source's probability mass for the candidate's labeled aesthetic
 * (plus a similarity-weighted neighbour bonus).
 *
 * Returns 0.5 (neutral) when distribution or label is unavailable, so missing
 * signal is treated as no opinion, not as a penalty.
 */
export function scoreSoftAestheticAlignment(
  sourceDistribution: StyleAttributeDistribution | null,
  candidateAesthetic: string | null | undefined,
): number {
  if (!sourceDistribution || !candidateAesthetic) return 0.5;
  const candKey = String(candidateAesthetic).toLowerCase().trim() as Aesthetic;
  const directProb = sourceDistribution.aesthetic[candKey];
  if (directProb == null) return 0.5;

  // Neighbour bonus: aesthetics that frequently co-occur with the source's top
  // aesthetic still get credit, just less than the exact match.
  const NEIGHBOURS: Record<Aesthetic, Aesthetic[]> = {
    classic: ["minimalist", "modern", "romantic"],
    modern: ["minimalist", "classic", "streetwear"],
    bohemian: ["romantic", "classic", "modern"],
    minimalist: ["modern", "classic"],
    streetwear: ["sporty", "modern", "edgy"],
    romantic: ["classic", "bohemian", "minimalist"],
    edgy: ["streetwear", "modern", "sporty"],
    sporty: ["streetwear", "modern", "minimalist"],
  };
  const top = sourceDistribution.topAesthetic;
  const isNeighbour = NEIGHBOURS[top]?.includes(candKey) ?? false;
  // Direct probability is the main signal; a "neighbouring" candidate gets a
  // small floor so plausible-but-not-exact matches aren't penalised.
  const neighbourFloor = isNeighbour ? 0.55 : 0;
  // Re-scale: directProb is typically 0.05-0.5 in a soft distribution. Map to
  // a [0,1] range with the top aesthetic landing near 1.
  const scaled = Math.min(1, directProb / Math.max(0.001, sourceDistribution.aesthetic[top] || 0.25));
  return Math.max(neighbourFloor, scaled);
}

/**
 * Score how well a candidate's labeled occasion aligns with the source's
 * occasion distribution. Same semantics as `scoreSoftAestheticAlignment`.
 */
export function scoreSoftOccasionAlignment(
  sourceDistribution: StyleAttributeDistribution | null,
  candidateOccasion: string | null | undefined,
): number {
  if (!sourceDistribution || !candidateOccasion) return 0.5;
  const candKey = String(candidateOccasion).toLowerCase().trim() as Occasion;
  const directProb = sourceDistribution.occasion[candKey];
  if (directProb == null) return 0.5;

  const top = sourceDistribution.topOccasion;
  // Occasion adjacency: nearby formality levels are partial matches.
  const ADJACENCY: Record<Occasion, Occasion[]> = {
    formal: ["semi-formal", "party"],
    "semi-formal": ["formal", "casual", "party"],
    casual: ["semi-formal", "active"],
    active: ["casual"],
    party: ["semi-formal", "formal"],
    beach: ["casual"],
  };
  const isAdjacent = ADJACENCY[top]?.includes(candKey) ?? false;
  const adjacencyFloor = isAdjacent ? 0.55 : 0;
  const scaled = Math.min(1, directProb / Math.max(0.001, sourceDistribution.occasion[top] || 0.25));
  return Math.max(adjacencyFloor, scaled);
}

/**
 * Composite soft-style score: blends aesthetic alignment + occasion alignment.
 * Used as a single low-weight signal in the rerank.
 *
 * Returns 0.5 (neutral) on any missing input — so the rerank treats it as a
 * non-signal rather than dragging scores down.
 */
export function scoreSoftStyleAlignment(
  sourceDistribution: StyleAttributeDistribution | null,
  candidateAesthetic: string | null | undefined,
  candidateOccasion: string | null | undefined,
): number {
  if (!sourceDistribution) return 0.5;
  const aestheticScore = scoreSoftAestheticAlignment(sourceDistribution, candidateAesthetic);
  const occasionScore = scoreSoftOccasionAlignment(sourceDistribution, candidateOccasion);
  // Confidence-weighted: if the source classification was very ambiguous
  // (low margin) we pull the result toward neutral so we don't propagate noise.
  const confidence = Math.min(1, Math.max(0.4, sourceDistribution.aestheticMargin * 4 + 0.5));
  const blended = aestheticScore * 0.6 + occasionScore * 0.4;
  return blended * confidence + 0.5 * (1 - confidence);
}

/**
 * Type guard / parser for distributions read back from Postgres (jsonb) or
 * OpenSearch (object). Defensive — tolerates missing keys, garbage values,
 * and partial backfills. Returns null when the payload is unusable.
 */
export function parseStoredAestheticDistribution(value: unknown): Record<Aesthetic, number> | null {
  if (!value || typeof value !== "object") return null;
  const keys: Aesthetic[] = [
    "classic",
    "modern",
    "bohemian",
    "minimalist",
    "streetwear",
    "romantic",
    "edgy",
    "sporty",
  ];
  const out = {} as Record<Aesthetic, number>;
  let sum = 0;
  for (const k of keys) {
    const v = (value as Record<string, unknown>)[k];
    const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
    if (!Number.isFinite(n) || n < 0) return null;
    out[k] = n;
    sum += n;
  }
  // Tolerate slightly off softmaxes (rounding/storage drift) but reject
  // anything obviously wrong (all zeros, single 9999, etc).
  if (sum < 0.5 || sum > 1.5) return null;
  // Renormalise to exactly 1 so downstream comparisons are clean.
  if (sum > 0 && Math.abs(sum - 1) > 1e-4) {
    for (const k of keys) out[k] = out[k] / sum;
  }
  return out;
}

export function parseStoredOccasionDistribution(value: unknown): Record<Occasion, number> | null {
  if (!value || typeof value !== "object") return null;
  const keys: Occasion[] = ["formal", "semi-formal", "casual", "active", "party", "beach"];
  const out = {} as Record<Occasion, number>;
  let sum = 0;
  for (const k of keys) {
    const v = (value as Record<string, unknown>)[k];
    const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
    if (!Number.isFinite(n) || n < 0) return null;
    out[k] = n;
    sum += n;
  }
  if (sum < 0.5 || sum > 1.5) return null;
  if (sum > 0 && Math.abs(sum - 1) > 1e-4) {
    for (const k of keys) out[k] = out[k] / sum;
  }
  return out;
}

/**
 * Symmetric distribution-vs-distribution alignment: 1 - JS divergence,
 * mapped into [0,1] with the easy region (good matches) at ~0.7-1.0 and
 * outright clashes at ~0.0-0.3.
 *
 * Use this when both the source and the candidate have been classified
 * by Fashion-CLIP. It's strictly better than the asymmetric
 * scoreSoftStyleAlignment(label) because both sides contribute soft signal.
 */
function jsDivergenceSimilarity(
  a: Record<string, number>,
  b: Record<string, number>,
): number {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  // Mid distribution = average of a and b.
  let kl_a = 0;
  let kl_b = 0;
  for (const k of keys) {
    const pa = a[k] ?? 0;
    const pb = b[k] ?? 0;
    const m = (pa + pb) / 2;
    if (m > 0) {
      if (pa > 0) kl_a += pa * Math.log(pa / m);
      if (pb > 0) kl_b += pb * Math.log(pb / m);
    }
  }
  // JS divergence is in [0, ln(2)≈0.693]. Map to similarity in [0,1] where
  // identical distributions give 1, completely disjoint give 0.
  const jsDiv = (kl_a + kl_b) / 2;
  return Math.max(0, Math.min(1, 1 - jsDiv / Math.LN2));
}

/**
 * Symmetric style alignment when both source and candidate have full
 * distributions (post-backfill). Combines aesthetic + occasion symmetry
 * and applies the same confidence dampening as the asymmetric version.
 *
 * Returns 0.5 (neutral) when either side is missing — caller should fall back
 * to `scoreSoftStyleAlignment` for partial coverage.
 */
export function scoreSymmetricStyleAlignment(
  source: StyleAttributeDistribution | null,
  candidate: {
    aesthetic: Record<Aesthetic, number> | null;
    occasion: Record<Occasion, number> | null;
    margin: number;
  } | null,
): number {
  if (!source || !candidate || !candidate.aesthetic || !candidate.occasion) return 0.5;
  const aestheticSim = jsDivergenceSimilarity(source.aesthetic, candidate.aesthetic);
  const occasionSim = jsDivergenceSimilarity(source.occasion, candidate.occasion);
  const blended = aestheticSim * 0.6 + occasionSim * 0.4;
  // Confidence: min of the two distributions' margins. If either side is
  // uncertain, pull toward neutral.
  const minMargin = Math.min(source.aestheticMargin, candidate.margin);
  const confidence = Math.min(1, Math.max(0.4, minMargin * 4 + 0.5));
  return blended * confidence + 0.5 * (1 - confidence);
}
