-- Migration 017: Add product_types column (if absent) and backfill from category/title.
-- Products with empty product_types get productTypeCompliance=0 in the reranker, causing
-- them to fail the detAnchoredTypeFloor gate and drop out of tops/bottoms/dress results
-- even when they are perfectly valid items. This migration adds the column, then infers
-- product_types from the existing category and title fields.
--
-- Run once; safe to re-run (ADD COLUMN IF NOT EXISTS; updates only empty-array rows).

BEGIN;

-- ── ADD COLUMN ────────────────────────────────────────────────────────────────
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS product_types TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS category_canonical TEXT;

-- ── POPULATE category_canonical FROM raw category (where still NULL) ──────────
-- Mirrors the CATEGORY_ALIASES in src/lib/search/categoryFilter.ts.
-- Only fills rows that are NULL so manual / ingestion-set values are preserved.
UPDATE products
SET category_canonical = CASE
  WHEN LOWER(TRIM(category)) IN (
    'tops','top','shirts','shirt','blouse','blouses','tshirt','t-shirt','tee','tees',
    'tank top','tank tops','polo','polos','henley','tunic','crop top','camisole',
    'sweater','sweaters','pullover','hoodie','hoodies','sweatshirt','sweatshirts',
    'cardigan','cardigans','knitwear','overshirt','overshirts','bodysuit','bodysuits',
    'jersey'
  ) THEN 'tops'
  WHEN LOWER(TRIM(category)) IN (
    'bottoms','bottom','pants','pant','trousers','jeans','jean','chinos','chino',
    'leggings','shorts','short','skirt','skirts','culottes','sweatpants','joggers',
    'cargo pants','denim'
  ) THEN 'bottoms'
  WHEN LOWER(TRIM(category)) IN (
    'dresses','dress','gown','frock','maxi dress','midi dress','mini dress','sundress',
    'jumpsuits','jumpsuit','romper','rompers','one-pieces','abayas','abaya',
    'kaftans','kaftan','jalabiya'
  ) THEN 'dresses'
  WHEN LOWER(TRIM(category)) IN (
    'footwear','shoes','shoe','sneakers','sneaker','boots','boot','sandals','sandal',
    'heels','heel','loafers','loafer','flats','flat','mules','slides','slippers',
    'pumps','oxfords','trainers','trainer'
  ) THEN 'footwear'
  WHEN LOWER(TRIM(category)) IN (
    'outerwear','jackets','jacket','coats','coat','blazers','blazer','parkas','parka',
    'trench','windbreaker','vest','vests','gilet','poncho','cape','bomber'
  ) THEN 'outerwear'
  WHEN LOWER(TRIM(category)) IN (
    'bags','bag','handbag','handbags','wallet','wallets','purse','purses','tote','totes',
    'backpack','backpacks','crossbody','satchel','clutch','clutches'
  ) THEN 'bags'
  WHEN LOWER(TRIM(category)) IN (
    'accessories','accessory','belt','belts','hat','hats','cap','caps','watch','watches',
    'scarf','scarves','sunglasses','jewelry','bracelet','necklace','earrings'
  ) THEN 'accessories'
  WHEN LOWER(TRIM(category)) IN (
    'activewear','sportswear','athletic','gym','workout','running','yoga','training'
  ) THEN 'activewear'
  WHEN LOWER(TRIM(category)) IN (
    'swimwear','swim','bikini','swimsuit','swim trunks','one piece','two piece'
  ) THEN 'swimwear'
  WHEN LOWER(TRIM(category)) IN (
    'underwear','lingerie','undergarments','boxers','briefs','bra','panties','thong'
  ) THEN 'underwear'
  ELSE NULL
END
WHERE category_canonical IS NULL
  AND category IS NOT NULL
  AND TRIM(category) <> '';

-- ── TOPS ─────────────────────────────────────────────────────────────────────
UPDATE products
SET product_types = ARRAY['shirt', 'top']
WHERE (product_types IS NULL OR cardinality(product_types) = 0)
  AND (
    LOWER(TRIM(category)) IN ('tops', 'top', 'shirts', 'shirt')
    OR LOWER(TRIM(category_canonical)) = 'tops'
  )
  AND LOWER(title) ~ '\b(shirt|shirts)\b'
  AND LOWER(title) !~ '\b(dress|pant|trouser|shorts?|skirt|jean|denim|shoe|sneaker|boot)\b';

UPDATE products
SET product_types = ARRAY['sweater', 'top', 'knitwear']
WHERE (product_types IS NULL OR cardinality(product_types) = 0)
  AND (
    LOWER(TRIM(category)) IN ('tops', 'sweaters', 'knitwear')
    OR LOWER(TRIM(category_canonical)) = 'tops'
  )
  AND LOWER(title) ~ '\b(sweater|pullover|knitwear|knit)\b'
  AND LOWER(title) !~ '\b(dress|pant|trouser|shorts?|skirt|jean|shoe|sneaker|boot)\b';

UPDATE products
SET product_types = ARRAY['hoodie', 'sweatshirt', 'top']
WHERE (product_types IS NULL OR cardinality(product_types) = 0)
  AND (
    LOWER(TRIM(category)) IN ('tops', 'hoodies', 'sweatshirts')
    OR LOWER(TRIM(category_canonical)) = 'tops'
  )
  AND LOWER(title) ~ '\b(hoodie|hoody|sweatshirt)\b'
  AND LOWER(title) !~ '\b(dress|pant|trouser|shorts?|skirt|jean|shoe|sneaker|boot)\b';

UPDATE products
SET product_types = ARRAY['t-shirt', 'tee', 'top']
WHERE (product_types IS NULL OR cardinality(product_types) = 0)
  AND (
    LOWER(TRIM(category)) IN ('tops', 't-shirts', 'tees')
    OR LOWER(TRIM(category_canonical)) = 'tops'
  )
  AND LOWER(title) ~ '\b(t-?shirt|tee|tshirt)\b'
  AND LOWER(title) !~ '\b(dress|pant|trouser|shorts?|skirt|jean|shoe|sneaker|boot)\b';

UPDATE products
SET product_types = ARRAY['blouse', 'top']
WHERE (product_types IS NULL OR cardinality(product_types) = 0)
  AND (
    LOWER(TRIM(category)) IN ('tops', 'blouses')
    OR LOWER(TRIM(category_canonical)) = 'tops'
  )
  AND LOWER(title) ~ '\b(blouse|blouses)\b'
  AND LOWER(title) !~ '\b(dress|pant|trouser|shorts?|skirt|jean|shoe|sneaker|boot)\b';

UPDATE products
SET product_types = ARRAY['polo', 'top']
WHERE (product_types IS NULL OR cardinality(product_types) = 0)
  AND (
    LOWER(TRIM(category)) IN ('tops', 'polo', 'polos')
    OR LOWER(TRIM(category_canonical)) = 'tops'
  )
  AND LOWER(title) ~ '\b(polo)\b'
  AND LOWER(title) !~ '\b(dress|pant|trouser|shorts?|skirt|jean|shoe|sneaker|boot)\b';

-- Catch-all for remaining tops with empty product_types
UPDATE products
SET product_types = ARRAY['top']
WHERE (product_types IS NULL OR cardinality(product_types) = 0)
  AND LOWER(TRIM(category_canonical)) = 'tops';

-- ── BOTTOMS ──────────────────────────────────────────────────────────────────
UPDATE products
SET product_types = ARRAY['jeans', 'denim', 'pants']
WHERE (product_types IS NULL OR cardinality(product_types) = 0)
  AND (
    LOWER(TRIM(category)) IN ('bottoms', 'jeans', 'denim')
    OR LOWER(TRIM(category_canonical)) = 'bottoms'
  )
  AND LOWER(title) ~ '\b(jeans?|denim)\b'
  AND LOWER(title) !~ '\b(dress|shirt|blouse|sweater|shoe|sneaker|boot|jacket|coat)\b';

UPDATE products
SET product_types = ARRAY['trousers', 'pants']
WHERE (product_types IS NULL OR cardinality(product_types) = 0)
  AND (
    LOWER(TRIM(category)) IN ('bottoms', 'pants', 'trousers')
    OR LOWER(TRIM(category_canonical)) = 'bottoms'
  )
  AND LOWER(title) ~ '\b(trouser|trousers|chino|chinos|slack|slacks)\b'
  AND LOWER(title) !~ '\b(dress|shirt|blouse|shoe|sneaker|boot|jacket|coat)\b';

UPDATE products
SET product_types = ARRAY['skirt']
WHERE (product_types IS NULL OR cardinality(product_types) = 0)
  AND (
    LOWER(TRIM(category)) IN ('bottoms', 'skirts')
    OR LOWER(TRIM(category_canonical)) = 'bottoms'
  )
  AND LOWER(title) ~ '\b(skirt|skirts)\b'
  AND LOWER(title) !~ '\b(dress|shirt|blouse|shoe|sneaker|boot|jacket|coat)\b';

UPDATE products
SET product_types = ARRAY['shorts']
WHERE (product_types IS NULL OR cardinality(product_types) = 0)
  AND (
    LOWER(TRIM(category)) IN ('bottoms', 'shorts')
    OR LOWER(TRIM(category_canonical)) = 'bottoms'
  )
  AND LOWER(title) ~ '\b(shorts?|bermuda)\b'
  AND LOWER(title) !~ '\b(dress|shirt|blouse|shoe|sneaker|boot|jacket|coat)\b';

UPDATE products
SET product_types = ARRAY['leggings']
WHERE (product_types IS NULL OR cardinality(product_types) = 0)
  AND (
    LOWER(TRIM(category)) IN ('bottoms', 'leggings', 'activewear')
    OR LOWER(TRIM(category_canonical)) = 'bottoms'
  )
  AND LOWER(title) ~ '\b(leggings?|tights?)\b'
  AND LOWER(title) !~ '\b(dress|shirt|blouse|shoe|sneaker|boot|jacket|coat)\b';

-- Catch-all for remaining bottoms
UPDATE products
SET product_types = ARRAY['pants']
WHERE (product_types IS NULL OR cardinality(product_types) = 0)
  AND LOWER(TRIM(category_canonical)) = 'bottoms';

-- ── DRESSES ──────────────────────────────────────────────────────────────────
UPDATE products
SET product_types = ARRAY['dress', 'maxi dress']
WHERE (product_types IS NULL OR cardinality(product_types) = 0)
  AND (
    LOWER(TRIM(category)) IN ('dresses', 'dress')
    OR LOWER(TRIM(category_canonical)) = 'dresses'
  )
  AND LOWER(title) ~ '\b(maxi\s*dress|floor.?length\s*dress)\b';

UPDATE products
SET product_types = ARRAY['dress', 'midi dress']
WHERE (product_types IS NULL OR cardinality(product_types) = 0)
  AND (
    LOWER(TRIM(category)) IN ('dresses', 'dress')
    OR LOWER(TRIM(category_canonical)) = 'dresses'
  )
  AND LOWER(title) ~ '\b(midi\s*dress)\b';

UPDATE products
SET product_types = ARRAY['dress', 'mini dress']
WHERE (product_types IS NULL OR cardinality(product_types) = 0)
  AND (
    LOWER(TRIM(category)) IN ('dresses', 'dress')
    OR LOWER(TRIM(category_canonical)) = 'dresses'
  )
  AND LOWER(title) ~ '\b(mini\s*dress)\b';

UPDATE products
SET product_types = ARRAY['jumpsuit']
WHERE (product_types IS NULL OR cardinality(product_types) = 0)
  AND (
    LOWER(TRIM(category)) IN ('dresses', 'jumpsuits', 'one-pieces')
    OR LOWER(TRIM(category_canonical)) = 'dresses'
  )
  AND LOWER(title) ~ '\b(jumpsuit|romper|playsuit)\b';

UPDATE products
SET product_types = ARRAY['abaya']
WHERE (product_types IS NULL OR cardinality(product_types) = 0)
  AND (
    LOWER(TRIM(category)) IN ('dresses', 'abayas')
    OR LOWER(TRIM(category_canonical)) = 'dresses'
  )
  AND LOWER(title) ~ '\b(abaya|abayas|kaftan|kaftans|jalabiya)\b';

-- Catch-all for remaining dresses
UPDATE products
SET product_types = ARRAY['dress']
WHERE (product_types IS NULL OR cardinality(product_types) = 0)
  AND LOWER(TRIM(category_canonical)) = 'dresses';

-- ── FOOTWEAR ─────────────────────────────────────────────────────────────────
UPDATE products
SET product_types = ARRAY['sneakers', 'trainers']
WHERE (product_types IS NULL OR cardinality(product_types) = 0)
  AND LOWER(TRIM(category_canonical)) = 'footwear'
  AND LOWER(title) ~ '\b(sneaker|sneakers|trainer|trainers|runner|runners)\b';

UPDATE products
SET product_types = ARRAY['boots', 'ankle boots']
WHERE (product_types IS NULL OR cardinality(product_types) = 0)
  AND LOWER(TRIM(category_canonical)) = 'footwear'
  AND LOWER(title) ~ '\b(boot|boots|ankle\s*boot|combat\s*boot)\b';

UPDATE products
SET product_types = ARRAY['sandals']
WHERE (product_types IS NULL OR cardinality(product_types) = 0)
  AND LOWER(TRIM(category_canonical)) = 'footwear'
  AND LOWER(title) ~ '\b(sandal|sandals|slide|slides|flip\s*flop)\b';

UPDATE products
SET product_types = ARRAY['heels', 'pumps']
WHERE (product_types IS NULL OR cardinality(product_types) = 0)
  AND LOWER(TRIM(category_canonical)) = 'footwear'
  AND LOWER(title) ~ '\b(heel|heels|pump|pumps|stiletto|kitten\s*heel)\b';

UPDATE products
SET product_types = ARRAY['loafers']
WHERE (product_types IS NULL OR cardinality(product_types) = 0)
  AND LOWER(TRIM(category_canonical)) = 'footwear'
  AND LOWER(title) ~ '\b(loafer|loafers|moccasin)\b';

UPDATE products
SET product_types = ARRAY['shoes']
WHERE (product_types IS NULL OR cardinality(product_types) = 0)
  AND LOWER(TRIM(category_canonical)) = 'footwear';

COMMIT;
