#!/usr/bin/env python3
"""
Test the recommendation dataset builder with sample data
"""

import sys
from pathlib import Path
sys.path.append(str(Path(__file__).parent))

from build_reco_dataset import RecommendationDatasetBuilder
import pandas as pd


def test_connection():
    """Test database connection"""
    print("Testing database connection...")
    try:
        builder = RecommendationDatasetBuilder()
        builder.connect()
        print("✓ Database connection successful")
        
        # Test query - count impressions
        cursor = builder.conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM recommendation_impressions")
        count = cursor.fetchone()[0]
        print(f"✓ Found {count} recommendation impressions")
        
        # Test query - count labels
        cursor.execute("SELECT COUNT(*) FROM recommendation_labels")
        label_count = cursor.fetchone()[0]
        print(f"✓ Found {label_count} recommendation labels")
        
        # Test join
        cursor.execute("""
            SELECT COUNT(*) 
            FROM recommendation_impressions ri
            LEFT JOIN recommendation_labels rl ON rl.impression_id = ri.id
            WHERE rl.label IS NOT NULL
        """)
        joined_count = cursor.fetchone()[0]
        print(f"✓ Found {joined_count} impressions with labels")
        
        builder.disconnect()
        return True
        
    except Exception as e:
        print(f"✗ Connection test failed: {e}")
        return False


def test_dataset_build():
    """Test building a small dataset"""
    print("\nTesting dataset build...")
    try:
        builder = RecommendationDatasetBuilder()
        
        # Extract last 7 days of data
        df = builder.extract_training_data(labeled_only=False)
        print(f"✓ Extracted {len(df)} rows")
        
        if len(df) == 0:
            print("⚠ No data found. Make sure you have impressions in your database.")
            return True
        
        # Print sample columns
        print(f"✓ Columns: {list(df.columns[:10])}...")
        
        # Create features
        df = builder.create_features(df)
        print(f"✓ Created features. New shape: {df.shape}")
        
        # Map labels
        df = builder.map_labels(df)
        print(f"✓ Mapped labels")
        
        # Show sample rows
        if len(df) > 0:
            print("\nSample data:")
            print(df[['clip_sim', 'text_sim', 'price_ratio', 'label', 'label_numeric']].head())
        
        return True
        
    except Exception as e:
        print(f"✗ Dataset build test failed: {e}")
        return False


def main():
    print("=== Recommendation Dataset Builder Test ===")
    
    # Test 1: Database connection
    if not test_connection():
        print("\n❌ Database connection failed. Check your DB_* environment variables.")
        return False
    
    # Test 2: Dataset building
    if not test_dataset_build():
        print("\n❌ Dataset building failed.")
        return False
    
    print("\n✅ All tests passed! Ready to build recommendation datasets.")
    print("\nNext steps:")
    print("1. Add more labeled data to recommendation_labels table")
    print("2. Run: python build_reco_dataset.py --output data/reco_training.csv")
    print("3. Train your recommendation model!")
    
    return True


if __name__ == '__main__':
    success = main()
    sys.exit(0 if success else 1)