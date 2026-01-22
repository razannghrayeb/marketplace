"""
Configuration for multi-label attribute extraction model
"""
from dataclasses import dataclass, field
from typing import List, Dict
import json
from pathlib import Path
import os

# Get the directory where this config file is located
_BASE_DIR = Path(__file__).parent.resolve()

@dataclass
class TrainingConfig:
    # Paths (relative to this config file's directory)
    data_root: str = str(_BASE_DIR / "data/df2")
    train_csv: str = str(_BASE_DIR / "data/df2/train_crops.csv")
    val_csv: str = str(_BASE_DIR / "data/df2/validation_crops.csv")
    test_csv: str = str(_BASE_DIR / "data/df2/test_crops.csv")
    output_dir: str = str(_BASE_DIR / "models/attribute_extractor")
    
    # Model
    model_name: str = "mobilenetv3_small_100"  # Smaller model for CPU training
    pretrained: bool = True
    dropout: float = 0.3
    
    # Multi-label setup
    num_categories: int = 13
    num_colors: int = 12
    num_patterns: int = 8
    num_materials: int = 10
    num_seasons: int = 5
    num_occasions: int = 8
    
    # Training hyperparameters
    batch_size: int = 32  # Smaller batch for CPU
    num_epochs: int = 50
    learning_rate: float = 1e-4
    weight_decay: float = 1e-4
    warmup_epochs: int = 3
    
    # Augmentation
    img_size: int = 224
    crop_scale_min: float = 0.7
    crop_scale_max: float = 1.0
    color_jitter: float = 0.2
    
    # Optimization
    gradient_clip_val: float = 1.0
    mixed_precision: bool = True
    label_smoothing: float = 0.1
    
    # Early stopping
    patience: int = 10
    min_delta: float = 0.001
    
    # Hardware
    num_workers: int = 4
    device: str = "cuda"  # auto-detected in code
    
    # Logging
    log_interval: int = 50
    save_interval: int = 1  # epochs
    
    def to_dict(self) -> Dict:
        return {k: str(v) if isinstance(v, Path) else v for k, v in self.__dict__.items()}
    
    def save(self, path: str):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with open(path, 'w') as f:
            json.dump(self.to_dict(), f, indent=2)
    
    @classmethod
    def load(cls, path: str):
        with open(path, 'r') as f:
            data = json.load(f)
        return cls(**data)


# DeepFashion2 category mapping (13 categories)
CATEGORY_NAMES = [
    "short_sleeve_top",      # 1
    "long_sleeve_top",       # 2
    "short_sleeve_outwear",  # 3
    "long_sleeve_outwear",   # 4
    "vest",                  # 5
    "sling",                 # 6
    "shorts",                # 7
    "trousers",              # 8
    "skirt",                 # 9
    "short_sleeve_dress",    # 10
    "long_sleeve_dress",     # 11
    "vest_dress",            # 12
    "sling_dress"            # 13
]

# Extended attributes (you'll need to add these to your CSV during cropping)
COLOR_NAMES = [
    "black", "white", "red", "blue", "green", 
    "yellow", "pink", "purple", "brown", "gray", 
    "beige", "multi"
]

PATTERN_NAMES = [
    "solid", "stripes", "floral", "plaid", 
    "polka-dots", "geometric", "animal-print", "other"
]

MATERIAL_NAMES = [
    "cotton", "polyester", "denim", "silk", 
    "wool", "leather", "linen", "knit", "chiffon", "other"
]

SEASON_NAMES = ["spring", "summer", "fall", "winter", "all-season"]

OCCASION_NAMES = [
    "casual", "work", "formal", "sport", 
    "party", "beach", "lounge", "date"
]
