/**
 * Apply a BLIP caption to empty `products.description`, `color`, and `gender`.
 * Each column gets only column-specific extracted/normalized text (never the same raw caption string for all).
 */
import { pg, productsTableHasGenderColumn } from "../core/db";
import {
  catalogGenderFromCaption,
  primaryColorHintFromCaption,
  productDescriptionFromCaption,
} from "./captionAttributeInference";

export function isCatalogFieldBlank(value: unknown): boolean {
  if (value == null) return true;
  return String(value).trim().length === 0;
}

export interface ApplyBlipCaptionResult {
  updated: boolean;
  fields: string[];
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
  if (c.length < 8) return { updated: false, fields: [] };

  const hasGender = await productsTableHasGenderColumn();
  const selectSql = hasGender
    ? `SELECT description, color, gender, title FROM products WHERE id = $1`
    : `SELECT description, color, title FROM products WHERE id = $1`;
  const row = await pg.query(selectSql, [productId]);
  if (row.rowCount === 0) return { updated: false, fields: [] };
  const cur = row.rows[0] as Record<string, unknown>;

  const updates: string[] = [];
  const vals: unknown[] = [];
  const fields: string[] = [];
  let pi = 1;

  if (isCatalogFieldBlank(cur.description)) {
    const desc = productDescriptionFromCaption(c);
    if (desc) {
      updates.push(`description = $${pi++}`);
      vals.push(desc);
      fields.push("description");
    }
  }
  if (isCatalogFieldBlank(cur.color)) {
    const pc = primaryColorHintFromCaption(c);
    if (pc) {
      updates.push(`color = $${pi++}`);
      vals.push(pc);
      fields.push("color");
    }
  }
  if (hasGender && isCatalogFieldBlank((cur as { gender?: unknown }).gender)) {
    const gender = catalogGenderFromCaption(c, (cur as { title?: unknown }).title as string | null | undefined);
    if (gender) {
      updates.push(`gender = $${pi++}`);
      vals.push(gender);
      fields.push("gender");
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
