/**
 * Normalized fashion detection boundary (YOLOv8 / service); keeps shop-the-look logic behind one API.
 */

import { getYOLOv8Client, type Detection } from "./yolov8Client";

export type DetectionSource = "yolov8" | "yolos";

export interface DetectionCropHint {
  paddedBox: [number, number, number, number];
  areaRatio: number;
}

export interface DetectionResult {
  label: string;
  confidence: number;
  bbox: [number, number, number, number];
  source: DetectionSource;
  cropHint?: DetectionCropHint;
  /** Raw service detection for compatibility with existing pipelines */
  raw?: Detection;
}

function boxToBbox(box: { x1: number; y1: number; x2: number; y2: number }): [number, number, number, number] {
  return [box.x1, box.y1, box.x2, box.y2];
}

export interface RunDetectionOptions {
  confidence?: number;
  filename?: string;
  /** If true, return only the single best garment by confidence × area_ratio */
  bestGarmentOnly?: boolean;
}

/**
 * Run detector on image bytes; maps service `Detection` into `DetectionResult`.
 */
export async function runFashionDetection(
  image: Buffer,
  options: RunDetectionOptions = {},
): Promise<DetectionResult[]> {
  const { confidence = 0.25, filename = "query.jpg", bestGarmentOnly = false } = options;
  const client = getYOLOv8Client();
  const snap = await client.getHealthSnapshot().catch(() => ({ available: false as const }));
  if (!snap.available) {
    return [];
  }

  const res = await client.detectFromBuffer(image, filename, { confidence }).catch(() => null);
  const list = res?.detections ?? [];
  let mapped: DetectionResult[] = list.map((d: Detection) => ({
    label: String(d.label ?? ""),
    confidence: typeof d.confidence === "number" ? d.confidence : 0,
    bbox: d.box ? boxToBbox(d.box) : [0, 0, 0, 0],
    source: "yolov8" as const,
    cropHint:
      d.box && typeof d.area_ratio === "number"
        ? {
            paddedBox: boxToBbox(d.box),
            areaRatio: d.area_ratio,
          }
        : undefined,
    raw: d,
  }));

  if (bestGarmentOnly && mapped.length > 0) {
    mapped = [...mapped].sort((a, b) => {
      const sa = a.confidence * (a.cropHint?.areaRatio ?? 0);
      const sb = b.confidence * (b.cropHint?.areaRatio ?? 0);
      return sb - sa;
    });
    mapped = mapped.slice(0, 1);
  }

  return mapped;
}
