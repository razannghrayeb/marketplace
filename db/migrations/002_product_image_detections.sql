-- Migration: Product Image Detections
-- Purpose: Persist YOLO detection results per uploaded product image


-- Note: We avoid adding strict foreign key constraints here so the migration
-- can run on fresh databases where `product_images` / `products` may not yet exist.
CREATE TABLE IF NOT EXISTS product_image_detections (
    id SERIAL PRIMARY KEY,
    -- Integer references kept as plain integers to avoid migration ordering issues
    product_image_id INTEGER,
    product_id INTEGER,
    label TEXT NOT NULL,
    raw_label TEXT,
    confidence DECIMAL(5,4),
    box JSONB,
    box_x1 INTEGER,
    box_y1 INTEGER,
    box_x2 INTEGER,
    box_y2 INTEGER,
    area_ratio DECIMAL(6,4),
    style JSONB,
    cropped_r2_key TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pid_product_image ON product_image_detections(product_image_id);
CREATE INDEX IF NOT EXISTS idx_pid_product ON product_image_detections(product_id);
CREATE INDEX IF NOT EXISTS idx_pid_label ON product_image_detections(label);
