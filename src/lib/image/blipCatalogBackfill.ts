/**
 * Apply a BLIP caption to empty `products.description`, `color`, and `gender`.
 * Each column gets only column-specific extracted/normalized text (never the same raw caption string for all).
 */
import { pg, productsTableHasGenderColumn } from "../core/db";
import {
  catalogMaterialFromProductText,
  catalogOccasionFromProductText,
  catalogStyleFromProductText,
  catalogGenderFromCaption,
  catalogGenderFromProductText,
  inferCatalogFieldsFromProductText,
  primaryColorHintFromCaption,
  primaryColorHintFromProductText,
  productDescriptionFromProductText,
  productDescriptionFromCaption,
} from "./captionAttributeInference";
import { buildStructuredBlipOutput } from "./blipStructured";

export function isCatalogFieldBlank(value: unknown): boolean {
  if (value == null) return true;
  return String(value).trim().length === 0;
}

export interface ApplyBlipCaptionResult {
  updated: boolean;
  fields: string[];
}

const productsColumnCache = new Map<string, boolean>();

async function productsTableHasColumn(columnName: string): Promise<boolean> {
  if (productsColumnCache.has(columnName)) return productsColumnCache.get(columnName)!;
  const r = await pg.query<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'products' AND column_name = $1
    ) AS exists`,
    [columnName],
  );
  const exists = Boolean(r.rows?.[0]?.exists);
  productsColumnCache.set(columnName, exists);
  return exists;
}

/**
 * Fills only columns that are currently null/blank. Idempotent for unchanged rows.
 * @param dryRun If true, computes fields that would be set but does not execute UPDATE.
 */
export async function applyBlipCaptionToMissingProductFields(
  productId: number,
  caption: string,
  options?: { dryRun?: boolean },
): Promise<ApplyBlipCaptionResult> {
  const c = String(caption || "").trim();

  const hasGender = await productsTableHasGenderColumn();
  const [hasStyle, hasMaterial, hasOccasion, hasDetails] = await Promise.all([
    productsTableHasColumn("style"),
    productsTableHasColumn("material"),
    productsTableHasColumn("occasion"),
    productsTableHasColumn("details"),
  ]);
  const selectSql = hasGender
    ? `SELECT description, color, gender, title, category, ${hasDetails ? "details" : "NULL::text AS details"}, ${hasStyle ? "style" : "NULL::text AS style"},
              ${hasMaterial ? "material" : "NULL::text AS material"},
              ${hasOccasion ? "occasion" : "NULL::text AS occasion"}
       FROM products WHERE id = $1`
    : `SELECT description, color, title, category, ${hasDetails ? "details" : "NULL::text AS details"}, ${hasStyle ? "style" : "NULL::text AS style"},
              ${hasMaterial ? "material" : "NULL::text AS material"},
              ${hasOccasion ? "occasion" : "NULL::text AS occasion"}
       FROM products WHERE id = $1`;
  const row = await pg.query(selectSql, [productId]);
  if (row.rowCount === 0) return { updated: false, fields: [] };
  const cur = row.rows[0] as Record<string, unknown>;

  const updates: string[] = [];
  const vals: unknown[] = [];
  const fields: string[] = [];
  let pi = 1;
  const title = (cur as { title?: unknown }).title as string | null | undefined;
  const category = (cur as { category?: unknown }).category as string | null | undefined;
  const description = (cur as { description?: unknown }).description as string | null | undefined;
  const details = (cur as { details?: unknown }).details as string | null | undefined;
  const textHints = inferCatalogFieldsFromProductText(title, description, details);

  if (isCatalogFieldBlank(cur.description) && textHints.description) {
    updates.push(`description = $${pi++}`);
    vals.push(textHints.description);
    fields.push("description");
  }
  if (isCatalogFieldBlank(cur.color) && textHints.color) {
    updates.push(`color = $${pi++}`);
    vals.push(textHints.color);
    fields.push("color");
  }
  if (hasGender && isCatalogFieldBlank((cur as { gender?: unknown }).gender) && textHints.gender) {
    updates.push(`gender = $${pi++}`);
    vals.push(textHints.gender);
    fields.push("gender");
  }
  if (hasStyle && isCatalogFieldBlank((cur as { style?: unknown }).style) && textHints.style) {
    updates.push(`style = $${pi++}`);
    vals.push(textHints.style);
    fields.push("style");
  }
  if (hasOccasion && isCatalogFieldBlank((cur as { occasion?: unknown }).occasion) && textHints.occasion) {
    updates.push(`occasion = $${pi++}`);
    vals.push(textHints.occasion);
    fields.push("occasion");
  }
  if (hasMaterial && isCatalogFieldBlank((cur as { material?: unknown }).material) && textHints.material) {
    updates.push(`material = $${pi++}`);
    vals.push(textHints.material);
    fields.push("material");
  }

  const needsBlipFallback =
    isCatalogFieldBlank(cur.description) ||
    isCatalogFieldBlank(cur.color) ||
    (hasGender && isCatalogFieldBlank((cur as { gender?: unknown }).gender)) ||
    (hasStyle && isCatalogFieldBlank((cur as { style?: unknown }).style)) ||
    (hasOccasion && isCatalogFieldBlank((cur as { occasion?: unknown }).occasion)) ||
    (hasMaterial && isCatalogFieldBlank((cur as { material?: unknown }).material));

  if (!needsBlipFallback) {
    if (updates.length === 0) return { updated: false, fields: [] };
    if (options?.dryRun) return { updated: true, fields };
    vals.push(productId);
    await pg.query(`UPDATE products SET ${updates.join(", ")} WHERE id = $${pi}`, vals);
    return { updated: true, fields };
  }

  const structured = buildStructuredBlipOutput(c);
  const hasCaptionSignals = c.length >= 8;

  if (hasCaptionSignals && isCatalogFieldBlank(cur.description) && !textHints.description) {
    const desc = productDescriptionFromCaption(c);
    if (desc) {
      updates.push(`description = $${pi++}`);
      vals.push(desc);
      fields.push("description");
    }
  }
  if (hasCaptionSignals && isCatalogFieldBlank(cur.color) && !textHints.color) {
    const pc = primaryColorHintFromCaption(c, { title, category });
    if (pc) {
      updates.push(`color = $${pi++}`);
      vals.push(pc);
      fields.push("color");
    }
  }
  if (hasGender && isCatalogFieldBlank((cur as { gender?: unknown }).gender) && !textHints.gender) {
    const genderFromBlip = hasCaptionSignals ? catalogGenderFromCaption(c, title) : null;
    const gender = genderFromBlip;

    if (gender) {
      updates.push(`gender = $${pi++}`);
      vals.push(gender);
      fields.push("gender");
    }
  }
  if (hasCaptionSignals && hasStyle && isCatalogFieldBlank((cur as { style?: unknown }).style) && !textHints.style && structured.style.attrStyle) {
    updates.push(`style = $${pi++}`);
    vals.push(structured.style.attrStyle);
    fields.push("style");
  }
  if (hasCaptionSignals && hasOccasion && isCatalogFieldBlank((cur as { occasion?: unknown }).occasion) && !textHints.occasion && structured.style.occasion) {
    updates.push(`occasion = $${pi++}`);
    vals.push(structured.style.occasion);
    fields.push("occasion");
  }
  if (hasCaptionSignals && hasMaterial && isCatalogFieldBlank((cur as { material?: unknown }).material) && !textHints.material) {
    const normalizedCaption = structured.normalizedCaption;
    let material: string | null = null;
    if (/\b(denim|jean)\b/.test(normalizedCaption)) material = "denim";
    else if (/\b(cotton)\b/.test(normalizedCaption)) material = "cotton";
    else if (/\b(linen)\b/.test(normalizedCaption)) material = "linen";
    else if (/\b(leather|suede)\b/.test(normalizedCaption)) material = "leather";
    else if (/\b(wool|knit|knitted)\b/.test(normalizedCaption)) material = "wool";
    else if (/\b(silk|satin)\b/.test(normalizedCaption)) material = "silk";
    if (material) {
      updates.push(`material = $${pi++}`);
      vals.push(material);
      fields.push("material");
    }
  }

  if (updates.length === 0) return { updated: false, fields: [] };
  if (options?.dryRun) {
    return { updated: true, fields };
  }
  vals.push(productId);
  await pg.query(`UPDATE products SET ${updates.join(", ")} WHERE id = $${pi}`, vals);
  return { updated: true, fields };
}
