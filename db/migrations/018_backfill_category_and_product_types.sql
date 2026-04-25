-- Migration 018: comprehensive backfill for category_canonical, product_types, and missing category.
-- Safe to re-run: updates are limited to NULL/empty targets.

BEGIN;

-- Ensure expected columns exist.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS product_types TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS category_canonical TEXT;

-- 1) Backfill category_canonical from existing category (NULL/blank only).
UPDATE products
SET category_canonical = CASE
  WHEN LOWER(TRIM(category)) IN (
    'tops','top','shirts','shirt','blouse','blouses','tshirt','t-shirt','tee','tees',
    'tank top','tank tops','tank-top','tank-tops','polo','polos','henley','tunic','crop top','camisole',
    'sweater','sweaters','pullover','hoodie','hoodies','sweatshirt','sweatshirts',
    'cardigan','cardigans','knitwear','overshirt','overshirts','bodysuit','bodysuits','jersey',
    't-shirts'
  ) THEN 'tops'
  WHEN LOWER(TRIM(category)) IN (
    'bottoms','bottom','pants','pant','trousers','jeans','jean','chinos','chino',
    'leggings','shorts','short','skirt','skirts','culottes','sweatpants','joggers',
    'cargo pants','denim'
  ) THEN 'bottoms'
  WHEN LOWER(TRIM(category)) IN (
    'dresses','dress','gown','frock','maxi dress','midi dress','mini dress','sundress',
    'maxi-dresses','midi-dresses','mini-dresses',
    'jumpsuits','jumpsuit','romper','rompers','one-pieces','abayas','abaya',
    'kaftans','kaftan','jalabiya'
  ) THEN 'dresses'
  WHEN LOWER(TRIM(category)) IN (
    'footwear','shoes','shoe','sneakers','sneaker','boots','boot','sandals','sandal',
    'heels','heel','loafers','loafer','flats','flat','mules','slides','slippers',
    'pumps','oxfords','trainers','trainer','boat shoes'
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
    'scarf','scarves','sunglasses','jewelry','bracelet','necklace','earrings','jewelrt'
  ) THEN 'accessories'
  WHEN LOWER(TRIM(category)) IN (
    'activewear','sportswear','athletic','gym','workout','running','yoga','training','loungewear'
  ) THEN 'activewear'
  WHEN LOWER(TRIM(category)) IN (
    'swimwear','swim','bikini','swimsuit','swim trunks','one piece','two piece'
  ) THEN 'swimwear'
  WHEN LOWER(TRIM(category)) IN (
    'underwear','lingerie','undergarments','boxers','briefs','bra','panties','thong'
  ) THEN 'underwear'
  ELSE NULL
END
WHERE (category_canonical IS NULL OR TRIM(category_canonical) = '')
  AND category IS NOT NULL
  AND TRIM(category) <> '';

-- 2) Heuristic fallback from title when category_canonical still missing.
UPDATE products
SET category_canonical = CASE
  WHEN LOWER(title) ~ '\b(handbag|crossbody|satchel|clutch|tote|wallet|backpack|bag)\b' THEN 'bags'
  WHEN LOWER(title) ~ '\b(sneaker|trainer|loafer|boot|heel|pump|sandal|shoe|oxford|boat shoe)\b' THEN 'footwear'
  WHEN LOWER(title) ~ '\b(jacket|coat|blazer|parka|trench|windbreaker|outerwear|bomber)\b' THEN 'outerwear'
  WHEN LOWER(title) ~ '\b(dress|gown|jumpsuit|romper|abaya|kaftan)\b' THEN 'dresses'
  WHEN LOWER(title) ~ '\b(jean|denim|trouser|pants|shorts|skirt|leggings|jogger|chino)\b' THEN 'bottoms'
  WHEN LOWER(title) ~ '\b(shirt|t-?shirt|tee|blouse|sweater|hoodie|cardigan|top|polo)\b' THEN 'tops'
  WHEN LOWER(title) ~ '\b(bikini|swimsuit|swim trunks|swimwear)\b' THEN 'swimwear'
  WHEN LOWER(title) ~ '\b(lingerie|boxer|brief|bra|panty|underwear)\b' THEN 'underwear'
  WHEN LOWER(title) ~ '\b(belt|hat|cap|watch|scarf|sunglasses|necklace|earring|bracelet)\b' THEN 'accessories'
  ELSE category_canonical
END
WHERE (category_canonical IS NULL OR TRIM(category_canonical) = '')
  AND title IS NOT NULL
  AND TRIM(title) <> '';

-- 3) Backfill product_types where empty.
UPDATE products
SET product_types = CASE
  WHEN category_canonical = 'tops' THEN
    CASE
      WHEN LOWER(title) ~ '\b(t-?shirt|tee|tshirt)\b' THEN ARRAY['t-shirt','tee','top']
      WHEN LOWER(title) ~ '\b(shirt|button\s*down|button-down)\b' THEN ARRAY['shirt','top']
      WHEN LOWER(title) ~ '\b(blouse)\b' THEN ARRAY['blouse','top']
      WHEN LOWER(title) ~ '\b(hoodie|sweatshirt)\b' THEN ARRAY['hoodie','sweatshirt','top']
      WHEN LOWER(title) ~ '\b(sweater|pullover|knit)\b' THEN ARRAY['sweater','knitwear','top']
      WHEN LOWER(title) ~ '\b(polo)\b' THEN ARRAY['polo','top']
      ELSE ARRAY['top']
    END
  WHEN category_canonical = 'bottoms' THEN
    CASE
      WHEN LOWER(title) ~ '\b(jean|denim)\b' THEN ARRAY['jeans','denim','pants']
      WHEN LOWER(title) ~ '\b(trouser|chino|slack)\b' THEN ARRAY['trousers','pants']
      WHEN LOWER(title) ~ '\b(skirt)\b' THEN ARRAY['skirt']
      WHEN LOWER(title) ~ '\b(shorts?|bermuda)\b' THEN ARRAY['shorts']
      WHEN LOWER(title) ~ '\b(leggings?|tights?)\b' THEN ARRAY['leggings']
      ELSE ARRAY['pants']
    END
  WHEN category_canonical = 'dresses' THEN
    CASE
      WHEN LOWER(title) ~ '\b(jumpsuit|romper|playsuit)\b' THEN ARRAY['jumpsuit']
      WHEN LOWER(title) ~ '\b(maxi\s*dress)\b' THEN ARRAY['dress','maxi dress']
      WHEN LOWER(title) ~ '\b(midi\s*dress)\b' THEN ARRAY['dress','midi dress']
      WHEN LOWER(title) ~ '\b(mini\s*dress)\b' THEN ARRAY['dress','mini dress']
      WHEN LOWER(title) ~ '\b(abaya|kaftan|jalabiya)\b' THEN ARRAY['abaya']
      ELSE ARRAY['dress']
    END
  WHEN category_canonical = 'footwear' THEN
    CASE
      WHEN LOWER(title) ~ '\b(sneaker|trainer|runner)\b' THEN ARRAY['sneakers','trainers']
      WHEN LOWER(title) ~ '\b(boot|ankle\s*boot|combat\s*boot)\b' THEN ARRAY['boots']
      WHEN LOWER(title) ~ '\b(sandal|slide|flip\s*flop)\b' THEN ARRAY['sandals']
      WHEN LOWER(title) ~ '\b(heel|pump|stiletto|kitten\s*heel)\b' THEN ARRAY['heels','pumps']
      WHEN LOWER(title) ~ '\b(loafer|moccasin|boat shoe)\b' THEN ARRAY['loafers']
      ELSE ARRAY['shoes']
    END
  WHEN category_canonical = 'outerwear' THEN
    CASE
      WHEN LOWER(title) ~ '\b(blazer)\b' THEN ARRAY['blazer','outerwear']
      WHEN LOWER(title) ~ '\b(coat|trench|parka)\b' THEN ARRAY['coat','outerwear']
      WHEN LOWER(title) ~ '\b(jacket|bomber|windbreaker)\b' THEN ARRAY['jacket','outerwear']
      ELSE ARRAY['outerwear']
    END
  WHEN category_canonical = 'bags' THEN
    CASE
      WHEN LOWER(title) ~ '\b(handbag)\b' THEN ARRAY['handbag','bag']
      WHEN LOWER(title) ~ '\b(crossbody)\b' THEN ARRAY['crossbody','bag']
      WHEN LOWER(title) ~ '\b(tote)\b' THEN ARRAY['tote','bag']
      WHEN LOWER(title) ~ '\b(backpack)\b' THEN ARRAY['backpack','bag']
      WHEN LOWER(title) ~ '\b(clutch)\b' THEN ARRAY['clutch','bag']
      WHEN LOWER(title) ~ '\b(wallet)\b' THEN ARRAY['wallet','bag']
      WHEN LOWER(title) ~ '\b(satchel)\b' THEN ARRAY['satchel','bag']
      ELSE ARRAY['bag']
    END
  WHEN category_canonical = 'accessories' THEN
    CASE
      WHEN LOWER(title) ~ '\b(belt)\b' THEN ARRAY['belt','accessory']
      WHEN LOWER(title) ~ '\b(hat|cap)\b' THEN ARRAY['hat','accessory']
      WHEN LOWER(title) ~ '\b(scarf)\b' THEN ARRAY['scarf','accessory']
      WHEN LOWER(title) ~ '\b(watch)\b' THEN ARRAY['watch','accessory']
      WHEN LOWER(title) ~ '\b(sunglasses)\b' THEN ARRAY['sunglasses','accessory']
      WHEN LOWER(title) ~ '\b(necklace|earring|bracelet|ring|jewelry)\b' THEN ARRAY['jewelry','accessory']
      ELSE ARRAY['accessory']
    END
  WHEN category_canonical = 'activewear' THEN ARRAY['activewear']
  WHEN category_canonical = 'swimwear' THEN ARRAY['swimwear']
  WHEN category_canonical = 'underwear' THEN ARRAY['underwear']
  ELSE product_types
END
WHERE product_types IS NULL OR cardinality(product_types) = 0;

-- 4) Fill missing category from canonical bucket (only if category is NULL/blank).
UPDATE products
SET category = CASE
  WHEN category_canonical = 'tops' THEN 'Tops'
  WHEN category_canonical = 'bottoms' THEN 'Bottoms'
  WHEN category_canonical = 'dresses' THEN 'Dresses'
  WHEN category_canonical = 'footwear' THEN 'Footwear'
  WHEN category_canonical = 'outerwear' THEN 'Outerwear'
  WHEN category_canonical = 'bags' THEN 'Bags'
  WHEN category_canonical = 'accessories' THEN 'Accessories'
  WHEN category_canonical = 'activewear' THEN 'Activewear'
  WHEN category_canonical = 'swimwear' THEN 'Swimwear'
  WHEN category_canonical = 'underwear' THEN 'Underwear'
  ELSE category
END
WHERE (category IS NULL OR TRIM(category) = '')
  AND category_canonical IS NOT NULL
  AND TRIM(category_canonical) <> '';

COMMIT;

