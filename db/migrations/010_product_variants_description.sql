-- Optional per-SKU copy (search cards, PDP default when collapsed to one SKU).
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS description TEXT;
