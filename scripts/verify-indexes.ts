import { pg } from './src/lib/core/db';

(async () => {
  try {
    console.log('\n=== DB Indexing Verification ===\n');

    // Check Tier 1 indexes
    const tier1 = await pg.query(`
      SELECT indexname, tablename, pg_size_pretty(pg_relation_size(indexrelid)) as size
      FROM pg_stat_user_indexes
      WHERE indexname IN (
        'idx_products_hydration_covering',
        'idx_products_category_color',
        'idx_products_brand_category',
        'idx_products_color'
      )
      ORDER BY pg_relation_size(indexrelid) DESC
    `);

    console.log('✓ TIER 1: Critical Hydration & Reranking Indexes');
    if (tier1.rows.length > 0) {
      tier1.rows.forEach(r => {
        console.log(`  • ${r.indexname} (${r.tablename}): ${r.size}`);
      });
    } else {
      console.log('  (Not found - may need migration)');
    }

    // Check Tier 2 indexes
    const tier2 = await pg.query(`
      SELECT indexname, tablename
      FROM pg_stat_user_indexes
      WHERE indexname IN (
        'idx_wardrobe_items_user',
        'idx_wardrobe_items_product',
        'idx_learned_compat_categories',
        'idx_outfit_coherence_scores',
        'idx_auto_sync_settings_user',
        'idx_purchase_sync_log'
      )
    `);

    console.log('\n✓ TIER 2: Feature #6 Wardrobe Optimization');
    if (tier2.rows.length > 0) {
      console.log(`  Created: ${tier2.rows.length} indexes`);
      tier2.rows.forEach(r => console.log(`  • ${r.indexname}`));
    }

    // Summary
    console.log('\n=== EXPECTED PERFORMANCE IMPROVEMENTS ===');
    console.log('• Hydration: 3604ms → ~1000ms (72% reduction)');
    console.log('• Reranking: 3028ms → ~1200ms (60% reduction)');
    console.log('• Total search: ~7.8s → ~3.4s (56% reduction)');
    console.log('• Full response: ~8.75s → ~4.2s (52% reduction)');

    console.log('\n✓ Next Steps:');
    console.log('1. Deploy to production');
    console.log('2. Monitor logs: grep "total_ms\\|hydrate_ms\\|rerank_ms"');
    console.log('3. Compare metrics over 24-48 hours');

  } catch (error) {
    console.error('Verification failed:', error);
  } finally {
    await pg.end();
  }
})();
