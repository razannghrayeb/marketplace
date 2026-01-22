"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOrCreateVendorId = getOrCreateVendorId;
exports.upsertProduct = upsertProduct;
const db_1 = require("../core/db");
/**
 * Get vendor_id by url (or name fallback). Creates vendor if missing.
 */
async function getOrCreateVendorId(name, url) {
    const existing = await db_1.pg.query(`SELECT id FROM vendors WHERE url = $1 OR name = $2 LIMIT 1`, [url, name]);
    if (existing.rowCount && existing.rows[0]?.id)
        return Number(existing.rows[0].id);
    const created = await db_1.pg.query(`INSERT INTO vendors (name, url, ship_to_lebanon)
     VALUES ($1, $2, TRUE)
     RETURNING id`, [name, url]);
    return Number(created.rows[0].id);
}
/**
 * Upsert product by (vendor_id, product_url).
 * Also records price history.
 */
async function upsertProduct(p) {
    const vendorId = await getOrCreateVendorId(p.vendor_name, p.vendor_url ?? "https://eshopgs.com");
    const res = await db_1.pg.query(`
    INSERT INTO products (
      vendor_id, product_url,
      title, brand, category, description, size, color,
      currency, price_cents, sales_price_cents,
      availability, last_seen,
      image_url
    )
    VALUES (
      $1, $2,
      $3, $4, $5, $6, $7, $8,
      $9, $10, $11,
      TRUE, NOW(),
      $12
    )
    ON CONFLICT (vendor_id, product_url)
    DO UPDATE SET
      title = EXCLUDED.title,
      brand = EXCLUDED.brand,
      category = EXCLUDED.category,
      description = EXCLUDED.description,
      size = EXCLUDED.size,
      color = EXCLUDED.color,
      currency = EXCLUDED.currency,
      price_cents = EXCLUDED.price_cents,
      sales_price_cents = EXCLUDED.sales_price_cents,
      image_url = EXCLUDED.image_url,
      last_seen = NOW(),
      availability = TRUE
    RETURNING id
    `, [
        vendorId,
        p.product_url,
        p.title,
        p.brand ?? null,
        p.category ?? null,
        p.description ?? null,
        p.size ?? null,
        p.color ?? null,
        p.currency,
        p.price_cents,
        p.sales_price_cents ?? null,
        p.image_url ?? null,
    ]);
    const productId = Number(res.rows[0].id);
    // Price history (optional but good)
    await db_1.pg.query(`
    INSERT INTO price_history (product_id, price_cents, sales_price_cents, currency)
    VALUES ($1, $2, $3, $4)
    `, [productId, p.price_cents, p.sales_price_cents ?? null, p.currency]);
    return productId;
}
