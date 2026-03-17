CREATE OR REPLACE FUNCTION get_overview_kpis()
RETURNS json
LANGUAGE sql STABLE
AS $$
  SELECT json_build_object(
    'total_vendors',        (SELECT COUNT(*) FROM vendors),
    'total_products',       (SELECT COUNT(*) FROM products),
    'available_products',   (SELECT COUNT(*) FROM products WHERE availability = true),
    'unavailable_products', (SELECT COUNT(*) FROM products WHERE availability = false),
    'products_seen_today',  (SELECT COUNT(*) FROM products WHERE last_seen >= NOW() - INTERVAL '24 hours'),
    'missing_category',     (SELECT COUNT(*) FROM products WHERE category IS NULL OR category = ''),
    'missing_color',        (SELECT COUNT(*) FROM products WHERE color IS NULL OR color = ''),
    'missing_size',         (SELECT COUNT(*) FROM products WHERE size IS NULL OR size = ''),
    'missing_image_url',    (SELECT COUNT(*) FROM products WHERE image_url IS NULL),
    'missing_image_urls',   (
      SELECT COUNT(*)
      FROM products
      WHERE image_urls IS NULL
         OR image_urls = '[]'::jsonb
         OR image_urls = '{}'::jsonb
    ),
    'missing_variant_id',   (SELECT COUNT(*) FROM products WHERE variant_id IS NULL OR variant_id = ''),
    'missing_parent_url',   (SELECT COUNT(*) FROM products WHERE parent_product_url IS NULL OR parent_product_url = ''),
    'with_sale_price',      (SELECT COUNT(*) FROM products WHERE sales_price_cents IS NOT NULL AND sales_price_cents > 0),
    'updated_last_24h',     (SELECT COUNT(*) FROM products WHERE last_seen >= NOW() - INTERVAL '24 hours')
  );
$$;

CREATE OR REPLACE FUNCTION get_vendor_stats()
RETURNS TABLE (
  id bigint,
  name text,
  url text,
  ship_to_lebanon boolean,
  total_products bigint,
  available_products bigint,
  unavailable_products bigint,
  missing_category bigint,
  missing_image_url bigint,
  missing_image_urls bigint,
  missing_variant_id bigint,
  missing_parent_url bigint,
  missing_color bigint,
  missing_size bigint,
  latest_last_seen timestamptz,
  health_score integer
)
LANGUAGE sql STABLE
AS $$
  SELECT
    v.id,
    v.name,
    v.url,
    v.ship_to_lebanon,
    COUNT(p.id) AS total_products,
    COUNT(p.id) FILTER (WHERE p.availability = true) AS available_products,
    COUNT(p.id) FILTER (WHERE p.availability = false) AS unavailable_products,
    COUNT(p.id) FILTER (WHERE p.category IS NULL OR p.category = '') AS missing_category,
    COUNT(p.id) FILTER (WHERE p.image_url IS NULL) AS missing_image_url,
    COUNT(p.id) FILTER (
      WHERE p.image_urls IS NULL
         OR p.image_urls = '[]'::jsonb
         OR p.image_urls = '{}'::jsonb
    ) AS missing_image_urls,
    COUNT(p.id) FILTER (WHERE p.variant_id IS NULL OR p.variant_id = '') AS missing_variant_id,
    COUNT(p.id) FILTER (WHERE p.parent_product_url IS NULL OR p.parent_product_url = '') AS missing_parent_url,
    COUNT(p.id) FILTER (WHERE p.color IS NULL OR p.color = '') AS missing_color,
    COUNT(p.id) FILTER (WHERE p.size IS NULL OR p.size = '') AS missing_size,
    MAX(p.last_seen) AS latest_last_seen,
    CASE
      WHEN COUNT(p.id) = 0 THEN 0
      ELSE ROUND(
        100.0 * COUNT(p.id) FILTER (
          WHERE p.image_url IS NOT NULL
            AND p.category IS NOT NULL
            AND p.category <> ''
            AND p.last_seen >= NOW() - INTERVAL '7 days'
        ) / COUNT(p.id)
      )::integer
    END AS health_score
  FROM vendors v
  LEFT JOIN products p ON p.vendor_id = v.id
  GROUP BY v.id, v.name, v.url, v.ship_to_lebanon
  ORDER BY total_products DESC;
$$;

CREATE OR REPLACE FUNCTION get_category_counts()
RETURNS TABLE (category text, count bigint)
LANGUAGE sql STABLE
AS $$
  SELECT
    COALESCE(category, '(uncategorized)') AS category,
    COUNT(*) AS count
  FROM products
  GROUP BY category
  ORDER BY count DESC
  LIMIT 20;
$$;

CREATE OR REPLACE FUNCTION get_vendor_product_counts()
RETURNS TABLE (vendor_name text, total bigint, available bigint, unavailable bigint)
LANGUAGE sql STABLE
AS $$
  SELECT
    v.name AS vendor_name,
    COUNT(p.id) AS total,
    COUNT(p.id) FILTER (WHERE p.availability = true) AS available,
    COUNT(p.id) FILTER (WHERE p.availability = false) AS unavailable
  FROM vendors v
  LEFT JOIN products p ON p.vendor_id = v.id
  GROUP BY v.id, v.name
  ORDER BY total DESC;
$$;

CREATE OR REPLACE FUNCTION get_freshness_stats()
RETURNS json
LANGUAGE sql STABLE
AS $$
  SELECT json_build_object(
    'fresh_count',  (SELECT COUNT(*) FROM products WHERE last_seen >= NOW() - INTERVAL '1 day'),
    'recent_count', (SELECT COUNT(*) FROM products WHERE last_seen >= NOW() - INTERVAL '7 days' AND last_seen < NOW() - INTERVAL '1 day'),
    'aging_count',  (SELECT COUNT(*) FROM products WHERE last_seen >= NOW() - INTERVAL '14 days' AND last_seen < NOW() - INTERVAL '7 days'),
    'stale_count',  (SELECT COUNT(*) FROM products WHERE last_seen < NOW() - INTERVAL '14 days' OR last_seen IS NULL)
  );
$$;

CREATE OR REPLACE FUNCTION get_daily_scrape_volume(days_back integer DEFAULT 30)
RETURNS TABLE (date text, count bigint)
LANGUAGE sql STABLE
AS $$
  SELECT
    TO_CHAR(last_seen::date, 'YYYY-MM-DD') AS date,
    COUNT(*) AS count
  FROM products
  WHERE last_seen >= NOW() - (days_back || ' days')::interval
  GROUP BY last_seen::date
  ORDER BY last_seen::date;
$$;

CREATE OR REPLACE FUNCTION get_price_change_events(limit_rows integer DEFAULT 50)
RETURNS TABLE (
  product_id bigint,
  product_title text,
  vendor_name text,
  image_url text,
  old_price integer,
  new_price integer,
  change_pct numeric,
  recorded_at timestamptz,
  is_discount boolean
)
LANGUAGE sql STABLE
AS $$
  WITH ranked AS (
    SELECT
      ph.product_id,
      ph.price_cents AS new_price,
      ph.recorded_at,
      LAG(ph.price_cents) OVER (PARTITION BY ph.product_id ORDER BY ph.recorded_at) AS old_price
    FROM price_history ph
  )
  SELECT
    r.product_id,
    p.title AS product_title,
    v.name AS vendor_name,
    p.image_url,
    r.old_price,
    r.new_price,
    ROUND(((r.new_price - r.old_price)::numeric / NULLIF(r.old_price, 0)) * 100, 1) AS change_pct,
    r.recorded_at,
    r.new_price < r.old_price AS is_discount
  FROM ranked r
  JOIN products p ON p.id = r.product_id
  JOIN vendors v ON v.id = p.vendor_id
  WHERE r.old_price IS NOT NULL AND r.old_price <> r.new_price
  ORDER BY r.recorded_at DESC
  LIMIT limit_rows;
$$;

CREATE INDEX IF NOT EXISTS idx_products_vendor_id ON products(vendor_id);
CREATE INDEX IF NOT EXISTS idx_products_last_seen ON products(last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_availability ON products(availability);
CREATE INDEX IF NOT EXISTS idx_products_parent_url ON products(parent_product_url);
CREATE INDEX IF NOT EXISTS idx_products_product_url ON products(product_url);
CREATE INDEX IF NOT EXISTS idx_price_history_product ON price_history(product_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_products_fts ON products USING gin(to_tsvector('english', coalesce(title, '') || ' ' || coalesce(brand, '')));
