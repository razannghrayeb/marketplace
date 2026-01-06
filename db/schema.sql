CREATE TABLE IF NOT EXISTS vendors (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    ship_to_lebanon BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS products(
    id BIGSERIAL PRIMARY KEY,
    vendor_id BIGINT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    brand TEXT,
    category TEXT,
    description TEXT,
    size TEXT,
    color TEXT,
    currency TEXT NOT NULL,
    price_cents BIGINT NOT NULL,
    sales_price_cents BIGINT,
    availability BOOLEAN NOT NULL DEFAULT TRUE,
    last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_products_vendor_id ON products(vendor_id);
CREATE INDEX idx_products_title ON products USING gin(to_tsvector('english', title));
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);