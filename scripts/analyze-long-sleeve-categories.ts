/**
 * Long Sleeve Tops & Outerwear Category Analysis & Migration
 * 
 * Analyzes the current fragmented category data and generates:
 *  - Mapping report showing which categories normalize to which canonical form
 *  - Unmapped categories that need manual review
 *  - Product count distribution by canonical category
 *  - Migration queries to update category fields
 * 
 * Usage:
 *   npx tsx scripts/analyze-long-sleeve-categories.ts              # Full analysis
 *   npx tsx scripts/analyze-long-sleeve-categories.ts --report     # Print report
 *   npx tsx scripts/analyze-long-sleeve-categories.ts --unmapped   # Show unmapped only
 *   npx tsx scripts/analyze-long-sleeve-categories.ts --migrate    # Generate UPDATE queries
 */

import "dotenv/config";
import { pg } from "../src/lib/core/db";
import {
  normalizeCategory,
  getAllMappedCategories,
  getCategoryVariants,
  isOuterwear,
  isTop,
  isLongSleeveTypical,
} from "../src/lib/category/longSleeveTopsCategoryMap";
import { promises as fs } from "fs";
import * as path from "path";

interface CategoryStats {
  raw: string;
  canonical: string | null;
  total: number;
  isMapped: boolean;
  isOuterwear: boolean;
  isTop: boolean;
  isLongSleeveBiased: boolean;
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || 'full';

  console.log('🔍 Analyzing Long Sleeve Tops & Outerwear Categories...\n');

  try {
    const categories = await fetchCategoryStats();
    const analysis = analyzeCategoryMapping(categories);

    switch (mode) {
      case '--report':
        printMappingReport(analysis);
        break;
      case '--unmapped':
        printUnmappedCategories(analysis);
        break;
      case '--migrate':
        generateMigrationQueries(analysis);
        break;
      case 'full':
      default:
        printFullAnalysis(analysis);
        break;
    }

    console.log('✅ Analysis complete.\n');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

// ============================================================================
// Data Fetching
// ============================================================================

async function fetchCategoryStats(): Promise<CategoryStats[]> {
  const query = `
    SELECT 
      category,
      COUNT(*) as total
    FROM products
    WHERE category IS NOT NULL
    GROUP BY category
    ORDER BY total DESC;
  `;

  const result = await pg.query<{ category: string; total: string }>(query);
  return result.rows.map((row) => ({
    raw: row.category,
    canonical: normalizeCategory(row.category),
    total: parseInt(row.total),
    isMapped: normalizeCategory(row.category) !== null,
    isOuterwear: normalizeCategory(row.category) ? isOuterwear(normalizeCategory(row.category)!) : false,
    isTop: normalizeCategory(row.category) ? isTop(normalizeCategory(row.category)!) : false,
    isLongSleeveBiased: normalizeCategory(row.category) ? isLongSleeveTypical(normalizeCategory(row.category)!) : false,
  }));
}

// ============================================================================
// Analysis
// ============================================================================

interface Analysis {
  total: CategoryStats[];
  mapped: CategoryStats[];
  unmapped: CategoryStats[];
  byCanonical: Map<string, CategoryStats[]>;
  stats: {
    totalRawCategories: number;
    totalMappedCategories: number;
    totalUnmappedCategories: number;
    totalProducts: number;
    mappedProducts: number;
    unmappedProducts: number;
    mappedPercentage: number;
  };
}

function analyzeCategoryMapping(categories: CategoryStats[]): Analysis {
  const mapped = categories.filter((c) => c.isMapped);
  const unmapped = categories.filter((c) => !c.isMapped);

  const byCanonical = new Map<string, CategoryStats[]>();
  for (const item of mapped) {
    const key = item.canonical!;
    if (!byCanonical.has(key)) {
      byCanonical.set(key, []);
    }
    byCanonical.get(key)!.push(item);
  }

  const totalProducts = categories.reduce((sum, c) => sum + c.total, 0);
  const mappedProducts = mapped.reduce((sum, c) => sum + c.total, 0);
  const unmappedProducts = unmapped.reduce((sum, c) => sum + c.total, 0);

  return {
    total: categories,
    mapped,
    unmapped,
    byCanonical,
    stats: {
      totalRawCategories: categories.length,
      totalMappedCategories: mapped.length,
      totalUnmappedCategories: unmapped.length,
      totalProducts,
      mappedProducts,
      unmappedProducts,
      mappedPercentage: (mappedProducts / totalProducts) * 100,
    },
  };
}

// ============================================================================
// Report Generation
// ============================================================================

function printFullAnalysis(analysis: Analysis) {
  printSummaryStats(analysis);
  console.log('\n' + '='.repeat(80));
  printMappingReport(analysis);
  console.log('\n' + '='.repeat(80));
  printUnmappedCategories(analysis);
}

function printSummaryStats(analysis: Analysis) {
  const s = analysis.stats;
  console.log('📊 SUMMARY STATISTICS');
  console.log('─'.repeat(80));
  console.log(`Total Raw Categories:       ${s.totalRawCategories}`);
  console.log(`  ✅ Mapped:                  ${s.totalMappedCategories}`);
  console.log(`  ❌ Unmapped:                ${s.totalUnmappedCategories}`);
  console.log(`\nTotal Products:             ${s.totalProducts.toLocaleString()}`);
  console.log(`  ✅ In Mapped Categories:    ${s.mappedProducts.toLocaleString()} (${s.mappedPercentage.toFixed(1)}%)`);
  console.log(`  ❌ In Unmapped Categories:  ${s.unmappedProducts.toLocaleString()} (${(100 - s.mappedPercentage).toFixed(1)}%)`);
}

function printMappingReport(analysis: Analysis) {
  console.log('\n📋 CANONICAL CATEGORY MAPPING REPORT');
  console.log('─'.repeat(80));

  const sorted = Array.from(analysis.byCanonical.entries())
    .sort((a, b) => {
      const aTotal = a[1].reduce((sum, c) => sum + c.total, 0);
      const bTotal = b[1].reduce((sum, c) => sum + c.total, 0);
      return bTotal - aTotal;
    });

  for (const [canonical, variants] of sorted) {
    const totalProducts = variants.reduce((sum, c) => sum + c.total, 0);
    const type = variants[0].isOuterwear ? '🧥' : '👕';
    const longSleeve = variants[0].isLongSleeveBiased ? '🔗' : '  ';

    console.log(
      `${type} ${longSleeve} ${canonical.padEnd(18)} ${totalProducts.toString().padStart(6)} products (${variants.length} variants)`
    );

    for (const variant of variants.sort((a, b) => b.total - a.total)) {
      console.log(`     → ${variant.raw.padEnd(40)} ${variant.total.toString().padStart(6)} products`);
    }
  }
}

function printUnmappedCategories(analysis: Analysis) {
  if (analysis.unmapped.length === 0) {
    console.log('✅ All categories are mapped!\n');
    return;
  }

  console.log('\n⚠️  UNMAPPED CATEGORIES (Manual Review Required)');
  console.log('─'.repeat(80));
  console.log(`${analysis.unmapped.length} unmapped categories totaling ${analysis.stats.unmappedProducts.toLocaleString()} products\n`);

  const sorted = analysis.unmapped.sort((a, b) => b.total - a.total).slice(0, 50);

  for (const item of sorted) {
    console.log(`  "${item.raw}".padEnd(40) → ${item.total.toString().padStart(6)} products`);
  }

  if (analysis.unmapped.length > 50) {
    console.log(`  ... and ${analysis.unmapped.length - 50} more unmapped categories`);
  }
}

function generateMigrationQueries(analysis: Analysis) {
  console.log('\n📝 MIGRATION QUERIES');
  console.log('─'.repeat(80));
  console.log('Use these UPDATE statements to normalize category fields in production.\n');

  const queries: string[] = [];

  for (const [canonical, variants] of analysis.byCanonical) {
    const categories = variants.map((v) => `'${v.raw}'`).join(', ');
    const query = `
-- Normalize to '${canonical}'
UPDATE products
SET category_normalized = '${canonical}'
WHERE category IN (${categories});
    `.trim();
    queries.push(query);
  }

  console.log(queries.join('\n\n'));
  console.log('\n-- Verify migration');
  console.log('SELECT category_normalized, COUNT(*) FROM products GROUP BY category_normalized ORDER BY COUNT(*) DESC;');
}

main();
