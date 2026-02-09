"""
Create sample recommendation training data for testing
"""
import pandas as pd
import numpy as np
from pathlib import Path

def create_sample_data(n_samples: int = 1000, output_path: str = "data/reco_training.csv"):
    """Create synthetic recommendation training data"""
    np.random.seed(42)
    
    # Create synthetic features similar to what would come from the DB
    data = {
        # Core similarity scores
        'candidate_score': np.random.uniform(0.1, 0.9, n_samples),
        'clip_sim': np.random.uniform(0.3, 0.95, n_samples),
        'text_sim': np.random.uniform(0.2, 0.85, n_samples),
        'opensearch_score': np.random.uniform(10, 100, n_samples),
        'style_score': np.random.uniform(0.4, 0.9, n_samples),
        'color_score': np.random.uniform(0.3, 0.8, n_samples),
        'final_match_score': np.random.uniform(0.2, 0.9, n_samples),
        
        # Price features
        'price_ratio': np.random.uniform(0.5, 2.0, n_samples),
        'price_diff_cents': np.random.randint(-5000, 5000, n_samples),
        'log_price_ratio': np.random.uniform(-0.5, 0.7, n_samples),
        
        # Binary features
        'same_brand': np.random.choice([0, 1], n_samples, p=[0.8, 0.2]),
        'same_vendor': np.random.choice([0, 1], n_samples, p=[0.7, 0.3]),
        'is_same_category': np.random.choice([0, 1], n_samples, p=[0.6, 0.4]),
        'is_cheaper': np.random.choice([0, 1], n_samples, p=[0.5, 0.5]),
        'is_more_expensive': np.random.choice([0, 1], n_samples, p=[0.5, 0.5]),
        
        # Position features
        'position': np.random.randint(1, 21, n_samples),
        'is_top_3': np.random.choice([0, 1], n_samples, p=[0.7, 0.3]),
        'is_top_5': np.random.choice([0, 1], n_samples, p=[0.6, 0.4]),
        
        # Category pairs (simplified)
        'category_pair': np.random.choice([
            'dress->dress', 'dress->skirt', 'shirt->shirt', 'shirt->top',
            'jacket->jacket', 'jacket->coat', 'pants->pants', 'pants->jeans',
            'shoes->shoes', 'bag->bag'
        ], n_samples),
        
        # Hash distance (optional)
        'p_hash_dist': np.random.randint(0, 65, n_samples),
    }
    
    # Create realistic labels based on feature combinations
    # Higher scores should generally lead to better labels
    score_sum = (data['clip_sim'] + data['style_score'] + data['color_score']) / 3
    same_category_bonus = data['is_same_category'] * 0.1
    price_penalty = np.abs(data['price_ratio'] - 1.0) * 0.2
    
    final_score = score_sum + same_category_bonus - price_penalty
    
    # Map to labels with some noise
    noise = np.random.normal(0, 0.1, n_samples)
    adjusted_score = final_score + noise
    
    labels = []
    for score in adjusted_score:
        if score > 0.7:
            labels.append('good')
        elif score > 0.4:
            labels.append('ok') 
        else:
            labels.append('bad')
    
    data['label'] = labels
    
    # Add numeric labels
    label_map = {'good': 2, 'ok': 1, 'bad': 0}
    data['label_numeric'] = [label_map[l] for l in labels]
    
    # Create DataFrame
    df = pd.DataFrame(data)
    
    # Ensure output directory exists
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    
    # Save to CSV
    df.to_csv(output_path, index=False)
    
    print(f"✓ Created sample training data: {output_path}")
    print(f"  - Samples: {len(df)}")
    print(f"  - Features: {len([c for c in df.columns if c not in ['label', 'label_numeric']])}")
    print(f"  - Label distribution: {df['label'].value_counts().to_dict()}")
    
    return df

if __name__ == '__main__':
    create_sample_data()