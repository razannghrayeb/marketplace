#!/usr/bin/env python3
"""
Quick Start: Fine-tune YOLOv8 Fashion Detection

This script provides an interactive way to fine-tune the model.

Usage:
    python scripts/quickstart_finetune.py
"""

import os
import sys
from pathlib import Path

def print_header(text):
    print("\n" + "="*70)
    print(f"  {text}")
    print("="*70 + "\n")

def main():
    print_header("🎯 YOLOv8 Fashion Detection Fine-Tuning Quick Start")

    print("This wizard will help you fine-tune the model on your data.\n")

    # Check if dataset exists
    dataset_yaml = Path("data/fashion_dataset.yaml")
    dataset_dir = Path("data/fashion_train")

    if not dataset_yaml.exists():
        print("📦 Dataset not found. Let's set it up!\n")

        choice = input("Do you want to:\n"
                      "  1. Create empty dataset structure\n"
                      "  2. Convert from COCO format\n"
                      "  3. Exit and prepare manually\n"
                      "Choice [1-3]: ").strip()

        if choice == "1":
            print("\n✅ Creating dataset structure...")
            os.system("python scripts/prepare_dataset.py --setup")
            print("\n📝 Next steps:")
            print("1. Add your images to data/fashion_train/images/train/ and /val/")
            print("2. Add corresponding labels to data/fashion_train/labels/train/ and /val/")
            print("3. Run: python scripts/prepare_dataset.py --create-yaml")
            print("4. Run this script again!")
            return

        elif choice == "2":
            coco_json = input("\nPath to COCO JSON file: ").strip()
            image_dir = input("Path to images directory: ").strip()

            if not Path(coco_json).exists():
                print(f"❌ File not found: {coco_json}")
                return

            print("\n✅ Converting from COCO format...")
            cmd = f'python scripts/prepare_dataset.py --from-coco "{coco_json}" --image-dir "{image_dir}"'
            os.system(cmd)
            print("\n✅ Conversion complete!")

        else:
            print("\n📘 Manual setup instructions:")
            print("1. Run: python scripts/prepare_dataset.py --setup")
            print("2. Add your images and labels")
            print("3. Run: python scripts/prepare_dataset.py --create-yaml")
            return

    # Check GPU availability
    try:
        import torch
        has_cuda = torch.cuda.is_available()
        if has_cuda:
            gpu_name = torch.cuda.get_device_name(0)
            print(f"✅ GPU detected: {gpu_name}")
            device = "0"
            batch_default = 16
        else:
            print("ℹ️  No GPU detected, will use CPU (slower)")
            device = "cpu"
            batch_default = 8
    except ImportError:
        print("ℹ️  PyTorch not found, assuming CPU")
        device = "cpu"
        batch_default = 8

    # Training configuration
    print_header("⚙️  Training Configuration")

    print("Recommended settings:")
    print(f"  Device: {device}")
    print(f"  Batch size: {batch_default}")
    print(f"  Epochs: 50 (quick) or 100 (better accuracy)")
    print(f"  Image size: 640")
    print()

    use_defaults = input("Use recommended settings? [Y/n]: ").strip().lower()

    if use_defaults in ['', 'y', 'yes']:
        epochs = 50
        batch = batch_default
        imgsz = 640
        lr = 0.001
        name = "fashion_finetuned"
    else:
        epochs = int(input(f"Epochs [50]: ").strip() or "50")
        batch = int(input(f"Batch size [{batch_default}]: ").strip() or str(batch_default))
        imgsz = int(input("Image size [640]: ").strip() or "640")
        lr = float(input("Learning rate [0.001]: ").strip() or "0.001")
        name = input("Run name [fashion_finetuned]: ").strip() or "fashion_finetuned"

    # Confirm
    print_header("📋 Summary")
    print(f"Base model: kesimeg/yolov8n-clothing-detection")
    print(f"Dataset: {dataset_yaml}")
    print(f"Device: {device}")
    print(f"Epochs: {epochs}")
    print(f"Batch size: {batch}")
    print(f"Image size: {imgsz}")
    print(f"Learning rate: {lr}")
    print(f"Name: {name}")
    print()

    estimated_time = {
        'cpu': epochs * 15,  # minutes per epoch
        '0': epochs * 2,     # GPU estimate
    }
    time = estimated_time.get(device, epochs * 10)
    hours = time // 60
    minutes = time % 60

    if hours > 0:
        print(f"⏱️  Estimated time: ~{hours}h {minutes}m")
    else:
        print(f"⏱️  Estimated time: ~{minutes}m")

    proceed = input("\n🚀 Start training? [Y/n]: ").strip().lower()

    if proceed not in ['', 'y', 'yes']:
        print("❌ Training cancelled")
        return

    # Build command
    cmd = (
        f"python scripts/finetune_yolo.py "
        f"--data {dataset_yaml} "
        f"--epochs {epochs} "
        f"--batch {batch} "
        f"--imgsz {imgsz} "
        f"--device {device} "
        f"--lr0 {lr} "
        f"--name {name}"
    )

    print_header("🎓 Training Started")
    print(f"Command: {cmd}\n")

    # Run training
    exit_code = os.system(cmd)

    if exit_code == 0:
        print_header("🎉 Training Complete!")

        best_model = f"runs/detect/{name}/weights/best.pt"

        print(f"\n✅ Model saved: {best_model}")
        print("\n📝 Next steps:")
        print(f"1. Validate: python scripts/finetune_yolo.py --validate --model-path {best_model} --data {dataset_yaml}")
        print(f"2. Export: python scripts/finetune_yolo.py --export onnx --model-path {best_model}")
        print(f"3. Deploy: Set YOLO_MODEL_PATH={best_model} in your .env file")
        print("\n📊 View results:")
        print(f"  - Training curves: runs/detect/{name}/results.png")
        print(f"  - Confusion matrix: runs/detect/{name}/confusion_matrix.png")
        print(f"  - Validation samples: runs/detect/{name}/val_batch*.jpg")
    else:
        print_header("❌ Training Failed")
        print("Check the error messages above.")
        print("\n💡 Common issues:")
        print("  - Out of memory: Reduce --batch size")
        print("  - Dataset errors: Check labels are in YOLO format")
        print("  - No GPU: Training will be slower on CPU")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n❌ Training interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

