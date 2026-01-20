# Fashion Attribute Extraction Model

Multi-head ResNet50 model for extracting fashion attributes from cropped garment images.

## Features

- **Multi-label classification** for comprehensive attribute extraction
- **6 prediction heads**: category, color, pattern, material, season, occasion
- **Production-ready**: ONNX export, mixed precision training, gradient clipping
- **Robust training**: Early stopping, learning rate scheduling, uncertainty weighting

## Setup

```bash
cd src/lib/model
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements_model.txt
```

## Data Preparation

### 1. Crop DeepFashion2 Images

```bash
python scripts/make_crops_deepfashion2.py \
    --ds_root /path/to/deepfashion2 \
    --split train \
    --out_root data/df2

python scripts/make_crops_deepfashion2.py \
    --ds_root /path/to/deepfashion2 \
    --split validation \
    --out_root data/df2
```

### 2. CSV Format

The training script expects CSV files with these columns:

```csv
path,category_id,color_ids,pattern_id,material_id,season_ids,occasion_ids
data/df2/train/crops/img_001.jpg,1,0,0,0,4,0
data/df2/train/crops/img_002.jpg,3,"1,5",2,1,"1,2","0,3"
```

- `path`: Full path to cropped image
- `category_id`: 1-13 (DeepFashion2 categories)
- `color_ids`: Comma-separated color IDs (multi-label)
- `pattern_id`: Single pattern ID
- `material_id`: Single material ID
- `season_ids`: Comma-separated season IDs
- `occasion_ids`: Comma-separated occasion IDs

**Note:** You'll need to annotate colors, patterns, materials, seasons, and occasions manually or use a separate annotation tool.

## Training

### Basic Training

```bash
python train_improved.py
```

### Custom Configuration

Edit `config.py` or override in code:

```python
from config import TrainingConfig

config = TrainingConfig()
config.model_name = "efficientnet_b0"  # or "convnext_tiny"
config.batch_size = 32
config.num_epochs = 100
config.learning_rate = 2e-4
```

### Monitor Training

Training logs show:
- Multi-task losses (weighted)
- Per-attribute accuracies
- Learning rate
- Gradient norms
- Best model checkpoints

## Inference

### Test Single Image

```bash
python inference.py \
    --checkpoint models/attribute_extractor/best_model.pth \
    --mode test \
    --image data/test_images/dress_001.jpg
```

Output:
```json
{
  "category": {
    "name": "long_sleeve_dress",
    "confidence": 0.95
  },
  "colors": [
    {"name": "black", "confidence": 0.89},
    {"name": "white", "confidence": 0.65}
  ],
  "pattern": {
    "name": "floral",
    "confidence": 0.82
  },
  "material": {
    "name": "silk",
    "confidence": 0.76
  },
  "seasons": [
    {"name": "spring", "confidence": 0.88},
    {"name": "summer", "confidence": 0.71}
  ],
  "occasions": [
    {"name": "date", "confidence": 0.92},
    {"name": "party", "confidence": 0.68}
  ]
}
```

### Export to ONNX

```bash
python inference.py \
    --checkpoint models/attribute_extractor/best_model.pth \
    --mode export \
    --output models/attribute_extractor/model.onnx
```

## Integration with Backend

```typescript
// src/lib/attributeExtractor.ts
import { spawn } from 'child_process';

export async function extractAttributes(imagePath: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const process = spawn('python', [
      'src/lib/model/inference.py',
      '--checkpoint', 'models/attribute_extractor/best_model.pth',
      '--mode', 'test',
      '--image', imagePath
    ]);
    
    let output = '';
    process.stdout.on('data', (data) => output += data);
    process.on('close', (code) => {
      if (code === 0) {
        const results = JSON.parse(output);
        resolve(results);
      } else {
        reject(new Error('Extraction failed'));
      }
    });
  });
}
```

Or use ONNX Runtime (faster):

```typescript
import * as ort from 'onnxruntime-node';

const session = await ort.InferenceSession.create(
  'models/attribute_extractor/model.onnx'
);
// ... preprocess image to tensor ...
const results = await session.run({ image: imageTensor });
```

## Model Architecture

```
Input (224x224x3)
    ↓
ResNet50 Backbone (pretrained ImageNet)
    ↓
Global Average Pooling → Features (2048-d)
    ↓
Dropout (0.3)
    ↓
┌─────────┬─────────┬─────────┬──────────┬─────────┬──────────┐
│Category │ Colors  │ Pattern │ Material │ Seasons │ Occasions│
│ (13)    │ (12)    │  (8)    │  (10)    │  (5)    │   (8)    │
│ Softmax │ Sigmoid │ Softmax │ Softmax  │ Sigmoid │ Sigmoid  │
└─────────┴─────────┴─────────┴──────────┴─────────┴──────────┘
```

## Key Improvements Over Original Script

| Issue | Solution |
|-------|----------|
| ❌ Indentation bug | ✅ Fixed |
| ❌ Missing `__len__()` | ✅ Added |
| ❌ Single-label only | ✅ Multi-label support |
| ❌ No metrics | ✅ Per-attribute accuracy |
| ❌ No LR scheduler | ✅ Cosine annealing |
| ❌ No gradient clipping | ✅ Clipping at 1.0 |
| ❌ Hard-coded config | ✅ Config class |
| ❌ No ONNX export | ✅ Export + metadata |
| ❌ CSV format bug | ✅ Fixed cropping script |

## Tips for Best Performance

1. **Data Quality**: Ensure clean crops (background removed, tight bounding boxes)
2. **Class Balance**: Use weighted sampling if categories are imbalanced
3. **Augmentation**: Increase if training set is small (<10k images)
4. **Model Selection**: 
   - ResNet50: Balanced speed/accuracy
   - EfficientNet-B0: Faster, slightly lower accuracy
   - ConvNeXt-Tiny: Best accuracy, slower
5. **Fine-tuning**: Start with `lr=1e-4`, reduce to `1e-5` after 20 epochs
6. **Multi-GPU**: Use `torch.nn.DataParallel` for batch_size > 128

## Citation

If using DeepFashion2:
```
@inproceedings{DeepFashion2,
  author = {Yuying Ge and Ruimao Zhang and Xiaogang Wang and Ping Luo},
  title = {DeepFashion2: A Versatile Benchmark for Detection, Pose Estimation, Segmentation and Re-Identification of Clothing Images},
  booktitle = {CVPR},
  year = {2019}
}
```
