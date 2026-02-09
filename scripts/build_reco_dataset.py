#!/usr/bin/env python3
"""
Build Recommendation Training Dataset

Extracts recommendation impressions and labels from the database,
joins them, and exports to CSV/Parquet for ML model training.

Usage:
    python scripts/build_reco_dataset.py --output data/reco_training.csv
    python scripts/build_reco_dataset.py --output data/reco_training.parquet --format parquet
"""

import os
import sys
import argparse
import logging
from pathlib import Path
from typing import Optional, Dict, Any
import pandas as pd
import numpy as np
from datetime import datetime, timedelta

# Add project root to path to import local modules
sys.path.append(str(Path(__file__).parent.parent))

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print("Error: psycopg2 not installed. Install with: pip install psycopg2-binary")
    sys.exit(1)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class RecommendationDatasetBuilder:
    """Builds training dataset from recommendation impressions and labels"""
    
    def __init__(self, db_config: Optional[Dict[str, str]] = None):
        self.db_config = db_config or self._load_db_config()
        self.conn = None
    
    def _load_db_config(self) -> Dict[str, str]:
        """Load database configuration from environment variables"""
        
        # Check for Supabase connection string first
        supabase_url = os.getenv('SUPABASE_URL')
        if supabase_url:
            # Parse Supabase URL: postgresql://postgres:[password]@db.xxx.supabase.co:5432/postgres
            import urllib.parse as urlparse
            parsed = urlparse.urlparse(supabase_url)
            return {
                'host': parsed.hostname,
                'port': str(parsed.port or 5432),
                'name': parsed.path.lstrip('/'),
                'user': parsed.username,
                'password': parsed.password
            }
        
        # Fallback to individual environment variables
        required_vars = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']
        config = {}
        
        for var in required_vars:
            value = os.getenv(var)
            if not value:
                # Supabase defaults if no individual vars set
                defaults = {
                    'DB_HOST': 'db.afycknzavzcpgosfaxsq.supabase.co',
                    'DB_PORT': '5432', 
                    'DB_NAME': 'postgres',
                    'DB_USER': 'postgres',
                    'DB_PASSWORD': ''  # User must provide this
                }
                value = defaults.get(var, '')
                if var == 'DB_PASSWORD' and not value:
                    raise ValueError(f"Missing required password. Set SUPABASE_URL or {var}")
                if not value:
                    raise ValueError(f"Missing required environment variable: {var}")
                logger.warning(f"Using default value for {var}: {value}")
            
            config[var.lower().replace('db_', '')] = value
        
        return config
    
    def connect(self):
        """Establish database connection"""
        try:
            self.conn = psycopg2.connect(
                host=self.db_config['host'],
                port=self.db_config['port'],
                database=self.db_config['name'],
                user=self.db_config['user'],
                password=self.db_config['password']
            )
            logger.info("Connected to database successfully")
        except Exception as e:
            logger.error(f"Failed to connect to database: {e}")
            raise
    
    def disconnect(self):
        """Close database connection"""
        if self.conn:
            self.conn.close()
            self.conn = None
            logger.info("Disconnected from database")
    
    def extract_training_data(self, 
                            min_date: Optional[datetime] = None,
                            max_date: Optional[datetime] = None,
                            sources: Optional[list] = None,
                            labeled_only: bool = False) -> pd.DataFrame:
        """
        Extract recommendation training data with labels
        
        Args:
            min_date: Filter impressions after this date
            max_date: Filter impressions before this date  
            sources: Filter by source types ['clip', 'text', 'both', 'outfit']
            labeled_only: Only include impressions that have labels
            
        Returns:
            DataFrame with features and labels
        """
        if not self.conn:
            self.connect()
        
        # Build WHERE clauses
        where_clauses = []
        params = {}
        
        if min_date:
            where_clauses.append("ri.created_at >= %(min_date)s")
            params['min_date'] = min_date
        
        if max_date:
            where_clauses.append("ri.created_at <= %(max_date)s")
            params['max_date'] = max_date
            
        if sources:
            where_clauses.append("ri.source = ANY(%(sources)s)")
            params['sources'] = sources
            
        if labeled_only:
            where_clauses.append("rl.label IS NOT NULL")
        
        where_clause = ""
        if where_clauses:
            where_clause = "WHERE " + " AND ".join(where_clauses)
        
        # SQL query using the view for convenience
        query = f"""
        SELECT 
            -- Identifiers
            ri.id as impression_id,
            ri.request_id,
            ri.base_product_id,
            ri.candidate_product_id,
            
            -- Core features for ML
            ri.candidate_score,
            ri.clip_sim,
            ri.text_sim,
            ri.opensearch_score,
            ri.p_hash_dist,
            ri.style_score,
            ri.color_score,
            ri.final_match_score,
            ri.price_ratio,
            ri.position,
            
            -- Categorical features
            ri.category_pair,
            ri.same_brand::INTEGER as same_brand,
            ri.same_vendor::INTEGER as same_vendor,
            ri.source,
            ri.context,
            
            -- Base product features
            bp.price_cents as base_price_cents,
            bp.brand as base_brand,
            bp.category as base_category,
            
            -- Candidate product features  
            cp.price_cents as candidate_price_cents,
            cp.brand as candidate_brand,
            cp.category as candidate_category,
            
            -- Labels (may be NULL)
            rl.label,
            rl.label_score,
            
            -- Timestamps
            ri.created_at as impression_created_at,
            rl.created_at as labeled_at
            
        FROM recommendation_impressions ri
        LEFT JOIN recommendation_labels rl ON rl.impression_id = ri.id
        JOIN products bp ON bp.id = ri.base_product_id
        JOIN products cp ON cp.id = ri.candidate_product_id
        {where_clause}
        ORDER BY ri.created_at DESC, ri.request_id, ri.position
        """
        
        logger.info(f"Executing query with params: {params}")
        
        try:
            df = pd.read_sql_query(query, self.conn, params=params)
            logger.info(f"Extracted {len(df)} rows from database")
            return df
        except Exception as e:
            logger.error(f"Failed to extract data: {e}")
            raise
    
    def create_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Create additional engineered features
        
        Args:
            df: Raw dataframe from database
            
        Returns:
            DataFrame with additional features
        """
        logger.info("Engineering additional features...")
        
        # Copy to avoid modifying original
        df = df.copy()
        
        # Price features
        df['price_diff_cents'] = df['candidate_price_cents'] - df['base_price_cents']
        df['log_price_ratio'] = np.log1p(df['price_ratio'])  # log(1 + price_ratio)
        df['is_cheaper'] = (df['candidate_price_cents'] < df['base_price_cents']).astype(int)
        df['is_more_expensive'] = (df['candidate_price_cents'] > df['base_price_cents']).astype(int)
        
        # Category features
        df['is_same_category'] = (df['base_category'] == df['candidate_category']).astype(int)
        
        # Fill missing values
        numeric_cols = [
            'candidate_score', 'clip_sim', 'text_sim', 'opensearch_score',
            'style_score', 'color_score', 'final_match_score', 'price_ratio',
            'p_hash_dist'
        ]
        
        for col in numeric_cols:
            if col in df.columns:
                # Fill with median for that column
                median_val = df[col].median()
                df[col] = df[col].fillna(median_val)
        
        # Position features
        df['is_top_3'] = (df['position'] <= 3).astype(int)
        df['is_top_5'] = (df['position'] <= 5).astype(int)
        
        logger.info(f"Added engineered features. Final shape: {df.shape}")
        return df
    
    def map_labels(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Map text labels to numeric values and handle missing labels
        
        Args:
            df: DataFrame with 'label' column
            
        Returns:
            DataFrame with numeric 'label_numeric' column
        """
        logger.info("Mapping labels to numeric values...")
        
        df = df.copy()
        
        # Map labels: good=2, ok=1, bad=0
        label_map = {'good': 2, 'ok': 1, 'bad': 0}
        df['label_numeric'] = df['label'].map(label_map)
        
        # Count labels
        label_counts = df['label'].value_counts(dropna=False)
        logger.info(f"Label distribution:")
        for label, count in label_counts.items():
            logger.info(f"  {label}: {count}")
        
        # Count missing labels
        missing_labels = df['label_numeric'].isna().sum()
        if missing_labels > 0:
            logger.warning(f"Found {missing_labels} rows without labels")
        
        return df
    
    def export_dataset(self, df: pd.DataFrame, output_path: str, format: str = 'csv'):
        """
        Export dataset to file
        
        Args:
            df: DataFrame to export
            output_path: Output file path
            format: Export format ('csv' or 'parquet')
        """
        logger.info(f"Exporting {len(df)} rows to {output_path} in {format} format...")
        
        # Create output directory if needed
        output_dir = Path(output_path).parent
        output_dir.mkdir(parents=True, exist_ok=True)
        
        try:
            if format.lower() == 'csv':
                df.to_csv(output_path, index=False)
            elif format.lower() == 'parquet':
                df.to_parquet(output_path, index=False)
            else:
                raise ValueError(f"Unsupported format: {format}")
            
            logger.info(f"✓ Dataset exported successfully to {output_path}")
            
            # Print summary stats
            logger.info("Dataset summary:")
            logger.info(f"  Total rows: {len(df)}")
            logger.info(f"  Total columns: {len(df.columns)}")
            
            if 'label_numeric' in df.columns:
                labeled_rows = df['label_numeric'].notna().sum()
                logger.info(f"  Labeled rows: {labeled_rows} ({labeled_rows/len(df)*100:.1f}%)")
                
                if labeled_rows > 0:
                    label_dist = df['label_numeric'].value_counts().sort_index()
                    logger.info(f"  Label distribution: {dict(label_dist)}")
            
        except Exception as e:
            logger.error(f"Failed to export dataset: {e}")
            raise
    
    def get_feature_columns(self) -> list:
        """Get list of feature columns for ML training"""
        return [
            # Core similarity scores
            'candidate_score', 'clip_sim', 'text_sim', 'opensearch_score',
            'style_score', 'color_score', 'final_match_score',
            
            # Price features
            'price_ratio', 'log_price_ratio', 'price_diff_cents', 
            'is_cheaper', 'is_more_expensive',
            
            # Categorical features (you'll need to encode these)
            'same_brand', 'same_vendor', 'is_same_category',
            
            # Position features
            'position', 'is_top_3', 'is_top_5',
            
            # Hash distance (if available)
            'p_hash_dist'
        ]


def main():
    parser = argparse.ArgumentParser(description='Build recommendation training dataset')
    parser.add_argument('--output', type=str, required=True, 
                       help='Output file path (CSV or Parquet)')
    parser.add_argument('--format', type=str, choices=['csv', 'parquet'], 
                       default='csv', help='Output format')
    parser.add_argument('--days-back', type=int, default=30,
                       help='Number of days to look back for data')
    parser.add_argument('--sources', type=str, nargs='+',
                       choices=['clip', 'text', 'both', 'outfit'],
                       help='Filter by recommendation sources')
    parser.add_argument('--labeled-only', action='store_true',
                       help='Only export labeled data')
    parser.add_argument('--min-labels', type=int, default=0,
                       help='Minimum number of labels required to export')
    
    args = parser.parse_args()
    
    # Calculate date range
    max_date = datetime.now()
    min_date = max_date - timedelta(days=args.days_back)
    
    logger.info(f"Building recommendation dataset...")
    logger.info(f"Date range: {min_date.date()} to {max_date.date()}")
    logger.info(f"Sources: {args.sources or 'all'}")
    logger.info(f"Labeled only: {args.labeled_only}")
    
    try:
        # Initialize builder
        builder = RecommendationDatasetBuilder()
        
        # Extract data
        df = builder.extract_training_data(
            min_date=min_date,
            max_date=max_date,
            sources=args.sources,
            labeled_only=args.labeled_only
        )
        
        if len(df) == 0:
            logger.warning("No data found matching the criteria")
            return
        
        # Create features
        df = builder.create_features(df)
        
        # Map labels
        df = builder.map_labels(df)
        
        # Check minimum labels requirement
        if args.min_labels > 0:
            labeled_count = df['label_numeric'].notna().sum()
            if labeled_count < args.min_labels:
                logger.error(f"Only {labeled_count} labeled samples found, "
                           f"but {args.min_labels} required")
                return
        
        # Export
        builder.export_dataset(df, args.output, args.format)
        
        # Print feature columns for reference
        feature_cols = builder.get_feature_columns()
        logger.info(f"Suggested feature columns for ML ({len(feature_cols)}):")
        for col in feature_cols:
            logger.info(f"  - {col}")
        
        logger.info("✓ Dataset build completed successfully!")
        
    except Exception as e:
        logger.error(f"Failed to build dataset: {e}")
        sys.exit(1)
    
    finally:
        if 'builder' in locals():
            builder.disconnect()


if __name__ == '__main__':
    main()