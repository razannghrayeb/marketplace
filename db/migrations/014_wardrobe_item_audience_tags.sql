-- Optional audience + tag metadata on wardrobe items (user-provided at upload / edit).

ALTER TABLE wardrobe_items ADD COLUMN IF NOT EXISTS audience_gender TEXT;
ALTER TABLE wardrobe_items ADD COLUMN IF NOT EXISTS age_group TEXT;
ALTER TABLE wardrobe_items ADD COLUMN IF NOT EXISTS style_tags TEXT[] DEFAULT '{}';
ALTER TABLE wardrobe_items ADD COLUMN IF NOT EXISTS occasion_tags TEXT[] DEFAULT '{}';
ALTER TABLE wardrobe_items ADD COLUMN IF NOT EXISTS season_tags TEXT[] DEFAULT '{}';

COMMENT ON COLUMN wardrobe_items.audience_gender IS 'men | women | unisex';
COMMENT ON COLUMN wardrobe_items.age_group IS 'kids | adult';
COMMENT ON COLUMN wardrobe_items.style_tags IS 'e.g. classic, minimalist';
COMMENT ON COLUMN wardrobe_items.occasion_tags IS 'e.g. work, smart-casual';
COMMENT ON COLUMN wardrobe_items.season_tags IS 'e.g. spring, fall';
