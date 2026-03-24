-- Additional canonical garment nodes + aliases (regional / modest / headwear).
-- Safe to run after 010_fashion_search_taxonomy.sql

INSERT INTO canonical_product_types (id, slug, display_name, parent_id) VALUES
    ('modest_abaya', 'abaya', 'Abaya & robe', NULL),
    ('modest_south_asian', 'south-asian-wear', 'South Asian wear', NULL),
    ('head_covering', 'head-covering', 'Head coverings', NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO product_type_aliases (canonical_id, alias, source, weight) VALUES
    ('modest_abaya', 'abaya', 'manual', 1),
    ('modest_abaya', 'kaftan', 'manual', 1),
    ('modest_abaya', 'thobe', 'manual', 1),
    ('modest_south_asian', 'sherwani', 'manual', 1),
    ('modest_south_asian', 'kurta', 'manual', 1),
    ('modest_south_asian', 'sari', 'manual', 1),
    ('modest_south_asian', 'saree', 'manual', 1),
    ('modest_south_asian', 'lehenga', 'manual', 1),
    ('modest_south_asian', 'salwar', 'manual', 1),
    ('modest_south_asian', 'kameez', 'manual', 1),
    ('head_covering', 'hijab', 'manual', 1),
    ('head_covering', 'headscarf', 'manual', 1),
    ('head_covering', 'niqab', 'manual', 1)
ON CONFLICT (canonical_id, alias) DO NOTHING;
