/**
 * Infer outfit slots (tops, bottoms, shoes, bags, …) from wardrobe item images
 * using multi-detection YOLO — fixes complete-look when category_id was never set
 * or one photo contains several garments.
 */
import { extractOutfitComposition, getYOLOv8Client } from "../image/yolov8Client";
import { mapDetectionToCategory } from "../detection/categoryMapper";

const DEFAULT_MIN_CONFIDENCE = 0.32;
const RETRY_MIN_CONFIDENCE = 0.24;

/** Map YOLO / product taxonomy → slots used by wardrobe complete-look. */
export function productCategoryToWardrobeSlot(productCategory: string): string | null {
  const c = productCategory.toLowerCase().trim();
  if (!c) return null;
  if (c === "footwear") return "shoes";
  if (c === "tops" || c === "bottoms" || c === "dresses" || c === "outerwear") return c;
  if (c === "bags" || c === "accessories") return c;
  return null;
}

/**
 * Run YOLO on an image buffer and return normalized wardrobe slots present in-frame.
 */
export async function inferWardrobeSlotsFromImageBuffer(
  imageBuffer: Buffer,
  minConfidence: number = DEFAULT_MIN_CONFIDENCE
): Promise<Set<string>> {
  const slots = new Set<string>();
  try {
    const client = getYOLOv8Client();
    const primary = await client.detectFromBuffer(imageBuffer, "wardrobe-complete-look.jpg", {
      confidence: minConfidence,
    });
    let detections = primary?.detections;
    if (!primary?.success || !Array.isArray(detections) || detections.length === 0) {
      const retry = await client.detectFromBuffer(imageBuffer, "wardrobe-complete-look.jpg", {
        confidence: Math.min(minConfidence, RETRY_MIN_CONFIDENCE),
        preprocessing: {
          enhanceContrast: true,
          enhanceSharpness: true,
          bilateralFilter: true,
        },
      });
      detections = retry?.detections;
    }
    if (!Array.isArray(detections) || detections.length === 0) return slots;

    const composition = extractOutfitComposition(detections);
    if (composition.tops.length) slots.add("tops");
    if (composition.bottoms.length) slots.add("bottoms");
    if (composition.dresses.length) slots.add("dresses");
    if (composition.outerwear.length) slots.add("outerwear");
    if (composition.footwear.length) slots.add("shoes");
    if (composition.bags.length) slots.add("bags");
    if (composition.accessories.length) slots.add("accessories");

    // Also map any detection that extractOutfitComposition skipped (unknown labels)
    for (const d of detections) {
      if (d.confidence < Math.min(minConfidence, RETRY_MIN_CONFIDENCE)) continue;
      const mapped = mapDetectionToCategory(d.label, d.confidence).productCategory;
      const slot = productCategoryToWardrobeSlot(mapped);
      if (slot) slots.add(slot);
    }
  } catch {
    // YOLO optional in dev — complete-look still works from DB categories only
  }
  return slots;
}

export async function inferWardrobeSlotsFromImageUrl(imageUrl: string): Promise<Set<string>> {
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 12_000);
    const response = await fetch(imageUrl, { signal: ac.signal }).finally(() => clearTimeout(timer));
    if (!response.ok) return new Set();
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return inferWardrobeSlotsFromImageBuffer(buffer);
  } catch {
    return new Set();
  }
}

/**
 * Union slots from all items that have a fetchable image URL.
 */
export async function inferWardrobeSlotsFromWardrobeRows(
  rows: Array<{ image_url?: string | null; image_cdn?: string | null }>
): Promise<Set<string>> {
  const merged = new Set<string>();
  const seenUrls = new Set<string>();

  for (const row of rows) {
    const url = row.image_cdn || row.image_url;
    if (!url || seenUrls.has(url)) continue;
    seenUrls.add(url);
    const fromImage = await inferWardrobeSlotsFromImageUrl(url);
    for (const s of fromImage) merged.add(s);
  }

  return merged;
}
