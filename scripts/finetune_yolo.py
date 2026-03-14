"""
Fine-tune YOLOv8 Fashion Detection Model

This script fine-tunes the kesimeg/yolov8n-clothing-detection model
(from HuggingFace via ultralyticsplus) on your custom fashion dataset.

Requires:  pip install ultralyticsplus ultralytics

Usage:
    python scripts/finetune_yolo.py --data data/fashion_dataset.yaml --epochs 50
"""

import argparse
import os
import sys
from pathlib import Path

# Try ultralyticsplus first (needed for HuggingFace model hub),
# fall back to plain ultralytics for local .pt files.
try:
    from ultralyticsplus import YOLO
    HAS_ULTRALYTICSPLUS = True
except ImportError:
    from ultralytics import YOLO
    HAS_ULTRALYTICSPLUS = False

import yaml

def check_gpu():
    """Check if GPU is available and warn if not"""
    try:
        import torch
        if torch.cuda.is_available():
            gpu_name = torch.cuda.get_device_name(0)
            gpu_count = torch.cuda.device_count()
            print(f"✅ GPU Available: {gpu_name}")
            print(f"   GPU Count: {gpu_count}")
            print(f"   CUDA Version: {torch.version.cuda}")
            return True
        else:
            print("❌ No GPU detected!")
            print("   Training on CPU will be extremely slow (days/weeks).")
            print("\n💡 Solutions:")
            print("   1. Install CUDA-enabled PyTorch:")
            print("      pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118")
            print("   2. Use cloud GPU (Google Colab, Kaggle, AWS, etc.)")
            print("   3. Rent GPU from vast.ai or runpod.io")
            return False
    except ImportError:
        print("⚠️  PyTorch not found, cannot check GPU")
        return False


def setup_training_dir():
    """Create training directory structure"""
    dirs = [
        "runs/detect",
        "data/fashion_train/images/train",
        "data/fashion_train/images/val",
        "data/fashion_train/labels/train",
        "data/fashion_train/labels/val",
    ]
    for dir_path in dirs:
        Path(dir_path).mkdir(parents=True, exist_ok=True)
    print("✅ Training directories created")


def create_dataset_yaml(
    train_images: str,
    val_images: str,
    classes: list,
    output_path: str = "data/fashion_dataset.yaml"
):
    """
    Create dataset YAML file for YOLOv8 training

    Args:
        train_images: Path to training images
        val_images: Path to validation images
        classes: List of class names
        output_path: Where to save the YAML file
    """
    dataset_config = {
        'path': os.path.abspath('data/fashion_train'),
        'train': train_images,
        'val': val_images,
        'nc': len(classes),
        'names': {i: name for i, name in enumerate(classes)}
    }

    with open(output_path, 'w') as f:
        yaml.dump(dataset_config, f, sort_keys=False)

    print(f"✅ Dataset YAML created: {output_path}")
    return output_path


def fine_tune_model(
    base_model: str,
    data_yaml: str,
    epochs: int = 50,
    imgsz: int = 640,
    batch: int = 16,
    device: str = '0',
    project: str = 'runs/detect',
    name: str = 'fashion_finetuned',
    pretrained: bool = True,
    optimizer: str = 'auto',
    lr0: float = 0.001,
    patience: int = 50,
    save_period: int = 10,
):
    """
    Fine-tune YOLOv8 model on custom dataset

    Args:
        base_model: Base model to start from (HF model ID or local path)
        data_yaml: Path to dataset YAML file
        epochs: Number of training epochs
        imgsz: Image size for training
        batch: Batch size
        device: Device to use ('cuda' for GPU - REQUIRED, 'cpu' not recommended)
        project: Project directory for saving results
        name: Name of the training run
        pretrained: Use pretrained weights
        optimizer: Optimizer ('auto', 'SGD', 'Adam', 'AdamW', 'RMSProp')
        lr0: Initial learning rate
        patience: Early stopping patience
        save_period: Save checkpoint every N epochs
    """
    print("\n" + "="*60)
    print("YOLOv8 Fashion Detection Fine-Tuning")
    print("="*60)

    # Load base model
    print(f"\n[1/4] Loading base model: {base_model}")
    is_hf_model = '/' in base_model and not os.path.exists(base_model)
    if is_hf_model and not HAS_ULTRALYTICSPLUS:
        print("❌ HuggingFace model requires 'ultralyticsplus'. Install it:")
        print("   pip install ultralyticsplus")
        print("   Or use a local .pt file instead: --base-model yolov8n.pt")
        return None
    try:
        model = YOLO(base_model)
        print(f"✅ Model loaded successfully!")
        print(f"  Task: {model.task}")
        print(f"  Classes: {len(model.names)}")
    except Exception as e:
        print(f"❌ Failed to load model: {e}")
        if is_hf_model:
            print("   Tip: Make sure you have internet access and 'ultralyticsplus' installed.")
            print("   Or use a local fallback: --base-model yolov8n.pt")
        return None

    # Verify dataset
    print(f"\n[2/4] Verifying dataset: {data_yaml}")
    if not os.path.exists(data_yaml):
        print(f"❌ Dataset YAML not found: {data_yaml}")
        print("   Create it with create_dataset_yaml() first!")
        return None

    with open(data_yaml, 'r') as f:
        dataset_config = yaml.safe_load(f)
    print(f"✅ Dataset verified")
    print(f"  Classes: {dataset_config['nc']}")
    print(f"  Names: {list(dataset_config['names'].values())}")

    # Training configuration
    print(f"\n[3/4] Training Configuration:")
    print(f"  Epochs: {epochs}")
    print(f"  Image size: {imgsz}")
    print(f"  Batch size: {batch}")
    print(f"  Device: {device}")
    print(f"  Optimizer: {optimizer}")
    print(f"  Learning rate: {lr0}")
    print(f"  Patience: {patience}")

    # Start training
    print(f"\n[4/4] Starting training...")
    print("="*60)

    try:
        results = model.train(
            data=data_yaml,
            epochs=epochs,
            imgsz=imgsz,
            batch=batch,
            device=device,
            project=project,
            name=name,
            pretrained=pretrained,
            optimizer=optimizer,
            lr0=lr0,
            patience=patience,
            save_period=save_period,
            verbose=True,
            plots=True,
            # Additional hyperparameters
            cos_lr=True,  # Cosine learning rate scheduler
            close_mosaic=10,  # Disable mosaic augmentation for final epochs
            amp=True,  # Automatic Mixed Precision
        )

        print("\n" + "="*60)
        print("✅ Training Complete!")
        print("="*60)

        # Print results
        best_model_path = Path(project) / name / 'weights' / 'best.pt'
        last_model_path = Path(project) / name / 'weights' / 'last.pt'

        print(f"\nModel Checkpoints:")
        print(f"  Best: {best_model_path}")
        print(f"  Last: {last_model_path}")

        print(f"\nTraining Metrics:")
        if hasattr(results, 'results_dict'):
            metrics = results.results_dict
            print(f"  mAP50: {metrics.get('metrics/mAP50(B)', 'N/A')}")
            print(f"  mAP50-95: {metrics.get('metrics/mAP50-95(B)', 'N/A')}")

        print(f"\nResults Directory: {Path(project) / name}")
        print(f"  - results.csv: Training metrics")
        print(f"  - results.png: Training curves")
        print(f"  - confusion_matrix.png: Confusion matrix")
        print(f"  - val_batch*.jpg: Validation predictions")

        return str(best_model_path)

    except Exception as e:
        print(f"\n❌ Training failed: {e}")
        import traceback
        traceback.print_exc()
        return None


def validate_model(model_path: str, data_yaml: str, imgsz: int = 640):
    """
    Validate trained model on validation set

    Args:
        model_path: Path to trained model
        data_yaml: Dataset YAML file
        imgsz: Image size for validation
    """
    print("\n" + "="*60)
    print("Model Validation")
    print("="*60)

    print(f"\nLoading model: {model_path}")
    model = YOLO(model_path)

    print(f"Running validation on: {data_yaml}")
    results = model.val(data=data_yaml, imgsz=imgsz, plots=True)

    print("\n✅ Validation Complete!")
    print(f"  mAP50: {results.box.map50:.4f}")
    print(f"  mAP50-95: {results.box.map:.4f}")
    print(f"  Precision: {results.box.mp:.4f}")
    print(f"  Recall: {results.box.mr:.4f}")

    return results


def export_model(
    model_path: str,
    format: str = 'onnx',
    imgsz: int = 640,
    half: bool = False,
    int8: bool = False,
):
    """
    Export model to different formats for deployment

    Args:
        model_path: Path to trained model
        format: Export format ('onnx', 'torchscript', 'tflite', 'engine', etc.)
        imgsz: Image size for export
        half: Use FP16 precision
        int8: Use INT8 quantization
    """
    print("\n" + "="*60)
    print(f"Exporting Model to {format.upper()}")
    print("="*60)

    model = YOLO(model_path)

    print(f"\nExporting {model_path}...")
    export_path = model.export(
        format=format,
        imgsz=imgsz,
        half=half,
        int8=int8,
    )

    print(f"\n✅ Export Complete!")
    print(f"  Exported model: {export_path}")

    return export_path


def main():
    parser = argparse.ArgumentParser(description='Fine-tune YOLOv8 Fashion Detection')

    # Model and data
    parser.add_argument('--base-model', type=str,
                       default='kesimeg/yolov8n-clothing-detection',
                       help='Base model (HuggingFace ID like kesimeg/yolov8n-clothing-detection, or local .pt path)')
    parser.add_argument('--data', type=str,
                       default='data/fashion_dataset.yaml',
                       help='Dataset YAML file')

    # Training parameters
    parser.add_argument('--epochs', type=int, default=50,
                       help='Number of training epochs')
    parser.add_argument('--batch', type=int, default=16,
                       help='Batch size')
    parser.add_argument('--imgsz', type=int, default=640,
                       help='Image size')
    parser.add_argument('--device', type=str, default='0',
                       help='Device (0 for GPU, cpu for CPU)')
    parser.add_argument('--lr0', type=float, default=0.001,
                       help='Initial learning rate')
    parser.add_argument('--patience', type=int, default=50,
                       help='Early stopping patience')

    # Output
    parser.add_argument('--project', type=str, default='runs/detect',
                       help='Project directory')
    parser.add_argument('--name', type=str, default='fashion_finetuned',
                       help='Run name')

    # Actions
    parser.add_argument('--setup', action='store_true',
                       help='Setup training directories')
    parser.add_argument('--validate', action='store_true',
                       help='Validate trained model')
    parser.add_argument('--export', type=str, choices=['onnx', 'torchscript', 'tflite'],
                       help='Export model format')
    parser.add_argument('--model-path', type=str,
                       help='Path to trained model (for validate/export)')

    args = parser.parse_args()

    # Setup directories
    if args.setup:
        setup_training_dir()
        return

    # Validate model
    if args.validate:
        if not args.model_path:
            print("❌ --model-path required for validation")
            return
        validate_model(args.model_path, args.data, args.imgsz)
        return

    # Export model
    if args.export:
        if not args.model_path:
            print("❌ --model-path required for export")
            return
        export_model(args.model_path, args.export, args.imgsz)
        return

    # Train model
    best_model = fine_tune_model(
        base_model=args.base_model,
        data_yaml=args.data,
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        device=args.device,
        project=args.project,
        name=args.name,
        lr0=args.lr0,
        patience=args.patience,
    )

    if best_model:
        print(f"\n🎉 Fine-tuning successful!")
        print(f"\nNext steps:")
        print(f"1. Validate: python scripts/finetune_yolo.py --validate --model-path {best_model} --data {args.data}")
        print(f"2. Export: python scripts/finetune_yolo.py --export onnx --model-path {best_model}")
        print(f"3. Use in API: Update YOLO_MODEL_PATH={best_model}")


if __name__ == "__main__":
    main()

