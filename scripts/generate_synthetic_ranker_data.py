"""
Generate Synthetic Training Data for XGBoost Ranker

This script bootstraps your ranker training when you don't have enough
real user data yet. It creates realistic recommendation impressions based
on your actual product catalog.

⚠️  WARNING: This is for COLD START ONLY. Replace with real data ASAP.

Usage:
    python scripts/generate_synthetic_ranker_data.py --num-queries 100
"""

import os
import sys
import random
import argparse
from datetime import datetime, timedelta
from typing import List, Dict, Tuple
from uuid import uuid4

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
except ImportError:
    print("❌ psycopg2 not installed. Run: pip install psycopg2-binary")
    sys.exit(1)

def get_db_connection():
    """Create PostgreSQL connection."""
    return psycopg2.connect(
        host=os.getenv("DB_HOST", "localhost"),
        port=os.getenv("DB_PORT", "5432"),
        database=os.getenv("DB_NAME", "fashion_marketplace"),
        user=os.getenv("DB_USER", "postgres"),
        password=os.getenv("DB_PASSWORD", ""),
        cursor_factory=RealDictCursor
    )

def load_products(conn) -> List[Dict]:
    """Load products from database."""
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, title, brand, category, price_cents
        FROM products
        WHERE id IS NOT NULL
        LIMIT 1000
    """)
    return cursor.fetchall()

def compute_synthetic_similarity(
    base: Dict,
    candidate: Dict
) -> Dict[str, float]:
    """
    Compute synthetic features based on product metadata.

    In production, these would come from actual CLIP embeddings, etc.
    Here we use heuristics to create realistic training data.
    """
    # CLIP similarity (based on category match)
    category_match = 1.0 if base['category'] == candidate['category'] else 0.3
    clip_sim = category_match * random.uniform(0.7, 1.0) + random.gauss(0, 0.1)
    clip_sim = max(0.1, min(1.0, clip_sim))

    # Text similarity (based on brand + category)
    brand_match = 1.0 if base['brand'] == candidate['brand'] else 0.0
    text_sim = (category_match * 0.6 + brand_match * 0.4) + random.gauss(0, 0.15)
    text_sim = max(0.1, min(1.0, text_sim))

    # Style and color scores (random but correlated with similarity)
    base_score = (clip_sim + text_sim) / 2
    style_score = base_score + random.gauss(0, 0.1)
    color_score = base_score + random.gauss(0, 0.15)

    style_score = max(0.1, min(1.0, style_score))
    color_score = max(0.1, min(1.0, color_score))

    # Price features
    base_price = base['price_cents'] or 10000
    cand_price = candidate['price_cents'] or 10000
    price_ratio = cand_price / base_price

    # Same brand/vendor (simplified)
    same_brand = base['brand'] == candidate['brand']

    # pHash distance (synthetic - correlated with visual sim)
    phash_dist = int((1 - clip_sim) * 64 * random.uniform(0.8, 1.2))
    phash_dist = max(0, min(64, phash_dist))

    # Final match score
    final_match = (
        clip_sim * 0.35 +
        text_sim * 0.25 +
        style_score * 0.2 +
        color_score * 0.15 +
        (1.0 if same_brand else 0.0) * 0.05
    )

    return {
        'clip_sim': round(clip_sim, 4),
        'text_sim': round(text_sim, 4),
        'opensearch_score': round(clip_sim * 10 + random.uniform(-1, 1), 4),
        'candidate_score': round((clip_sim + text_sim) / 2, 4),
        'p_hash_dist': phash_dist,
        'style_score': round(style_score, 4),
        'color_score': round(color_score, 4),
        'final_match_score': round(final_match, 4),
        'price_ratio': round(price_ratio, 4),
        'same_brand': same_brand,
        'same_vendor': False,  # Simplified
        'category_pair': f"{base['category']}->{candidate['category']}" if base['category'] and candidate['category'] else None,
    }

def compute_synthetic_label(features: Dict[str, float]) -> Tuple[str, int]:
    """
    Assign a label based on feature quality.

    Returns: (label, label_score)
    """
    score = features['final_match_score']

    if score >= 0.75:
        return 'good', int(score * 10)
    elif score >= 0.5:
        return 'ok', int(score * 10)
    else:
        return 'bad', int(score * 10)

def generate_candidates_for_query(
    base_product: Dict,
    all_products: List[Dict],
    num_candidates: int
) -> List[Tuple[Dict, Dict, str, int]]:
    """
    Generate realistic candidates for a base product.

    Returns: List of (candidate_product, features, label, label_score)
    """
    # Prefer same category (80% of candidates)
    same_category = [p for p in all_products if p['category'] == base_product['category'] and p['id'] != base_product['id']]
    other_category = [p for p in all_products if p['category'] != base_product['category'] and p['id'] != base_product['id']]

    num_same = int(num_candidates * 0.8)
    num_other = num_candidates - num_same

    candidates = []

    # Sample from same category
    if len(same_category) >= num_same:
        candidates.extend(random.sample(same_category, num_same))
    else:
        candidates.extend(same_category)
        candidates.extend(random.sample(other_category, num_same - len(same_category)))

    # Sample from other categories
    if len(other_category) >= num_other:
        candidates.extend(random.sample(other_category, num_other))
    elif other_category:
        candidates.extend(random.sample(other_category, min(num_other, len(other_category))))

    # Shuffle
    random.shuffle(candidates)

    # Compute features and labels
    results = []
    for candidate in candidates:
        features = compute_synthetic_similarity(base_product, candidate)
        label, label_score = compute_synthetic_label(features)
        results.append((candidate, features, label, label_score))

    # Sort by match score (best candidates first)
    results.sort(key=lambda x: x[1]['final_match_score'], reverse=True)

    return results

def insert_synthetic_data(
    conn,
    base_product: Dict,
    candidates: List[Tuple[Dict, Dict, str, int]]
):
    """Insert synthetic impressions and labels into database."""
    cursor = conn.cursor()
    request_id = str(uuid4())

    # Insert impressions
    for position, (candidate, features, label, label_score) in enumerate(candidates, start=1):
        cursor.execute("""
            INSERT INTO recommendation_impressions (
                request_id, base_product_id, candidate_product_id, position,
                candidate_score, clip_sim, text_sim, opensearch_score, p_hash_dist,
                style_score, color_score, final_match_score,
                category_pair, price_ratio, same_brand, same_vendor,
                match_reasons, source, context
            ) VALUES (
                %s, %s, %s, %s,
                %s, %s, %s, %s, %s,
                %s, %s, %s,
                %s, %s, %s, %s,
                %s, %s, %s
            )
            ON CONFLICT (request_id, base_product_id, candidate_product_id) DO NOTHING
            RETURNING id
        """, (
            request_id, base_product['id'], candidate['id'], position,
            features['candidate_score'], features['clip_sim'], features['text_sim'],
            features['opensearch_score'], features['p_hash_dist'],
            features['style_score'], features['color_score'], features['final_match_score'],
            features['category_pair'], features['price_ratio'],
            features['same_brand'], features['same_vendor'],
            '["synthetic_data"]', 'both', 'synthetic_training_data'
        ))

        result = cursor.fetchone()
        if result:
            impression_id = result['id']

            # Insert label (50% chance)
            if random.random() < 0.5:
                cursor.execute("""
                    INSERT INTO recommendation_labels (
                        impression_id, base_product_id, candidate_product_id,
                        label, label_score, labeler_id, notes
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (base_product_id, candidate_product_id, labeler_id) DO NOTHING
                """, (
                    impression_id, base_product['id'], candidate['id'],
                    label, label_score, 'synthetic_generator',
                    'Synthetic label for cold start training'
                ))

    conn.commit()

def main():
    parser = argparse.ArgumentParser(description="Generate synthetic ranker training data")
    parser.add_argument("--num-queries", type=int, default=100,
                        help="Number of queries (base products) to generate")
    parser.add_argument("--candidates-per-query", type=int, default=10,
                        help="Number of candidates per query")
    parser.add_argument("--seed", type=int, default=42,
                        help="Random seed for reproducibility")

    args = parser.parse_args()

    random.seed(args.seed)

    print("="*70)
    print("🔧 Synthetic Training Data Generator")
    print("="*70)
    print()
    print(f"Configuration:")
    print(f"  Queries:       {args.num_queries}")
    print(f"  Candidates:    {args.candidates_per_query} per query")
    print(f"  Random seed:   {args.seed}")
    print()
    print("⚠️  WARNING: This generates SYNTHETIC data for cold start training.")
    print("   Replace with real user interaction data as soon as possible!")
    print()

    # Connect to database
    try:
        conn = get_db_connection()
        print("✅ Database connected")
    except Exception as e:
        print(f"❌ Database connection failed: {e}")
        sys.exit(1)

    # Load products
    print("📦 Loading products...")
    products = load_products(conn)
    print(f"✅ Loaded {len(products)} products")

    if len(products) < args.candidates_per_query + 10:
        print(f"❌ Not enough products: {len(products)} < {args.candidates_per_query + 10}")
        sys.exit(1)

    print()
    print("🔄 Generating synthetic data...")

    # Generate data
    total_impressions = 0
    total_labels = 0

    for i in range(args.num_queries):
        # Pick random base product
        base_product = random.choice(products)

        # Generate candidates
        candidates = generate_candidates_for_query(
            base_product,
            products,
            args.candidates_per_query
        )

        # Insert into database
        insert_synthetic_data(conn, base_product, candidates)

        total_impressions += len(candidates)
        total_labels += sum(1 for _ in candidates if random.random() < 0.5)

        if (i + 1) % 10 == 0:
            print(f"  Progress: {i+1}/{args.num_queries} queries ({total_impressions} impressions, {total_labels} labels)")

    print()
    print("="*70)
    print("✅ Synthetic data generation complete!")
    print("="*70)
    print()
    print(f"📊 Summary:")
    print(f"  Total impressions:  {total_impressions:,}")
    print(f"  Total labels:       {total_labels:,}")
    print(f"  Labeling rate:      {100*total_labels/total_impressions:.1f}%")
    print()
    print("🚀 Next steps:")
    print("  1. Check data quality: python scripts/check_ranker_data.py")
    print("  2. Train model: python scripts/train_xgboost_ranker.py")
    print("  3. Replace with real data ASAP!")
    print()

    conn.close()

if __name__ == "__main__":
    main()
