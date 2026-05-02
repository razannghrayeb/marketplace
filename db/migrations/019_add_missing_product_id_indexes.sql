-- Migration: Add Missing product_id Indexes for Hydration Performance
-- Date: May 2, 2026
-- Reason: Hydration queries (fetching product details after vector search) were slow
--         because product_id foreign keys weren't indexed for JOIN queries.
--         This migration adds indexes to all product_id references.

-- Cart items: product_id used in JOIN when fetching user's cart products
CREATE INDEX IF NOT EXISTS idx_cart_items_product_id ON cart_items(product_id);

-- Favorites: product_id used in JOIN when fetching user's favorite products
CREATE INDEX IF NOT EXISTS idx_favorites_product_id ON favorites(product_id);

-- User uploaded images: product_id used in JOIN for user's uploaded product variants
CREATE INDEX IF NOT EXISTS idx_user_uploaded_images_product_id ON user_uploaded_images(product_id);

-- User saved items: product_id used in JOIN for unified saved items
CREATE INDEX IF NOT EXISTS idx_user_saved_items_product_id ON user_saved_items(product_id);

-- Note: product_quality_scores and product_price_analysis have UNIQUE constraints on product_id,
-- which automatically creates unique indexes. These are used for lookups and don't need additional indexes.

-- Composite indexes for common query patterns (optional, add if needed):
-- CREATE INDEX IF NOT EXISTS idx_cart_items_user_product ON cart_items(user_id, product_id);
-- CREATE INDEX IF NOT EXISTS idx_favorites_user_product ON favorites(user_id, product_id);
