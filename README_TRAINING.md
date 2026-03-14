# 🚀 YOLOv8 Training on DeepFashion2 - Complete Guide

## ✅ Quick Start (3 Steps)

### Step 1: Install GPU PyTorch

**Use the robust installer** (handles timeouts and retries):

```powershell
.\install_gpu_pytorch_robust.bat
```

Or with PowerShell retry logic:
```powershell
.\install_gpu_pytorch_retry.ps1
```

Then install `ultralyticsplus` (needed to load the HuggingFace base model):
```powershell
D:\marketplace\src\lib\model\.venv311\Scripts\python.exe -m pip install ultralyticsplus
```

**Note**: 
- Download is ~2.8GB (5-15 minutes depending on internet speed)
- If download fails, just run the script again - it will retry automatically
- The script cleans up temporary files to avoid lock errors

### Troubleshooting: If Installation Fails

**Error: "The process cannot access the file"**
- Close any Python processes: `taskkill /F /IM python.exe`
- Delete temp folder: `Remove-Item $env:TEMP\pip-* -Recurse -Force`
- Run installer again

**Error: "Connection timed out"**
- Check internet connection
- Run installer again (it has retry logic)
- Or try CUDA 12.1: 
  ```powershell
  D:\marketplace\src\lib\model\.venv311\Scripts\python.exe -m pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cu121
  ```

### Step 2: Verify GPU

```powershell
D:\marketplace\src\lib\model\.venv311\Scripts\python.exe -c "import torch; print('GPU:', torch.cuda.get_device_name(0))"
```

### Step 3: Train!

```powershell
D:\marketplace\src\lib\model\.venv311\Scripts\python.exe scripts/finetune_yolo.py --data data/deepfashion2_yolo.yaml --epochs 10 --batch 4 --device cuda --name test
```

---

## 📊 Dataset Status

- **Location**: `data/fashion_train/`
- **Converted**: ✅ 224,114 images ready (192K train + 32K val)
- **Config**: `data/deepfashion2_yolo.yaml`
- **Categories**: 8 (shirt, tshirt, jacket, tank_top, pants, shorts, skirt, dress)

### Convert Full Dataset (Optional)

```powershell
python scripts/prepare_deepfashion2.py --convert  # ~20-30 min, creates 224K images
```

---

## 🎓 Training Commands

### Quick Test (10 epochs, ~2 hours on full dataset)
```powershell
D:\marketplace\src\lib\model\.venv311\Scripts\python.exe scripts/finetune_yolo.py --data data/deepfashion2_yolo.yaml --epochs 10 --batch 4 --device cuda --name quicktest
```

### Full Training (100 epochs, ~15-20 hours on 224K images, 4GB GPU)
```powershell
D:\marketplace\src\lib\model\.venv311\Scripts\python.exe scripts/finetune_yolo.py --data data/deepfashion2_yolo.yaml --epochs 100 --batch 4 --device cuda --name df2_finetuned
```

### With All Options (for 4GB GPU)
```powershell
D:\marketplace\src\lib\model\.venv311\Scripts\python.exe scripts/finetune_yolo.py `
    --base-model kesimeg/yolov8n-clothing-detection `
    --data data/deepfashion2_yolo.yaml `
    --epochs 100 `
    --batch 4 `
    --imgsz 640 `
    --device cuda `
    --lr0 0.001 `
    --patience 50 `
    --name production_model
```

---

## 📈 After Training

### Validate Model
```powershell
D:\marketplace\src\lib\model\.venv311\Scripts\python.exe scripts/finetune_yolo.py --validate --model-path runs/detect/df2_finetuned/weights/best.pt --data data/deepfashion2_yolo.yaml
```

### Export to ONNX
```powershell
D:\marketplace\src\lib\model\.venv311\Scripts\python.exe scripts/finetune_yolo.py --export onnx --model-path runs/detect/df2_finetuned/weights/best.pt
```

### Deploy Model
```powershell
# Update .env
echo YOLO_MODEL_PATH=runs/detect/df2_finetuned/weights/best.pt >> .env

# Start API
cd src\lib\model
.\.venv311\Scripts\python.exe -m uvicorn yolov8_api:app --host 0.0.0.0 --port 8001
```

---

## 📁 Essential Scripts

- **`scripts/finetune_yolo.py`** - Main training script
- **`scripts/prepare_deepfashion2.py`** - Convert DeepFashion2 dataset
- **`scripts/verify_deepfashion2.py`** - Verify dataset structure
- **`install_gpu_pytorch.bat`** - Install GPU PyTorch (fixes broken pip)

---

## 📊 Training Results

Find in `runs/detect/<name>/`:
- **`weights/best.pt`** - Best model ⭐ (use this!)
- **`results.csv`** - All metrics per epoch
- **`results.png`** - Training curves
- **`confusion_matrix.png`** - Confusion matrix
- **`val_batch*.jpg`** - Validation predictions

---

## 🎯 Expected Results

After fine-tuning on DeepFashion2:

| Dataset | Epochs | mAP50 | Time |
|---------|--------|-------|------|
| 2K images | 10 | 0.60-0.65 | ~10 min |
| 2K images | 100 | 0.65-0.70 | ~1 hour |
| 224K images (full) | 100 | 0.75-0.80 | ~15-20 hours |

**Improvement**: ~2x better than base model (0.40 → 0.75 mAP50)

---

## 💡 Tips

- **Start small**: Test with 10 epochs first (~2 hours)
- **Batch size for 4GB GPU**: Use `--batch 4` or `--batch 2`
  - 8GB GPU: `--batch 8` or `--batch 16`
  - 12GB+ GPU: `--batch 32` or higher
- **Monitor**: Use TensorBoard: `tensorboard --logdir runs/detect`
- **Early stopping**: Script uses `--patience 50` automatically

---

## 🐛 Troubleshooting

### "Fatal error in launcher" (broken pip)
Use `python -m pip` instead of `pip`:
```powershell
D:\marketplace\src\lib\model\.venv311\Scripts\python.exe -m pip install <package>
```

### Out of Memory
**For 4GB GPU**: Use `--batch 4` or `--batch 2`
**For 6-8GB GPU**: Use `--batch 8`
**For 12GB+ GPU**: Use `--batch 16` or higher

### No GPU Detected
Check NVIDIA driver: `nvidia-smi`

### Slow Training
Already using GPU (check with `nvidia-smi`)

---

## 📚 Key Documentation

- **DEEPFASHION2_GUIDE.md** - Complete DeepFashion2 guide
- **FINETUNING_GUIDE.md** - General fine-tuning tips
- **DATASET_READY.md** - Dataset details

---

## 🎉 Summary

1. **Install GPU PyTorch**: `.\install_gpu_pytorch.bat`
2. **Verify GPU**: Check CUDA available
3. **Train**: Run training command with `python.exe` path
4. **Deploy**: Use `best.pt` model in your API

**Everything is ready - just install GPU PyTorch and start training!** 🚀

