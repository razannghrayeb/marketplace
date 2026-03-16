"""
Quick script to check if you have enough data to train the ranker.

Usage:
    python scripts/check_ranker_data.py
"""

import os
import sys
from datetime import datetime, timedelta

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
except ImportError:
    print("❌ psycopg2 not installed. Run: pip install psycopg2-binary")
    sys.exit(1)

def get_db_connection():
    """Create PostgreSQL connection from environment variables."""
    return psycopg2.connect(
        host=os.getenv("DB_HOST", "localhost"),
        port=os.getenv("DB_PORT", "5432"),
        database=os.getenv("DB_NAME", "fashion_marketplace"),
        user=os.getenv("DB_USER", "postgres"),
        password=os.getenv("DB_PASSWORD", ""),
        cursor_factory=RealDictCursor
    )

def main():
    print("="*70)
    print("🔍 XGBoost Ranker Training Data Check")
    print("="*70)
    print()

    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        print("✅ Database connected")
        print()
    except Exception as e:
        print(f"❌ Database connection failed: {e}")
        print()
        print("Set environment variables:")
        print("  DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD")
        sys.exit(1)

    # Check impressions
    cursor.execute("SELECT COUNT(*) as count FROM recommendation_impressions")
    total_impressions = cursor.fetchone()['count']

    cursor.execute("""
        SELECT COUNT(DISTINCT request_id) as count
        FROM recommendation_impressions
    """)
    total_queries = cursor.fetchone()['count']

    cursor.execute("""
        SELECT COUNT(DISTINCT base_product_id) as count
        FROM recommendation_impressions
    """)
    unique_base_products = cursor.fetchone()['count']

    cursor.execute("""
        SELECT
            COUNT(*) as with_clip,
            COUNT(*) FILTER (WHERE text_sim IS NOT NULL) as with_text,
            COUNT(*) FILTER (WHERE style_score IS NOT NULL) as with_style,
            COUNT(*) FILTER (WHERE p_hash_dist IS NOT NULL) as with_phash
        FROM recommendation_impressions
    """)
    feature_stats = cursor.fetchone()

    # Check labels
    cursor.execute("SELECT COUNT(*) as count FROM recommendation_labels")
    total_labels = cursor.fetchone()['count']

    cursor.execute("""
        SELECT label, COUNT(*) as count
        FROM recommendation_labels
        GROUP BY label
        ORDER BY count DESC
    """)
    label_breakdown = cursor.fetchall()

    # Recent data
    cursor.execute("""
        SELECT COUNT(*) as count
        FROM recommendation_impressions
        WHERE created_at > NOW() - INTERVAL '7 days'
    """)
    recent_impressions = cursor.fetchone()['count']

    # Avg candidates per query
    cursor.execute("""
        SELECT AVG(cnt) as avg_candidates
        FROM (
            SELECT request_id, COUNT(*) as cnt
            FROM recommendation_impressions
            GROUP BY request_id
        ) q
    """)
    avg_candidates = cursor.fetchone()['avg_candidates']

    # Print results
    print("📊 Impression Data")
    print("-" * 70)
    print(f"  Total impressions:        {total_impressions:,}")
    print(f"  Unique queries:           {total_queries:,}")
    print(f"  Unique base products:     {unique_base_products:,}")
    print(f"  Avg candidates per query: {float(avg_candidates):.1f}" if avg_candidates else "  Avg candidates per query: N/A")
    print(f"  Recent (7 days):          {recent_impressions:,}")
    print()

    print("🔧 Feature Coverage")
    print("-" * 70)
    print(f"  With CLIP sim:            {feature_stats['with_clip']:,} ({100*feature_stats['with_clip']/max(total_impressions,1):.1f}%)")
    print(f"  With text sim:            {feature_stats['with_text']:,} ({100*feature_stats['with_text']/max(total_impressions,1):.1f}%)")
    print(f"  With style score:         {feature_stats['with_style']:,} ({100*feature_stats['with_style']/max(total_impressions,1):.1f}%)")
    print(f"  With pHash:               {feature_stats['with_phash']:,} ({100*feature_stats['with_phash']/max(total_impressions,1):.1f}%)")
    print()

    print("🏷️  Label Data")
    print("-" * 70)
    print(f"  Total labels:             {total_labels:,}")
    if total_labels > 0:
        print(f"  Labeled coverage:         {100*total_labels/max(total_impressions,1):.1f}%")
        print()
        print("  Label breakdown:")
        for row in label_breakdown:
            print(f"    - {row['label']:10s}: {row['count']:,}")
    else:
        print("  ⚠️  No manual labels yet")
    print()

    # Assessment
    print("="*70)
    print("📋 Training Readiness Assessment")
    print("="*70)
    print()

    issues = []
    warnings = []
    success = []

    # Check minimum requirements
    if total_impressions < 50:
        issues.append(f"❌ Not enough impressions: {total_impressions} < 50 (minimum)")
    elif total_impressions < 500:
        warnings.append(f"⚠️  Low data: {total_impressions} impressions (500+ recommended)")
    else:
        success.append(f"✅ Good data volume: {total_impressions:,} impressions")

    if total_queries < 10:
        issues.append(f"❌ Not enough queries: {total_queries} < 10 (minimum)")
    elif total_queries < 100:
        warnings.append(f"⚠️  Low query diversity: {total_queries} queries (100+ recommended)")
    else:
        success.append(f"✅ Good query diversity: {total_queries:,} queries")

    if avg_candidates and float(avg_candidates) < 2:
        issues.append("❌ Need at least 2 candidates per query for ranking")
    elif avg_candidates:
        success.append(f"✅ Sufficient candidates: {float(avg_candidates):.1f} per query")

    if total_labels == 0:
        warnings.append("⚠️  No manual labels - will use position-based implicit signals")
        warnings.append("   Consider labeling some data for better results")
    elif total_labels < 50:
        warnings.append(f"⚠️  Few labels: {total_labels} (100+ recommended)")
    else:
        success.append(f"✅ Good label coverage: {total_labels:,} labels")

    # Feature coverage
    if feature_stats['with_clip'] < total_impressions * 0.9:
        warnings.append(f"⚠️  Some impressions missing CLIP features")

    # Print assessment
    for msg in success:
        print(msg)

    for msg in warnings:
        print(msg)

    for msg in issues:
        print(msg)

    print()
    print("="*70)

    if issues:
        print("❌ NOT READY FOR TRAINING")
        print()
        print("Next steps:")
        print("  1. Generate more recommendation impressions by using the API")
        print("  2. Use the /api/recommendations endpoints with different products")
        print("  3. Optionally add manual labels via recommendation_labels table")
        print()
    elif warnings:
        print("⚠️  CAN TRAIN, but more data recommended")
        print()
        print("You can train now with:")
        print("  python scripts/train_xgboost_ranker.py")
        print()
        print("For better results:")
        print("  - Collect more impressions (use the API more)")
        print("  - Add manual labels for key product pairs")
        print("  - Ensure feature coverage is > 90%")
        print()
    else:
        print("✅ READY FOR TRAINING!")
        print()
        print("Train your model:")
        print("  python scripts/train_xgboost_ranker.py")
        print()
        print("Advanced options:")
        print("  python scripts/train_xgboost_ranker.py --max-depth 8 --n-estimators 150")
        print()

    conn.close()

if __name__ == "__main__":
    main()
