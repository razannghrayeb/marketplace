import { getQueryEmbedding } from "../queryProcessor";

function l2Normalize(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  if (n < 1e-8) return v;
  return v.map((x) => x / n);
}

function meanVec(vectors: number[][]): number[] | null {
  if (!vectors.length) return null;
  const d = vectors[0].length;
  const out = new Array(d).fill(0);
  for (const v of vectors) {
    if (v.length !== d) continue;
    for (let i = 0; i < d; i++) out[i] += v[i];
  }
  for (let i = 0; i < d; i++) out[i] /= vectors.length;
  return l2Normalize(out);
}

function cosineSim(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

let fashionPrototype: number[] | null = null;

async function loadFashionTextPrototype(): Promise<number[] | null> {
  if (fashionPrototype?.length) return fashionPrototype;
  const seeds = [
    "dress",
    "jeans",
    "sneakers",
    "jacket",
    "handbag",
    "scarf",
    "suit",
    "abaya",
  ];
  const vecs: number[][] = [];
  for (const s of seeds) {
    const v = await getQueryEmbedding(s);
    if (v?.length) vecs.push(l2Normalize(v));
  }
  fashionPrototype = meanVec(vecs);
  return fashionPrototype;
}

/**
 * CLIP text space alignment of the query with a small fashion seed prototype.
 * Returns ~0..1 (cosine mapped to [0,1] roughly). Null if embeddings unavailable.
 */
export async function computeEmbeddingFashionScore(rawQuery: string): Promise<number | null> {
  const q = rawQuery.trim();
  if (!q) return null;
  const [qEmb, proto] = await Promise.all([getQueryEmbedding(q), loadFashionTextPrototype()]);
  if (!qEmb?.length || !proto?.length) return null;
  const sim = cosineSim(l2Normalize(qEmb), proto);
  return Math.max(0, Math.min(1, (sim + 1) / 2));
}
