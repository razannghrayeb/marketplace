/**
 * Migration: Add Compare Feature Tables
 * 
 * Creates tables for:
 * - product_quality_scores: Cached quality analysis per product
 * - category_price_baselines: Weekly computed price baselines per category
 * - comparison_results: Cached comparison results (optional)
 * 
 * Run: npx tsx scripts/migrate-compare-tables.ts
 */

import { pg } from "../src/lib/db";

async function migrate() {
  console.log("Starting compare tables migration...\n");

  // ============================================================================
  // 1. Category Price Baselines (for anomaly detection)
  // ============================================================================
  
  console.log("1. Creating category_price_baselines table...");
  
  const baselineExists = await pg.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_name = 'category_price_baselines'
    )
  `);
  
  if (!baselineExists.rows[0].exists) {
    await pg.query(`
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
        computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    
    await pg.query(`
      CREATE INDEX idx_category_baselines_category ON category_price_baselines(category)
    `);
    
    console.log("   ✓ Created category_price_baselines table");
  } else {
    console.log("   ⊘ category_price_baselines already exists");
  }

  // ============================================================================
  // 2. Product Quality Scores (cached quality analysis)
  // ============================================================================
  
  console.log("\n2. Creating product_quality_scores table...");
  
  const qualityExists = await pg.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_name = 'product_quality_scores'
    )
  `);
  
  if (!qualityExists.rows[0].exists) {
    await pg.query(`
      CREATE TABLE product_quality_scores (
        id SERIAL PRIMARY KEY,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        
        -- Quality scores
        quality_score INTEGER NOT NULL CHECK (quality_score >= 0 AND quality_score <= 100),
        quality_level TEXT NOT NULL CHECK (quality_level IN ('green', 'yellow', 'red')),
        confidence_score INTEGER NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 100),
        
        -- Extracted attributes (JSONB for flexibility)
        attributes JSONB NOT NULL DEFAULT '{}',
        
        -- Quality signals
        has_fabric BOOLEAN NOT NULL DEFAULT FALSE,
        has_fit BOOLEAN NOT NULL DEFAULT FALSE,
        has_size_info BOOLEAN NOT NULL DEFAULT FALSE,
        has_care_instructions BOOLEAN NOT NULL DEFAULT FALSE,
        has_return_policy BOOLEAN NOT NULL DEFAULT FALSE,
        has_measurements BOOLEAN NOT NULL DEFAULT FALSE,
        word_count INTEGER NOT NULL DEFAULT 0,
        
        -- Red flags
        red_flags JSONB NOT NULL DEFAULT '[]',
        
        -- Versioning
        version TEXT NOT NULL DEFAULT '1.0.0',
        computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        
        UNIQUE(product_id)
      )
    `);
    
    await pg.query(`
      CREATE INDEX idx_quality_scores_product ON product_quality_scores(product_id)
    `);
    await pg.query(`
      CREATE INDEX idx_quality_scores_level ON product_quality_scores(quality_level)
    `);
    
    console.log("   ✓ Created product_quality_scores table");
  } else {
    console.log("   ⊘ product_quality_scores already exists");
  }

  // ============================================================================
  // 3. Price Analysis Cache (optional, for performance)
  // ============================================================================
  
  console.log("\n3. Creating product_price_analysis table...");
  
  const priceAnalysisExists = await pg.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_name = 'product_price_analysis'
    )
  `);
  
  if (!priceAnalysisExists.rows[0].exists) {
    await pg.query(`
      CREATE TABLE product_price_analysis (
        id SERIAL PRIMARY KEY,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        
        -- Price data
        current_price_usd DECIMAL(10, 2) NOT NULL,
        
        -- Stability
        stability TEXT NOT NULL CHECK (stability IN ('stable', 'moderate', 'high_risk')),
        volatility_percent DECIMAL(5, 1) NOT NULL DEFAULT 0,
        price_changes_7d INTEGER NOT NULL DEFAULT 0,
        price_changes_30d INTEGER NOT NULL DEFAULT 0,
        
        -- Market position
        market_position TEXT NOT NULL CHECK (market_position IN ('normal', 'below_market', 'suspicious_low', 'above_market', 'premium', 'unknown')),
        category_median_usd DECIMAL(10, 2),
        percentile_in_category INTEGER,
        
        -- Discount analysis
        discount_behavior TEXT NOT NULL CHECK (discount_behavior IN ('none', 'normal', 'frequent', 'suspicious')),
        has_current_discount BOOLEAN NOT NULL DEFAULT FALSE,
        current_discount_percent INTEGER,
        discount_frequency_30d INTEGER NOT NULL DEFAULT 0,
        
        -- Anomalies
        anomalies JSONB NOT NULL DEFAULT '[]',
        
        -- Risk score
        risk_score INTEGER NOT NULL CHECK (risk_score >= 0 AND risk_score <= 100),
        risk_level TEXT NOT NULL CHECK (risk_level IN ('green', 'yellow', 'red')),
        
        -- Versioning
        computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        
        UNIQUE(product_id)
      )
    `);
    
    await pg.query(`
      CREATE INDEX idx_price_analysis_product ON product_price_analysis(product_id)
    `);
    await pg.query(`
      CREATE INDEX idx_price_analysis_risk ON product_price_analysis(risk_level)
    `);
    
    console.log("   ✓ Created product_price_analysis table");
  } else {
    console.log("   ⊘ product_price_analysis already exists");
  }

  // ============================================================================
  // 4. Add return_policy column to products if not exists
  // ============================================================================
  
  console.log("\n4. Adding return_policy column to products...");
  
  const returnPolicyExists = await pg.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.columns 
      WHERE table_name = 'products' AND column_name = 'return_policy'
    )
  `);
  
  if (!returnPolicyExists.rows[0].exists) {
    await pg.query(`
      ALTER TABLE products ADD COLUMN return_policy TEXT
    `);
    console.log("   ✓ Added return_policy column");
  } else {
    console.log("   ⊘ return_policy column already exists");
  }

  // ============================================================================
  // 5. Ensure price_history table exists
  // ============================================================================
  
  console.log("\n5. Checking price_history table...");
  
  const priceHistoryExists = await pg.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_name = 'price_history'
    )
  `);
  
  if (!priceHistoryExists.rows[0].exists) {
    await pg.query(`
      CREATE TABLE price_history (
        id SERIAL PRIMARY KEY,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        price_cents BIGINT NOT NULL,
        currency TEXT NOT NULL DEFAULT 'LBP',
        sale_price_cents BIGINT,
        availability BOOLEAN NOT NULL DEFAULT TRUE,
        recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    
    await pg.query(`
      CREATE INDEX idx_price_history_product ON price_history(product_id)
    `);
    await pg.query(`
      CREATE INDEX idx_price_history_recorded ON price_history(recorded_at)
    `);
    await pg.query(`
      CREATE INDEX idx_price_history_product_date ON price_history(product_id, recorded_at DESC)
    `);
    
    console.log("   ✓ Created price_history table");
  } else {
    console.log("   ⊘ price_history already exists");
  }

  // ============================================================================
  // 6. Add indexes for compare performance
  // ============================================================================
  
  console.log("\n6. Adding performance indexes...");
  
  try {
    await pg.query(`
      CREATE INDEX IF NOT EXISTS idx_products_category_price 
      ON products(category, price_cents) 
      WHERE is_hidden = false
    `);
    console.log("   ✓ Added category_price index");
  } catch (e) {
    console.log("   ⊘ category_price index may already exist");
  }

  // ============================================================================
  // Done
  // ============================================================================
  
  console.log("\n" + "=".repeat(50));
  console.log("Migration complete!");
  console.log("=".repeat(50));
  
  // Show table sizes
  const tables = [
    'category_price_baselines',
    'product_quality_scores',
    'product_price_analysis',
    'price_history'
  ];
  
  console.log("\nTable row counts:");
  for (const table of tables) {
    try {
      const result = await pg.query(`SELECT COUNT(*) FROM ${table}`);
      console.log(`  ${table}: ${result.rows[0].count} rows`);
    } catch (e) {
      console.log(`  ${table}: (error reading)`);
    }
  }
  
  await pg.end();
}

migrate().catch(console.error);
