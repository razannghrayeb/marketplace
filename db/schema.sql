CREATE TABLE IF NOT EXISTS vendors (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    ship_to_lebanon BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vendors_url
ON vendors(url);
-- Products
CREATE TABLE IF NOT EXISTS products(
    id BIGSERIAL PRIMARY KEY,
    vendor_id BIGINT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
    product_url TEXT NOT NULL,
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
    last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Added for image & compare features
    image_url TEXT,
    image_cdn TEXT,
    primary_image_id INTEGER,
    p_hash TEXT,
    return_policy TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_products_vendor_id
    ON products(vendor_id);

    CREATE INDEX IF NOT EXISTS idx_products_title
    ON products USING gin(to_tsvector('english', title));

    CREATE INDEX IF NOT EXISTS idx_products_category
    ON products(category);

    --needed for scraping upserts
    CREATE UNIQUE INDEX IF NOT EXISTS idx_products_vendor_product_url
    ON products(vendor_id, product_url);


-- Product Images (for R2 storage, CLIP embeddings, pHash)
CREATE TABLE IF NOT EXISTS product_images (
    id SERIAL PRIMARY KEY,
    product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    r2_key TEXT NOT NULL UNIQUE,
    cdn_url TEXT NOT NULL,
    embedding TEXT,
    p_hash TEXT,
    is_primary BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_product_images_product_id ON product_images(product_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_images_r2_key ON product_images(r2_key);

-- Add foreign key for primary_image_id after product_images exists
ALTER TABLE products ADD CONSTRAINT fk_products_primary_image 
    FOREIGN KEY (primary_image_id) REFERENCES product_images(id) ON DELETE SET NULL;

-- Price History (for anomaly detection)
CREATE TABLE IF NOT EXISTS price_history (
    id SERIAL PRIMARY KEY,
    product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    price_cents BIGINT NOT NULL,
    sales_price_cents BIGINT,
    currency TEXT NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(product_id, recorded_at)
);
CREATE INDEX IF NOT EXISTS idx_price_history_product_id ON price_history(product_id);
CREATE INDEX IF NOT EXISTS idx_price_history_recorded_at ON price_history(recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_history_product_date ON price_history(product_id, recorded_at DESC);

-- Category Price Baselines (for compare feature)
CREATE TABLE IF NOT EXISTS category_price_baselines (
    id SERIAL PRIMARY KEY,
    category TEXT NOT NULL UNIQUE,
    median_price_usd DECIMAL(10, 2) NOT NULL,
    q1_price_usd DECIMAL(10, 2) NOT NULL,
    q3_price_usd DECIMAL(10, 2) NOT NULL,
    iqr_usd DECIMAL(10, 2) NOT NULL,
    min_normal_usd DECIMAL(10, 2) NOT NULL,
    max_normal_usd DECIMAL(10, 2) NOT NULL,
    product_count INTEGER NOT NULL,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_category_baselines_category ON category_price_baselines(category);

-- Product Quality Scores (cached compare analysis)
CREATE TABLE IF NOT EXISTS product_quality_scores (
    id SERIAL PRIMARY KEY,
    product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE UNIQUE,
    quality_score INTEGER NOT NULL CHECK (quality_score >= 0 AND quality_score <= 100),
    quality_level TEXT NOT NULL CHECK (quality_level IN ('green', 'yellow', 'red')),
    confidence_score INTEGER NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 100),
    attributes JSONB NOT NULL DEFAULT '{}',
    has_fabric BOOLEAN NOT NULL DEFAULT FALSE,
    has_fit BOOLEAN NOT NULL DEFAULT FALSE,
    has_size_info BOOLEAN NOT NULL DEFAULT FALSE,
    has_care_instructions BOOLEAN NOT NULL DEFAULT FALSE,
    has_return_policy BOOLEAN NOT NULL DEFAULT FALSE,
    has_measurements BOOLEAN NOT NULL DEFAULT FALSE,
    word_count INTEGER NOT NULL DEFAULT 0,
    red_flags JSONB NOT NULL DEFAULT '[]',
    version TEXT NOT NULL DEFAULT '1.0.0',
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Product Price Analysis (cached compare analysis)
CREATE TABLE IF NOT EXISTS product_price_analysis (
    id SERIAL PRIMARY KEY,
    product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE UNIQUE,
    current_price_usd DECIMAL(10, 2) NOT NULL,
    volatility_30d DECIMAL(5, 2),
    volatility_level TEXT CHECK (volatility_level IN ('stable', 'moderate', 'high')),
    market_position TEXT CHECK (market_position IN ('too_low', 'suspicious_low', 'below_market', 'normal', 'above_market', 'too_high')),
    market_ratio DECIMAL(5, 2),
    discount_frequency_90d INTEGER DEFAULT 0,
    avg_discount_depth DECIMAL(5, 2),
    anomalies JSONB NOT NULL DEFAULT '[]',
    price_score INTEGER NOT NULL CHECK (price_score >= 0 AND price_score <= 100),
    price_level TEXT NOT NULL CHECK (price_level IN ('green', 'yellow', 'red')),
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS price_drop_events (
    id SERIAL PRIMARY KEY,
    product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    old_price_cents BIGINT NOT NULL,
    new_price_cents BIGINT NOT NULL,
    drop_percent DECIMAL(5, 2) NOT NULL,
    detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_price_drop_events_product_id ON price_drop_events(product_id);
CREATE INDEX IF NOT EXISTS idx_price_drop_events_detected_at ON price_drop_events(detected_at DESC)