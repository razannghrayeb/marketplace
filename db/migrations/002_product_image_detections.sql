-- Migration: Product Image Detections
-- Purpose: Persist YOLO detection results per uploaded product image

CREATE TABLE IF NOT EXISTS product_image_detections (
    id SERIAL PRIMARY KEY,
    product_image_id INTEGER REFERENCES product_images(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
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
