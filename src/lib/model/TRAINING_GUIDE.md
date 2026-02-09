# 🎓 Model Training Guide

## ✅ Prerequisites Check

Your setup is ready! Here's what you have:

- ✅ Python 3.11 virtual environment at `src/lib/model/.venv311`
- ✅ PyTorch 2.9.1 + torchvision installed
- ✅ Training data: `data/df2/train_crops.csv` and `data/df2/validation_crops.csv`
- ✅ Training script: `train_improved.py`
- ✅ Configuration: `config.py`

---

## 🚀 Quick Start Training

### Option 1: Basic Training (Default Settings)

```powershell
# Activate virtual environment
& C:\Users\USER\Desktop\marketplace\src\lib\model\.venv311\Scripts\Activate.ps1

# Navigate to model directory
cd C:\Users\USER\Desktop\marketplace\src\lib\model

# Start training
python train_improved.py
```

### Option 2: Custom Training with Modified Config

Edit `config.py` first to customize:

```python
@dataclass
class TrainingConfig:
    # Use smaller model for faster training
    model_name: str = "mobilenetv3_small_100"  # or "efficientnet_b0"
    
    # Adjust batch size based on GPU memory
    batch_size: int = 32  # Reduce to 16 if out of memory
    
    # Training duration
    num_epochs: int = 50  # Start with 20 for quick test
    
    # Learning rate
    learning_rate: float = 1e-4
    
    # Device (auto-detected: cuda if GPU, else cpu)
    device: str = "cuda"
```

Then run:
```powershell
python train_improved.py
```

---

## 📊 What The Model Trains

Your model learns **6 fashion attributes**:

1. **Category** (13 classes): short_sleeve_top, long_sleeve_top, shorts, dress, etc.
2. **Color** (12 classes, multi-label): black, white, red, blue, green, etc.
3. **Pattern** (8 classes): solid, striped, floral, polka_dot, etc.
4. **Material** (10 classes): cotton, silk, denim, leather, etc.
5. **Season** (5 classes, multi-label): spring, summer, fall, winter, all-season
6. **Occasion** (8 classes, multi-label): casual, formal, party, sports, etc.

---

## 💻 Training Commands

### Basic Training
```powershell
# Activate environment
& C:\Users\USER\Desktop\marketplace\src\lib\model\.venv311\Scripts\Activate.ps1

# Train with default settings
python train_improved.py
```

### Training with GPU Check
```powershell
# Check if CUDA is available
python -c "import torch; print(f'CUDA available: {torch.cuda.is_available()}'); print(f'GPU: {torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'None'}')"

# Train
python train_improved.py
```

### Resume Training from Checkpoint
```powershell
# If training was interrupted, it will auto-resume from last checkpoint
python train_improved.py
```

---

## 📈 Monitor Training Progress

During training, you'll see output like:

```
Epoch 1/50 [====================] 100%
├─ Loss: 2.345
├─ Category Acc: 0.72
├─ Color Acc: 0.65
├─ Pattern Acc: 0.58
├─ Material Acc: 0.51
├─ Season Acc: 0.69
├─ Occasion Acc: 0.63
├─ LR: 0.0001
└─ Best Val Loss: 2.120 (epoch 1)

Validation [====================] 100%
├─ Val Loss: 2.120
├─ Category Acc: 0.75
├─ Color Acc: 0.68
└─ Saved best_model.pth ✓
```

---

## 📁 Output Files

Training creates these files in `models/attribute_extractor/`:

```
models/attribute_extractor/
├── best_model.pth          # Best model weights (lowest val loss)
├── last_model.pth          # Most recent checkpoint
├── config.json             # Training configuration
├── training_log.csv        # Epoch-by-epoch metrics
└── model.onnx              # Exported ONNX model (after training)
```

---

## ⚙️ Configuration Options

Edit `config.py` to customize training:

### Model Architecture
```python
model_name: str = "mobilenetv3_small_100"  # Fast, CPU-friendly
# Alternatives:
# "efficientnet_b0"   # Balanced speed/accuracy
# "resnet50"          # More accurate, slower
# "convnext_tiny"     # State-of-the-art, needs GPU
```

### Training Hyperparameters
```python
batch_size: int = 32           # 16 for 4GB GPU, 32 for 8GB GPU
num_epochs: int = 50           # 20 for quick test, 100 for best results
learning_rate: float = 1e-4    # 1e-3 for faster convergence, 1e-5 for fine-tuning
```

### Data Augmentation
```python
img_size: int = 224            # Input image size (224 or 299)
crop_scale_min: float = 0.7    # Minimum crop scale
color_jitter: float = 0.2      # Color augmentation strength
```

### Early Stopping
```python
patience: int = 10             # Stop if no improvement for N epochs
min_delta: float = 0.001       # Minimum improvement threshold
```

---

## 🧪 Test Training Before Full Run

### Quick Smoke Test (2 epochs)
```powershell
# Temporarily edit config.py:
# num_epochs: int = 2

python train_improved.py
```

### Check Data Loading
```python
# Add to train_improved.py before training loop:
print(f"Training samples: {len(train_dataset)}")
print(f"Validation samples: {len(val_dataset)}")

# Load one batch
batch = next(iter(train_loader))
print(f"Batch shape: {batch[0].shape}")
print(f"Labels: {batch[1].keys()}")
```

---

## 🐛 Troubleshooting

### Issue: Out of Memory (CUDA)
**Solution**: Reduce batch size in `config.py`
```python
batch_size: int = 16  # or even 8
```

### Issue: Training is slow
**Solutions**:
1. Use smaller model: `model_name = "mobilenetv3_small_100"`
2. Reduce image size: `img_size = 192`
3. Reduce workers: `num_workers = 2`

### Issue: Loss not decreasing
**Solutions**:
1. Increase learning rate: `learning_rate = 1e-3`
2. Reduce regularization: `weight_decay = 1e-5`
3. Check data labels are correct

### Issue: Training crashes
**Check**:
1. CSV file paths are correct
2. All images exist and are readable
3. Sufficient disk space for checkpoints
4. CUDA drivers if using GPU

---

## 📤 After Training: Export to ONNX

### Export Best Model
```powershell
# Using the inference script
python inference.py `
  --checkpoint models/attribute_extractor/best_model.pth `
  --mode export `
  --output models/attribute_extractor/model.onnx
```

### Test ONNX Model
```powershell
python inference.py `
  --checkpoint models/attribute_extractor/model.onnx `
  --mode test `
  --image data/test_image.jpg
```

---

## 🔗 Integration with Backend

After training and exporting to ONNX, update your backend:

```typescript
// Use the trained model in your API
import { loadONNXModel } from './lib/model/onnx_inference';

const model = await loadONNXModel('models/attribute_extractor/model.onnx');
const attributes = await model.predict(imageBuffer);
```

---

## 📊 Expected Training Time

| Model | Hardware | Epochs | Time |
|-------|----------|--------|------|
| MobileNetV3 Small | CPU | 50 | ~4-6 hours |
| MobileNetV3 Small | GPU (RTX 3060) | 50 | ~30-45 min |
| EfficientNet-B0 | CPU | 50 | ~8-12 hours |
| EfficientNet-B0 | GPU (RTX 3060) | 50 | ~1-2 hours |
| ResNet50 | GPU (RTX 3060) | 50 | ~2-3 hours |

---

## 🎯 Training Best Practices

1. **Start Small**: Train for 10 epochs first to verify everything works
2. **Monitor Validation**: Watch for overfitting (train acc >> val acc)
3. **Save Checkpoints**: Don't delete `best_model.pth` until training is complete
4. **Log Everything**: Keep `training_log.csv` for analysis
5. **Test Immediately**: Test the model on real images after training

---

## 📝 Training Checklist

Before training:
- [ ] Activate virtual environment
- [ ] Check training data exists (`data/df2/train_crops.csv`)
- [ ] Check validation data exists (`data/df2/validation_crops.csv`)
- [ ] Verify disk space (need ~2-5 GB for checkpoints)
- [ ] Set appropriate batch_size for your GPU

During training:
- [ ] Monitor loss is decreasing
- [ ] Check validation accuracy is improving
- [ ] Ensure no out-of-memory errors
- [ ] Verify checkpoints are being saved

After training:
- [ ] Export to ONNX
- [ ] Test on sample images
- [ ] Integrate with backend
- [ ] Document model performance

---

## 🚀 Ready to Train?

Run these commands:

```powershell
# 1. Activate environment
& C:\Users\USER\Desktop\marketplace\src\lib\model\.venv311\Scripts\Activate.ps1

# 2. Navigate to model directory
cd C:\Users\USER\Desktop\marketplace\src\lib\model

# 3. Check GPU availability
python -c "import torch; print('CUDA:', torch.cuda.is_available())"

# 4. Start training!
python train_improved.py
```

---

## 📞 Need Help?

Check:
- `README.md` - Model documentation
- `config.py` - All configuration options
- `train_improved.py` - Training script source
- `inference.py` - Model inference and export

Good luck with training! 🎉
