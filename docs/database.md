# Database Guide

This guide provides detailed information about the database schema, design decisions, performance optimizations, and migration procedures for the Fashion Aggregator API.

## Overview

The Fashion Aggregator API uses PostgreSQL as its primary database with the following extensions:
- **vector**: For storing and querying CLIP embeddings
- **pg_trgm**: For trigram-based text search
- **btree_gin**: For optimized composite indexes

---

## Schema Design

### Core Tables

#### Products Table
The central table containing product information from multiple vendors.

```sql
CREATE TABLE products (
    id BIGSERIAL PRIMARY KEY,
    vendor_id BIGINT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
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
    
    -- Image and comparison features
    image_url TEXT,
    image_cdn TEXT,
    primary_image_id INTEGER,
    p_hash TEXT,
    return_policy TEXT,
    
    -- Constraints
    CONSTRAINT valid_price CHECK (price_cents > 0),
    CONSTRAINT valid_sales_price CHECK (sales_price_cents IS NULL OR sales_price_cents <= price_cents)
);
```

**Design Decisions:**
- `BIGSERIAL` for high-volume product IDs
- Prices stored in cents to avoid floating-point precision issues
- Separate `image_url` and `image_cdn` for gradual R2 migration
- `p_hash` for perceptual hash-based duplicate detection
- Soft foreign key to `primary_image_id` (can be NULL)

#### Vendors Table
Information about product sources and shipping capabilities.

```sql
CREATE TABLE vendors (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    url TEXT NOT NULL,
    ship_to_lebanon BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### Product Images Table
Stores image metadata with CLIP embeddings and perceptual hashes.

```sql
CREATE TABLE product_images (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    r2_key TEXT NOT NULL UNIQUE,
    cdn_url TEXT NOT NULL,
    embedding vector(512),  -- CLIP embedding
    p_hash TEXT,           -- Perceptual hash
    is_primary BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT unique_primary_per_product EXCLUDE (product_id WITH =) WHERE (is_primary = true)
);
```

**Design Decisions:**
- `vector(512)` type for CLIP embeddings enables cosine similarity searches
- `r2_key` uniqueness prevents duplicate uploads
- Exclusion constraint ensures only one primary image per product
- Foreign key cascade ensures cleanup when products are deleted

### Analytics and ML Tables

#### Price History
Tracks price changes over time for volatility analysis.

```sql
CREATE TABLE price_history (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    price_cents BIGINT NOT NULL,
    sales_price_cents BIGINT,
    currency TEXT NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(product_id, recorded_at)
);
```

**Partitioning Strategy:**
```sql
-- Partition by month for better query performance
CREATE TABLE price_history_y2026m01 PARTITION OF price_history
FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');

-- Automatic partition creation function
CREATE OR REPLACE FUNCTION create_monthly_partition()
RETURNS TRIGGER AS $$
DECLARE
    start_date DATE;
    end_date DATE;
    table_name TEXT;
BEGIN
    start_date := date_trunc('month', NEW.recorded_at);
    end_date := start_date + INTERVAL '1 month';
    table_name := format('price_history_y%sm%s', 
                        extract(year from start_date),
                        lpad(extract(month from start_date)::text, 2, '0'));
    
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF price_history 
                   FOR VALUES FROM (%L) TO (%L)',
                   table_name, start_date, end_date);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

#### Category Price Baselines
Statistical baselines for price anomaly detection.

```sql
CREATE TABLE category_price_baselines (
    id SERIAL PRIMARY KEY,
    category TEXT NOT NULL UNIQUE,
    median_price_usd DECIMAL(10, 2) NOT NULL,
    q1_price_usd DECIMAL(10, 2) NOT NULL,
    q3_price_usd DECIMAL(10, 2) NOT NULL,
    iqr_usd DECIMAL(10, 2) NOT NULL,
    min_normal_usd DECIMAL(10, 2) NOT NULL,
    max_normal_usd DECIMAL(10, 2) NOT NULL,
    product_count INTEGER NOT NULL,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT positive_prices CHECK (median_price_usd > 0)
);
```

#### Quality Scores Cache
Cached results from product quality analysis.

```sql
CREATE TABLE product_quality_scores (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE UNIQUE,
    quality_score INTEGER NOT NULL CHECK (quality_score >= 0 AND quality_score <= 100),
    quality_level TEXT NOT NULL CHECK (quality_level IN ('green', 'yellow', 'red')),
    confidence_score INTEGER NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 100),
    
    -- Analysis breakdown
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
```

### ML Training Tables

#### Recommendation Impressions
Tracks recommendation displays for training data collection.

```sql
CREATE TABLE recommendation_impressions (
    id BIGSERIAL PRIMARY KEY,
    session_id TEXT,
    user_id TEXT,
    source_product_id INTEGER NOT NULL REFERENCES products(id),
    candidate_product_id INTEGER NOT NULL REFERENCES products(id),
    position INTEGER NOT NULL,
    algorithm_version TEXT NOT NULL DEFAULT 'v1.0',
    clicked BOOLEAN DEFAULT FALSE,
    purchased BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT valid_position CHECK (position > 0)
);
```

#### Recommendation Labels
Human-labeled training data for model improvement.

```sql
CREATE TABLE recommendation_labels (
    id BIGSERIAL PRIMARY KEY,
    impression_id BIGINT NOT NULL REFERENCES recommendation_impressions(id),
    label TEXT NOT NULL CHECK (label IN ('good', 'ok', 'bad')),
    labeler_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(impression_id)
);
```

#### Recommendation Features
Computed features for each impression used in ML training.

```sql
CREATE TABLE recommendation_features (
    id BIGSERIAL PRIMARY KEY,
    impression_id BIGINT NOT NULL REFERENCES recommendation_impressions(id) UNIQUE,
    
    -- Similarity features
    clip_sim REAL,
    text_sim REAL,
    category_match BOOLEAN,
    brand_match BOOLEAN,
    
    -- Style features
    style_score REAL,
    color_score REAL,
    formality_score REAL,
    occasion_score REAL,
    
    -- Market features
    price_ratio REAL,
    quality_score_diff REAL,
    popularity_ratio REAL,
    
    -- Context features
    seasonal_match BOOLEAN,
    size_compatibility REAL,
    
    computed_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Indexes and Performance

### Primary Indexes

#### Products Table Indexes
```sql
-- Core search indexes
CREATE INDEX idx_products_vendor_id ON products(vendor_id);
CREATE INDEX idx_products_category ON products(category) WHERE category IS NOT NULL;
CREATE INDEX idx_products_brand ON products(brand) WHERE brand IS NOT NULL;
CREATE INDEX idx_products_availability ON products(availability) WHERE availability = true;
CREATE INDEX idx_products_last_seen ON products(last_seen DESC);

-- Price indexes
CREATE INDEX idx_products_price ON products(price_cents);
CREATE INDEX idx_products_price_category ON products(category, price_cents) 
    WHERE category IS NOT NULL;

-- Full-text search
CREATE INDEX idx_products_title_fts ON products USING gin(to_tsvector('english', title));
CREATE INDEX idx_products_description_fts ON products USING gin(to_tsvector('english', description))
    WHERE description IS NOT NULL;

-- Composite search index
CREATE INDEX idx_products_search_composite ON products(category, availability, price_cents)
    WHERE availability = true AND category IS NOT NULL;
```

#### Product Images Indexes
```sql
-- Vector similarity search (requires pgvector extension)
CREATE INDEX idx_product_images_embedding ON product_images 
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Standard indexes
CREATE INDEX idx_product_images_product_id ON product_images(product_id);
CREATE INDEX idx_product_images_p_hash ON product_images(p_hash) 
    WHERE p_hash IS NOT NULL;
CREATE INDEX idx_product_images_primary ON product_images(product_id) 
    WHERE is_primary = true;
```

#### Price History Indexes
```sql
-- Time-series queries
CREATE INDEX idx_price_history_product_date ON price_history(product_id, recorded_at DESC);
CREATE INDEX idx_price_history_recorded_at ON price_history(recorded_at DESC);

-- Volatility analysis
CREATE INDEX idx_price_history_product_recent ON price_history(product_id, recorded_at DESC)
    WHERE recorded_at >= NOW() - INTERVAL '90 days';
```

### Advanced Indexing Strategies

#### Partial Indexes for Performance
```sql
-- Only index available products for search
CREATE INDEX idx_products_available_search ON products(category, brand, price_cents)
    WHERE availability = true;

-- Index only products with images for visual search
CREATE INDEX idx_products_with_images ON products(id)
    WHERE primary_image_id IS NOT NULL;

-- Index only recent price changes
CREATE INDEX idx_price_history_recent ON price_history(product_id, price_cents)
    WHERE recorded_at >= NOW() - INTERVAL '30 days';
```

#### Expression Indexes
```sql
-- Search by normalized title
CREATE INDEX idx_products_title_normalized ON products(lower(trim(title)));

-- Price ranges for faceting
CREATE INDEX idx_products_price_range ON products(
    CASE 
        WHEN price_cents < 5000 THEN 'under_50'
        WHEN price_cents < 15000 THEN '50_to_150'
        WHEN price_cents < 30000 THEN '150_to_300'
        ELSE 'over_300'
    END
) WHERE availability = true;
```

---

## Query Optimization

### Common Query Patterns

#### Product Search with Filters
```sql
-- Optimized product search
SELECT p.*, pi.cdn_url, v.name as vendor_name
FROM products p
LEFT JOIN product_images pi ON p.primary_image_id = pi.id
INNER JOIN vendors v ON p.vendor_id = v.id
WHERE p.availability = true
  AND p.category = $1
  AND p.price_cents BETWEEN $2 AND $3
  AND ($4 IS NULL OR p.brand ILIKE $4)
ORDER BY p.last_seen DESC
LIMIT $5 OFFSET $6;

-- Index hint for complex queries
/*+ IndexScan(products idx_products_search_composite) */
```

#### Vector Similarity Search
```sql
-- Find similar products by embedding
SELECT p.id, p.title, pi.cdn_url, 
       (pi.embedding <=> $1) as similarity_score
FROM product_images pi
INNER JOIN products p ON pi.product_id = p.id
WHERE p.availability = true
  AND pi.embedding IS NOT NULL
ORDER BY pi.embedding <=> $1
LIMIT 20;

-- Hybrid search combining text and vector
WITH text_matches AS (
    SELECT id, title, ts_rank(to_tsvector('english', title), query) as text_score
    FROM products, plainto_tsquery('english', $1) query
    WHERE to_tsvector('english', title) @@ query
    AND availability = true
),
vector_matches AS (
    SELECT p.id, p.title, (pi.embedding <=> $2) as vector_score
    FROM products p
    INNER JOIN product_images pi ON p.primary_image_id = pi.id
    WHERE p.availability = true
    ORDER BY pi.embedding <=> $2
    LIMIT 100
)
SELECT COALESCE(tm.id, vm.id) as id,
       COALESCE(tm.title, vm.title) as title,
       COALESCE(tm.text_score, 0) * 0.6 + COALESCE(vm.vector_score, 1) * 0.4 as combined_score
FROM text_matches tm
FULL OUTER JOIN vector_matches vm ON tm.id = vm.id
ORDER BY combined_score DESC
LIMIT 20;
```

#### Price Analysis Queries
```sql
-- Calculate price statistics for category
WITH price_stats AS (
    SELECT 
        percentile_cont(0.25) WITHIN GROUP (ORDER BY price_cents) as q1,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY price_cents) as median,
        percentile_cont(0.75) WITHIN GROUP (ORDER BY price_cents) as q3,
        count(*) as product_count
    FROM products 
    WHERE category = $1 
    AND availability = true 
    AND price_cents > 0
)
SELECT 
    q1, median, q3,
    (q3 - q1) as iqr,
    (q1 - 1.5 * (q3 - q1)) as min_normal,
    (q3 + 1.5 * (q3 - q1)) as max_normal,
    product_count
FROM price_stats;

-- Price volatility calculation
SELECT 
    product_id,
    stddev(price_cents) / avg(price_cents) as volatility,
    min(price_cents) as min_price,
    max(price_cents) as max_price,
    count(*) as price_points
FROM price_history 
WHERE product_id = $1 
AND recorded_at >= NOW() - INTERVAL '30 days'
GROUP BY product_id;
```

---

## Data Migrations and Versioning

### Migration Framework

#### Migration Script Template
```sql
-- Migration: 002_add_quality_scores.sql
-- Description: Add product quality scores table and indexes
-- Author: Fashion Team
-- Date: 2026-01-17

BEGIN;

-- Add migration tracking
INSERT INTO schema_migrations (version, description, applied_at)
VALUES ('002', 'Add product quality scores table', NOW());

-- Create table
CREATE TABLE product_quality_scores (
    -- Table definition here
);

-- Create indexes
CREATE INDEX idx_product_quality_scores_product_id ON product_quality_scores(product_id);
CREATE INDEX idx_product_quality_scores_quality_level ON product_quality_scores(quality_level);

-- Update existing data (if needed)
UPDATE products SET updated_at = NOW() WHERE updated_at IS NULL;

COMMIT;
```

#### Migration Management
```typescript
// migrations/migrator.ts
export class DatabaseMigrator {
  constructor(private db: pg.Client) {}
  
  async runMigrations(): Promise<void> {
    await this.ensureMigrationsTable();
    
    const appliedMigrations = await this.getAppliedMigrations();
    const allMigrations = await this.getAllMigrationFiles();
    
    for (const migration of allMigrations) {
      if (!appliedMigrations.includes(migration.version)) {
        await this.applyMigration(migration);
      }
    }
  }
  
  private async applyMigration(migration: Migration): Promise<void> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      
      // Read and execute migration SQL
      const sql = await fs.readFile(migration.path, 'utf-8');
      await client.query(sql);
      
      // Record migration
      await client.query(
        'INSERT INTO schema_migrations (version, description, applied_at) VALUES ($1, $2, NOW())',
        [migration.version, migration.description]
      );
      
      await client.query('COMMIT');
      console.log(`Applied migration: ${migration.version}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
```

### Data Validation and Cleanup

#### Data Quality Checks
```sql
-- Check for orphaned records
SELECT 'orphaned_product_images' as issue, count(*) as count
FROM product_images pi
LEFT JOIN products p ON pi.product_id = p.id
WHERE p.id IS NULL

UNION ALL

-- Check for products without primary images
SELECT 'products_without_primary_image' as issue, count(*) as count
FROM products p
LEFT JOIN product_images pi ON p.primary_image_id = pi.id
WHERE p.primary_image_id IS NOT NULL AND pi.id IS NULL

UNION ALL

-- Check for invalid prices
SELECT 'invalid_prices' as issue, count(*) as count
FROM products
WHERE price_cents <= 0 OR (sales_price_cents IS NOT NULL AND sales_price_cents > price_cents);
```

#### Automated Cleanup Procedures
```sql
-- Cleanup procedure for old price history
CREATE OR REPLACE FUNCTION cleanup_old_price_history()
RETURNS void AS $$
BEGIN
    -- Archive old price history (> 2 years)
    INSERT INTO price_history_archive
    SELECT * FROM price_history 
    WHERE recorded_at < NOW() - INTERVAL '2 years';
    
    -- Delete archived records
    DELETE FROM price_history 
    WHERE recorded_at < NOW() - INTERVAL '2 years';
    
    -- Update statistics
    ANALYZE price_history;
    
    RAISE NOTICE 'Price history cleanup completed at %', NOW();
END;
$$ LANGUAGE plpgsql;

-- Schedule cleanup (use pg_cron extension)
SELECT cron.schedule('cleanup-price-history', '0 2 * * 0', 'SELECT cleanup_old_price_history()');
```

---

## Backup and Recovery

### Backup Strategies

#### Full Database Backup
```bash
#!/bin/bash
# backup-full.sh

set -e

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backups/postgres"
DB_NAME="fashion"

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Full database dump
pg_dump \
    --host=$PG_HOST \
    --port=$PG_PORT \
    --username=$PG_USER \
    --dbname=$DB_NAME \
    --format=custom \
    --verbose \
    --file="$BACKUP_DIR/fashion_full_$TIMESTAMP.dump"

# Compress backup
gzip "$BACKUP_DIR/fashion_full_$TIMESTAMP.dump"

# Upload to cloud storage
aws s3 cp "$BACKUP_DIR/fashion_full_$TIMESTAMP.dump.gz" \
          "s3://fashion-backups/postgres/full/"

# Cleanup old local backups (keep 7 days)
find "$BACKUP_DIR" -name "fashion_full_*.dump.gz" -mtime +7 -delete

echo "Full backup completed: fashion_full_$TIMESTAMP.dump.gz"
```

#### Incremental Backup with WAL-E
```bash
#!/bin/bash
# setup-wal-e.sh

# Configure WAL-E for continuous archiving
export WALE_S3_PREFIX="s3://fashion-backups/postgres/wal-e"
export AWS_ACCESS_KEY_ID="your-access-key"
export AWS_SECRET_ACCESS_KEY="your-secret-key"

# Initial base backup
wal-e backup-push /var/lib/postgresql/data

# Setup continuous WAL archiving in postgresql.conf
echo "
archive_mode = on
archive_command = 'wal-e wal-push %p'
archive_timeout = 300
wal_level = archive
" >> /var/lib/postgresql/data/postgresql.conf
```

### Point-in-Time Recovery
```bash
#!/bin/bash
# restore-pitr.sh

TARGET_TIME="2026-01-17 14:30:00"
RESTORE_DIR="/var/lib/postgresql/restore"

# Stop PostgreSQL
systemctl stop postgresql

# Clean restore directory
rm -rf "$RESTORE_DIR"
mkdir -p "$RESTORE_DIR"

# Restore base backup
wal-e backup-fetch "$RESTORE_DIR" LATEST

# Configure recovery
cat > "$RESTORE_DIR/recovery.conf" << EOF
restore_command = 'wal-e wal-fetch "%f" "%p"'
recovery_target_time = '$TARGET_TIME'
recovery_target_action = 'promote'
EOF

# Set permissions
chown -R postgres:postgres "$RESTORE_DIR"
chmod 700 "$RESTORE_DIR"

# Start PostgreSQL with restored data
sudo -u postgres postgres -D "$RESTORE_DIR"
```

---

## Performance Monitoring

### Key Metrics to Monitor

#### Database Performance
```sql
-- Active connections
SELECT count(*) as active_connections
FROM pg_stat_activity
WHERE state = 'active';

-- Slow queries
SELECT query, mean_time, calls, total_time
FROM pg_stat_statements
ORDER BY mean_time DESC
LIMIT 10;

-- Index usage
SELECT schemaname, tablename, indexname, idx_tup_read, idx_tup_fetch
FROM pg_stat_user_indexes
ORDER BY idx_tup_read DESC;

-- Table sizes
SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
    pg_total_relation_size(schemaname||'.'||tablename) as size_bytes
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY size_bytes DESC;
```

#### Vector Search Performance
```sql
-- Vector search statistics
SELECT 
    count(*) as total_embeddings,
    count(*) FILTER (WHERE embedding IS NOT NULL) as non_null_embeddings,
    avg(length(embedding::text)) as avg_embedding_length
FROM product_images;

-- Vector similarity query performance
EXPLAIN (ANALYZE, BUFFERS) 
SELECT product_id, embedding <=> $1 as similarity
FROM product_images
WHERE embedding IS NOT NULL
ORDER BY embedding <=> $1
LIMIT 20;
```

### Alerting and Monitoring Setup

#### Prometheus Metrics
```sql
-- Custom metrics view for Prometheus
CREATE OR REPLACE VIEW metrics_dashboard AS
SELECT 
    'products_total' as metric_name,
    count(*)::text as metric_value,
    'Total number of products' as description
FROM products
WHERE availability = true

UNION ALL

SELECT 
    'products_with_images',
    count(*)::text,
    'Products with primary images'
FROM products
WHERE primary_image_id IS NOT NULL

UNION ALL

SELECT 
    'price_updates_24h',
    count(*)::text,
    'Price updates in last 24 hours'
FROM price_history
WHERE recorded_at >= NOW() - INTERVAL '24 hours';
```

This database guide provides comprehensive coverage of the PostgreSQL implementation for the Fashion Aggregator API, including schema design, performance optimization, and operational procedures.

