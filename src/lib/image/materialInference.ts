import sharp from "sharp";

export interface TextureMaterialInference {
  material: string;
  confidence: number;
  candidates: string[];
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function isTopLike(text: string): boolean {
  return /\b(top|shirt|tee|t-?shirt|blouse|sweater|hoodie|cardigan|pullover|jumper|jacket|coat|blazer)\b/.test(text);
}

function isBottomLike(text: string): boolean {
  return /\b(pant|pants|trouser|trousers|jean|jeans|chino|chinos|cargo|short|shorts|skirt|skirts|legging|leggings)\b/.test(text);
}

function isFootwear(text: string): boolean {
  return /\b(shoe|shoes|sneaker|sneakers|trainer|trainers|boot|boots|loafer|loafers|sandal|sandals|flat|flats)\b/.test(text);
}

function isOuterwear(text: string): boolean {
  return /\b(jacket|coat|blazer|parka|windbreaker|vest|gilet|anorak|bomber)\b/.test(text);
}

function defaultMaterialForCategory(text: string): string {
  if (isFootwear(text)) return "leather";
  if (isOuterwear(text)) return "polyester";
  if (isBottomLike(text)) return "cotton";
  return "cotton";
}

type Candidate = { material: string; score: number };

export async function inferMaterialFromTextureCrop(params: {
  clipBuffer: Buffer;
  productCategory: string;
  detectionLabel: string;
}): Promise<TextureMaterialInference> {
  const categoryText = `${params.productCategory} ${params.detectionLabel}`.toLowerCase();
  const topLike = isTopLike(categoryText);
  const bottomLike = isBottomLike(categoryText);
  const footwear = isFootwear(categoryText);
  const outerwear = isOuterwear(categoryText);

  try {
    const { data, info } = await sharp(params.clipBuffer)
      .resize(48, 48, { fit: "cover" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const channels = info.channels;
    if (channels < 3 || info.width <= 0 || info.height <= 0) {
      const material = defaultMaterialForCategory(categoryText);
      return { material, confidence: 0.2, candidates: [material] };
    }

    const width = info.width;
    const height = info.height;
    let lumSum = 0;
    let lumSqSum = 0;
    let satSum = 0;
    let brightCount = 0;
    let blueBiasSum = 0;
    let edgeSum = 0;
    let edgeCount = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * channels;
        const r = data[idx] ?? 0;
        const g = data[idx + 1] ?? 0;
        const b = data[idx + 2] ?? 0;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        const sat = max > 0 ? (max - min) / max : 0;

        lumSum += lum;
        lumSqSum += lum * lum;
        satSum += sat;
        if (lum > 205) brightCount += 1;
        blueBiasSum += Math.max(0, b - Math.max(r, g));

        if (x + 1 < width) {
          const rightIdx = idx + channels;
          const r2 = data[rightIdx] ?? 0;
          const g2 = data[rightIdx + 1] ?? 0;
          const b2 = data[rightIdx + 2] ?? 0;
          edgeSum += Math.abs(lum - (0.299 * r2 + 0.587 * g2 + 0.114 * b2));
          edgeCount += 1;
        }

        if (y + 1 < height) {
          const downIdx = idx + width * channels;
          const r2 = data[downIdx] ?? 0;
          const g2 = data[downIdx + 1] ?? 0;
          const b2 = data[downIdx + 2] ?? 0;
          edgeSum += Math.abs(lum - (0.299 * r2 + 0.587 * g2 + 0.114 * b2));
          edgeCount += 1;
        }
      }
    }

    const pixelCount = Math.max(1, width * height);
    const meanLum = lumSum / pixelCount / 255;
    const variance = Math.max(0, lumSqSum / pixelCount - (lumSum / pixelCount) ** 2);
    const lumStd = Math.sqrt(variance) / 255;
    const meanSat = satSum / pixelCount;
    const brightRatio = brightCount / pixelCount;
    const blueBias = clamp01((blueBiasSum / pixelCount - 4) / 48);
    const edgeScore = clamp01(edgeCount > 0 ? (edgeSum / edgeCount) / 46 : 0);
    const smoothScore = 1 - edgeScore;
    const matteScore = clamp01(1 - meanSat * 0.95);
    const glossScore = clamp01(brightRatio * 0.7 + (1 - meanSat) * 0.15 + Math.max(0, meanLum - 0.65) * 0.35);

    const candidates: Candidate[] = [
      {
        material: "cotton",
        score: 0.26 + smoothScore * 0.42 + matteScore * 0.1 + (topLike || bottomLike ? 0.1 : 0) - glossScore * 0.05,
      },
      {
        material: "jersey",
        score: 0.23 + smoothScore * 0.38 + matteScore * 0.08 + (topLike ? 0.12 : 0),
      },
      {
        material: "knit",
        score: 0.18 + edgeScore * 0.48 + matteScore * 0.08 + (topLike ? 0.14 : 0),
      },
      {
        material: "wool",
        score: 0.17 + edgeScore * 0.38 + matteScore * 0.14 + (outerwear || /\b(sweater|cardigan|pullover|jumper)\b/.test(categoryText) ? 0.12 : 0),
      },
      {
        material: "linen",
        score: 0.18 + edgeScore * 0.22 + matteScore * 0.16 + (meanLum > 0.58 ? 0.08 : 0) + (topLike || bottomLike ? 0.06 : 0),
      },
      {
        material: "polyester",
        score: 0.2 + smoothScore * 0.28 + glossScore * 0.22 + (outerwear ? 0.1 : 0) + (footwear ? 0.06 : 0),
      },
      {
        material: "nylon",
        score: 0.2 + smoothScore * 0.3 + glossScore * 0.18 + (outerwear ? 0.12 : 0) + (footwear ? 0.1 : 0),
      },
      {
        material: "leather",
        score: 0.22 + smoothScore * 0.34 + glossScore * 0.14 + (footwear ? 0.14 : 0) + (outerwear ? 0.08 : 0),
      },
      {
        material: "suede",
        score: 0.18 + edgeScore * 0.2 + matteScore * 0.24 + (footwear ? 0.16 : 0) + (outerwear ? 0.08 : 0),
      },
      {
        material: "denim",
        score: 0.16 + edgeScore * 0.24 + blueBias * 0.42 + (bottomLike ? 0.14 : 0) + (/\b(jean|jeans|denim)\b/.test(categoryText) ? 0.18 : 0),
      },
      {
        material: "mesh",
        score: 0.18 + edgeScore * 0.3 + glossScore * 0.08 + (footwear ? 0.14 : 0) + (outerwear ? 0.04 : 0),
      },
      {
        material: "canvas",
        score: 0.17 + edgeScore * 0.18 + matteScore * 0.18 + (footwear ? 0.14 : 0),
      },
      {
        material: "satin",
        score: 0.15 + smoothScore * 0.24 + glossScore * 0.42 + (meanLum > 0.62 ? 0.08 : 0),
      },
      {
        material: "silk",
        score: 0.14 + smoothScore * 0.28 + glossScore * 0.4 + (meanLum > 0.6 ? 0.08 : 0),
      },
    ];

    candidates.sort((a, b) => b.score - a.score || a.material.localeCompare(b.material));
    const best = candidates[0] ?? { material: defaultMaterialForCategory(categoryText), score: 0.2 };
    const runnerUp = candidates[1]?.score ?? 0;
    const confidence = clamp01(best.score * 0.68 + Math.max(0, best.score - runnerUp) * 0.55);

    return {
      material: best.material,
      confidence,
      candidates: candidates.slice(0, 3).map((candidate) => candidate.material),
    };
  } catch {
    const material = defaultMaterialForCategory(categoryText);
    return {
      material,
      confidence: 0.2,
      candidates: [material],
    };
  }
}