#!/usr/bin/env tsx
import "dotenv/config";
import { osClient } from "../src/lib/core/opensearch";
import sharp from "sharp";
import axios from "axios";

const INDEX = process.env.OPENSEARCH_INDEX || (require("../src/config").config.opensearch.index);
const BATCH_SIZE = parseInt(process.env.UPDATE_COLOR_BATCH || "100", 10);
const MAX_CONCURRENCY = parseInt(process.env.UPDATE_COLOR_CONCURRENCY || "6", 10);

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

async function computeLabAndHueHistFromBuffer(buf: Buffer) {
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
    const res = await axios.get(url, { responseType: "arraybuffer", timeout: 20000, headers: { 'User-Agent': 'FashionIndexer/1.0' } });
    return Buffer.from(res.data);
  } catch (err) {
    return null;
  }
}

async function main() {
  console.log(`Update color descriptors — index=${INDEX} batch=${BATCH_SIZE}`);

  let searchAfter: any[] | undefined;
  let totalUpdated = 0;

  while (true) {
    const body: any = {
      size: BATCH_SIZE,
      sort: [{ _id: 'asc' }],
      _source: ['image_cdn', 'images', 'color_lab_avg', 'color_hue_hist'],
      query: { bool: { must_not: [{ exists: { field: 'color_lab_avg' } }] } },
    };
    if (searchAfter) body.search_after = searchAfter;

    const resp = await osClient.search({ index: INDEX, body });
    const hits = resp.body.hits.hits as any[];
    if (!hits.length) break;

    const updates: any[] = [];

    // process in parallel with limited concurrency
    const concurrency = Math.min(MAX_CONCURRENCY, hits.length);
    let idx = 0;
    async function worker() {
      while (idx < hits.length) {
        const i = idx++;
        const hit = hits[i];
        const id = hit._id;
        const src = hit._source || {};
        let imageUrl = src.image_cdn || (Array.isArray(src.images) && src.images[0]?.url) || null;
        if (!imageUrl) {
          console.warn(`  [${id}] no image URL, skipping`);
          continue;
        }
        const buf = await fetchImageBuffer(imageUrl);
        if (!buf) {
          console.warn(`  [${id}] failed to fetch image`);
          continue;
        }
        try {
          const { lab, hist } = await computeLabAndHueHistFromBuffer(buf);
          updates.push({ id, lab, hist });
        } catch (err) {
          console.warn(`  [${id}] failed compute: ${String(err)}`);
        }
      }
    }
    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    if (updates.length > 0) {
      const bodyBulk: any[] = [];
      for (const u of updates) {
        bodyBulk.push({ update: { _index: INDEX, _id: u.id } });
        bodyBulk.push({ doc: { color_lab_avg: u.lab, color_hue_hist: u.hist } });
      }
      const bulkRes = await osClient.bulk({ body: bodyBulk, refresh: false });
      const failed = (bulkRes.body.items ?? []).filter((it:any) => it.update?.error).length;
      totalUpdated += updates.length - failed;
      console.log(`  processed ${hits.length}, updated ${updates.length - failed}, failed ${failed}`);
    } else {
      console.log(`  processed ${hits.length}, nothing to update`);
    }

    searchAfter = hits[hits.length - 1]?.sort;
  }

  console.log(`Done. Total updated: ${totalUpdated}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
