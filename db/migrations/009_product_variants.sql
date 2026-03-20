-- Parent product (products) + SKU rows (product_variants)
-- One listing per style/parent URL; each size/color/Shopify variant is a row in product_variants.

CREATE TABLE IF NOT EXISTS product_variants (
    id BIGSERIAL PRIMARY KEY,
    product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    vendor_id BIGINT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,

    variant_id TEXT,
    product_url TEXT NOT NULL,

    size TEXT,
    color TEXT,

    currency TEXT NOT NULL,
    price_cents BIGINT NOT NULL,
    sales_price_cents BIGINT,

    availability BOOLEAN NOT NULL DEFAULT FALSE,
    last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    image_url TEXT,
    image_urls JSONB,

    -- Traceability after migrating from flat products rows (nullable, safe to drop later)
    legacy_product_id BIGINT,

    is_default BOOLEAN NOT NULL DEFAULT FALSE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_product_variants_url_nonempty CHECK (btrim(product_url) <> '')
);

-- One row per variant URL per vendor (matches former products uniqueness intent)
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_variants_vendor_product_url
    ON product_variants (vendor_id, product_url);

-- One Shopify variant id per parent product when present
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_variants_product_variant_id
    ON product_variants (product_id, variant_id)
    WHERE variant_id IS NOT NULL AND btrim(variant_id) <> '';

CREATE INDEX IF NOT EXISTS idx_product_variants_product_id ON product_variants (product_id);
CREATE INDEX IF NOT EXISTS idx_product_variants_vendor_id ON product_variants (vendor_id);
CREATE INDEX IF NOT EXISTS idx_product_variants_variant_id_lookup ON product_variants (vendor_id, variant_id)
    WHERE variant_id IS NOT NULL AND btrim(variant_id) <> '';

COMMENT ON TABLE product_variants IS 'Sellable SKUs — products row is the parent listing (style-level).';
COMMENT ON COLUMN product_variants.is_default IS 'Primary variant for display when API does not pick a specific SKU.';
COMMENT ON COLUMN product_variants.legacy_product_id IS 'Original products.id before merge; optional audit field.';
