#!/usr/bin/env tsx
import "dotenv/config";
import { osClient } from "../src/lib/core/opensearch";
import sharp from "sharp";
import axios from "axios";

const INDEX = process.env.OPENSEARCH_INDEX || (require("../src/config").config.opensearch.index);

function rgbToXyz(r: number, g: number, b: number) {
  const srgb = [r, g, b].map((v) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  const [R, G, B] = srgb;
  return [
    R * 0.4124564 + G * 0.3575761 + B * 0.1804375,
    R * 0.2126729 + G * 0.7151522 + B * 0.0721750,
    R * 0.0193339 + G * 0.1191920 + B * 0.9503041,
  ];
}
function xyzToLab(x: number, y: number, z: number) {
  const xr = x / 0.95047;
  const yr = y / 1.0;
  const zr = z / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(xr);
  const fy = f(yr);
  const fz = f(zr);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function deltaE76(lab1: number[], lab2: number[]) {
  const dl = lab1[0] - lab2[0];
  const da = lab1[1] - lab2[1];
  const db = lab1[2] - lab2[2];
  return Math.sqrt(dl * dl + da * da + db * db);
}

function colorSimFromDeltaE(deltaE: number, sigma = 20) {
  return Math.exp(-(deltaE * deltaE) / (2 * sigma * sigma));
}

function histIntersection(a: number[], b: number[]) {
  const n = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.min(a[i] ?? 0, b[i] ?? 0);
  return sum; // both hist normalized => in [0,1]
}

async function computeQueryLabAndHistFromBuffer(buf: Buffer) {
  const { data, info } = await sharp(buf).resize(32, 32, { fit: "inside" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  let rSum = 0, gSum = 0, bSum = 0, count = 0;
  const hues: number[] = [];
  for (let i = 0; i < data.length; i += ch) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    rSum += r; gSum += g; bSum += b; count++;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0;
    if (max === min) h = 0;
    else if (max === r) h = ((g - b) / (max - min)) * 60;
    else if (max === g) h = (2 + (b - r) / (max - min)) * 60;
    else h = (4 + (r - g) / (max - min)) * 60;
    if (h < 0) h += 360;
    hues.push(h);
  }
  const rAvg = rSum / Math.max(1, count);
  const gAvg = gSum / Math.max(1, count);
  const bAvg = bSum / Math.max(1, count);
  const [x, y, z] = rgbToXyz(rAvg, gAvg, bAvg);
  const lab = xyzToLab(x, y, z);
  const bins = 12;
  const hist = new Array(bins).fill(0);
  for (const h of hues) {
    const idx = Math.floor((h / 360) * bins) % bins;
    hist[idx]++;
  }
  const histNorm = hist.map((c) => c / Math.max(1, hues.length));
  return { lab, hist: histNorm };
}

async function fetchImageBuffer(url: string): Promise<Buffer | null> {
  try {
    const res = await axios.get(url, { responseType: "arraybuffer", timeout: 15000, headers: { 'User-Agent': 'FashionSearch/1.0' } });
    return Buffer.from(res.data);
  } catch (err) {
    return null;
  }
}

async function searchByEmbedding(embedding: number[], topK = 100) {
  // Assumes an OpenSearch kNN vector field `embedding` exists and script_score supported
  const body: any = {
    size: topK,
    _source: ["product_id", "image_cdn", "images", "color_lab_avg", "color_hue_hist"],
    query: {
      script_score: {
        query: { match_all: {} },
        script: {
          source: "cosineSimilarity(params.query_vector, 'embedding') + 1.0",
          params: { query_vector: embedding },
        },
      },
    },
  };
  const resp = await osClient.search({ index: INDEX, body });
  return resp.body.hits.hits as any[];
}

async function rerankFromQueryImage(queryImagePathOrUrl: string, opts?: { topK?: number; w?: number; sigma?: number }) {
  const topK = opts?.topK ?? 100;
  const w = opts?.w ?? 0.2;
  const sigma = opts?.sigma ?? 20;

  const buf = queryImagePathOrUrl.startsWith("http") ? await fetchImageBuffer(queryImagePathOrUrl) : await (async () => require("fs").promises.readFile(queryImagePathOrUrl))();
  if (!buf) throw new Error("Could not read query image");

  // Compute descriptors for query
  const { lab: qLab, hist: qHist } = await computeQueryLabAndHistFromBuffer(buf);

  // Compute query embedding using existing service — here we expect user-provided embedding via file for demo
  // For now require an embedding file path via env QUERY_EMBEDDING_PATH, else abort.
  const embPath = process.env.QUERY_EMBEDDING_PATH;
  if (!embPath) throw new Error("Set QUERY_EMBEDDING_PATH to a JSON file containing the query embedding array");
  const queryEmb = JSON.parse(require("fs").readFileSync(embPath, "utf-8"));

  const hits = await searchByEmbedding(queryEmb, topK);

  const scored = [] as Array<any>;
  for (const h of hits) {
    const src = h._source || {};
    const visualSim = h._score ? (h._score - 0) / 2.0 : 0; // script returned cosine+1, normalize approx
    const lab = src.color_lab_avg;
    const hist = src.color_hue_hist;
    let colorScore = 0;
    if (lab && Array.isArray(lab) && lab.length === 3) {
      const dE = deltaE76(qLab, lab);
      colorScore = colorSimFromDeltaE(dE, sigma);
    }
    if (hist && Array.isArray(hist) && hist.length > 0) {
      const hscore = histIntersection(qHist, hist);
      // combine histogram with lab-based color score
      colorScore = Math.max(colorScore, hscore * 0.95 + colorScore * 0.05);
    }
    const final = (1 - w) * visualSim + w * colorScore;
    scored.push({ id: h._id, product_id: src.product_id, visualSim, colorScore, final, src });
  }

  scored.sort((a, b) => b.final - a.final);
  return scored;
}

// CLI
async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.log("Usage: npx tsx scripts/query-color-rerank.ts <queryImagePath|URL> --embed=path/to/embedding.json [--topK=50] [--w=0.2] [--sigma=20]");
    process.exit(1);
  }
  const q = args[0];
  const opts: any = {};
  for (const a of args.slice(1)) {
    if (a.startsWith("--embed=")) process.env.QUERY_EMBEDDING_PATH = a.split("=")[1];
    if (a.startsWith("--topK=")) opts.topK = parseInt(a.split("=")[1], 10);
    if (a.startsWith("--w=")) opts.w = parseFloat(a.split("=")[1]);
    if (a.startsWith("--sigma=")) opts.sigma = parseFloat(a.split("=")[1]);
  }
  const out = await rerankFromQueryImage(q, opts);
  console.log(JSON.stringify(out.slice(0, opts.topK ?? 50), null, 2));
}

main().catch((err) => { console.error(err); process.exit(1); });
