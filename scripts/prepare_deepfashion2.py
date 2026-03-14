"""
Prepare DeepFashion2 Dataset for YOLOv8 Fine-tuning

DeepFashion2 is a comprehensive fashion dataset with:
- 491K images
- 801K clothing items
- 13 categories
- Bounding boxes, landmarks, segmentation masks
- Dense pose annotations

This script downloads and converts DeepFashion2 to YOLOv8 format.

Dataset: https://github.com/switchablenorms/DeepFashion2
Paper: https://arxiv.org/abs/1901.07973
"""

import os
import json
import shutil
from pathlib import Path
from typing import Dict, List, Tuple
import requests
from tqdm import tqdm
import zipfile
import argparse


# DeepFashion2 category mapping to our fashion categories
DEEPFASHION2_CATEGORIES = {
    1: 'short_sleeve_top',      # Short sleeve top
    2: 'long_sleeve_top',       # Long sleeve top
    3: 'short_sleeve_outwear',  # Short sleeve outwear
    4: 'long_sleeve_outwear',   # Long sleeve outwear
    5: 'vest',                  # Vest
    6: 'sling',                 # Sling
    7: 'shorts',                # Shorts
    8: 'trousers',              # Trousers
    9: 'skirt',                 # Skirt
    10: 'short_sleeve_dress',   # Short sleeve dress
    11: 'long_sleeve_dress',    # Long sleeve dress
    12: 'vest_dress',           # Vest dress
    13: 'sling_dress',          # Sling dress
}

# Map to our standard categories
CATEGORY_MAPPING = {
    'short_sleeve_top': 'tshirt',
    'long_sleeve_top': 'shirt',
    'short_sleeve_outwear': 'jacket',
    'long_sleeve_outwear': 'jacket',
    'vest': 'tank_top',
    'sling': 'tank_top',
    'shorts': 'shorts',
    'trousers': 'pants',
    'skirt': 'skirt',
    'short_sleeve_dress': 'dress',
    'long_sleeve_dress': 'dress',
    'vest_dress': 'dress',
    'sling_dress': 'dress',
}

# Our YOLOv8 class IDs (MUST be sequential 0-7 for YOLO)
YOLO_CLASS_IDS = {
    'shirt': 0,
    'tshirt': 1,
    'jacket': 2,
    'tank_top': 3,
    'pants': 4,
    'shorts': 5,
    'skirt': 6,
    'dress': 7,
}


def download_deepfashion2(output_dir: str = 'data/deepfashion2'):
    """
    Download DeepFashion2 dataset

    Note: DeepFashion2 requires registration and manual download from:
    https://github.com/switchablenorms/DeepFashion2

    This function provides instructions for manual download.
    """
    print("\n" + "="*70)
    print("DeepFashion2 Dataset Download")
    print("="*70)

    print("\n⚠️  DeepFashion2 requires manual download due to licensing.")
    print("\nSteps to download:")
    print("\n1. Visit: https://github.com/switchablenorms/DeepFashion2")
    print("2. Fill out the dataset request form")
    print("3. Download the following files:")
    print("   - train.zip (validation and train images)")
    print("   - validation.zip (validation images)")
    print("   - train/annos.zip (training annotations)")
    print("   - validation/annos.zip (validation annotations)")

    print(f"\n4. Extract them to: {output_dir}/")
    print("   Expected structure:")
    print(f"   {output_dir}/")
    print("       train/")
    print("           image/")
    print("           annos/")
    print("       validation/")
    print("           image/")
    print("           annos/")

    print("\n5. Run this script again with --convert flag")

    Path(output_dir).mkdir(parents=True, exist_ok=True)

    return output_dir


def convert_deepfashion2_bbox(
    bbox: List[float],
    img_width: int,
    img_height: int
) -> Tuple[float, float, float, float]:
    """
    Convert DeepFashion2 bbox to YOLO format

    DeepFashion2 format: [x1, y1, x2, y2] (pixels)
    YOLO format: [x_center, y_center, width, height] (normalized 0-1)
    """
    x1, y1, x2, y2 = bbox

    # Calculate center and dimensions
    x_center = ((x1 + x2) / 2) / img_width
    y_center = ((y1 + y2) / 2) / img_height
    width = (x2 - x1) / img_width
    height = (y2 - y1) / img_height

    # Clamp to valid range
    x_center = max(0, min(1, x_center))
    y_center = max(0, min(1, y_center))
    width = max(0, min(1, width))
    height = max(0, min(1, height))

    return x_center, y_center, width, height


def process_deepfashion2_annotation(
    anno_path: str,
    img_path: str,
    output_label_path: str,
    category_filter: List[str] = None
) -> bool:
    """
    Process a single DeepFashion2 annotation file

    Args:
        anno_path: Path to JSON annotation file
        img_path: Path to image file
        output_label_path: Where to save YOLO format label
        category_filter: Only include these categories (None = all)

    Returns:
        True if processed successfully
    """
    try:
        with open(anno_path, 'r') as f:
            data = json.load(f)

        # Get image dimensions
        img_height = data.get('height', 1024)
        img_width = data.get('width', 768)

        # Process each item in the image
        labels = []

        for item_key, item_data in data.items():
            if item_key in ['source', 'pair_id', 'height', 'width']:
                continue

            # Get category
            category_id = item_data.get('category_id')
            if not category_id or category_id not in DEEPFASHION2_CATEGORIES:
                continue

            df2_category = DEEPFASHION2_CATEGORIES[category_id]
            our_category = CATEGORY_MAPPING.get(df2_category)

            if not our_category:
                continue

            # Filter by category if specified
            if category_filter and our_category not in category_filter:
                continue

            # Get class ID
            class_id = YOLO_CLASS_IDS.get(our_category)
            if class_id is None:
                continue

            # Get bounding box
            bbox = item_data.get('bounding_box')
            if not bbox or len(bbox) != 4:
                continue

            # Convert to YOLO format
            x_center, y_center, width, height = convert_deepfashion2_bbox(
                bbox, img_width, img_height
            )

            # Skip invalid boxes
            if width <= 0 or height <= 0:
                continue

            labels.append(f"{class_id} {x_center:.6f} {y_center:.6f} {width:.6f} {height:.6f}")

        # Write label file if we have valid labels
        if labels:
            with open(output_label_path, 'w') as f:
                f.write('\n'.join(labels) + '\n')
            return True

        return False

    except Exception as e:
        print(f"Error processing {anno_path}: {e}")
        return False


def convert_deepfashion2_to_yolo(
    deepfashion2_dir: str = 'src/lib/model/data/deepfashion2',
    output_dir: str = 'data/fashion_train',
    max_images: int = None,
    category_filter: List[str] = None
):
    """
    Convert DeepFashion2 dataset to YOLO format

    Args:
        deepfashion2_dir: Path to DeepFashion2 dataset
        output_dir: Output directory for YOLO format
        max_images: Maximum number of images to process (None = all)
        category_filter: Only include these categories
    """
    print("\n" + "="*70)
    print("Converting DeepFashion2 to YOLO Format")
    print("="*70)

    df2_path = Path(deepfashion2_dir)
    output_path = Path(output_dir)

    # Check if dataset exists
    train_dir = df2_path / 'train'
    val_dir = df2_path / 'validation'

    if not train_dir.exists() or not val_dir.exists():
        print(f"\n❌ DeepFashion2 dataset not found at {deepfashion2_dir}")
        print("Run with --download flag first and follow instructions.")
        return

    # Create output directories
    for split in ['train', 'val']:
        (output_path / 'images' / split).mkdir(parents=True, exist_ok=True)
        (output_path / 'labels' / split).mkdir(parents=True, exist_ok=True)

    # Process train and validation splits
    stats = {'train': {'processed': 0, 'skipped': 0}, 'val': {'processed': 0, 'skipped': 0}}

    for split, source_dir in [('train', train_dir), ('val', val_dir)]:
        print(f"\n📦 Processing {split} split...")

        anno_dir = source_dir / 'annos'
        image_dir = source_dir / 'image'

        if not anno_dir.exists() or not image_dir.exists():
            print(f"⚠️  Missing {split} directories, skipping...")
            continue

        # Get all annotation files
        anno_files = list(anno_dir.glob('*.json'))

        if max_images:
            anno_files = anno_files[:max_images]

        print(f"Found {len(anno_files)} annotation files")

        # Process each annotation
        for anno_file in tqdm(anno_files, desc=f"Converting {split}"):
            # Get corresponding image
            img_name = anno_file.stem + '.jpg'
            img_path = image_dir / img_name

            if not img_path.exists():
                stats[split]['skipped'] += 1
                continue

            # Output paths
            output_img = output_path / 'images' / split / img_name
            output_label = output_path / 'labels' / split / f"{anno_file.stem}.txt"

            # Process annotation
            success = process_deepfashion2_annotation(
                str(anno_file),
                str(img_path),
                str(output_label),
                category_filter
            )

            if success:
                # Copy image
                shutil.copy(img_path, output_img)
                stats[split]['processed'] += 1
            else:
                stats[split]['skipped'] += 1

    # Print statistics
    print("\n" + "="*70)
    print("Conversion Complete!")
    print("="*70)

    for split in ['train', 'val']:
        total = stats[split]['processed'] + stats[split]['skipped']
        print(f"\n{split.upper()}:")
        print(f"  Processed: {stats[split]['processed']}/{total}")
        print(f"  Skipped: {stats[split]['skipped']}/{total}")

    total_processed = stats['train']['processed'] + stats['val']['processed']
    print(f"\n✅ Total images: {total_processed}")
    print(f"   Output: {output_dir}")

    # Create dataset YAML
    create_dataset_yaml(output_dir)

    return output_dir


def create_dataset_yaml(output_dir: str):
    """Create YAML configuration file for the dataset"""
    import yaml

    yaml_path = 'data/deepfashion2_yolo.yaml'

    config = {
        'path': os.path.abspath(output_dir),
        'train': 'images/train',
        'val': 'images/val',
        'nc': len(set(YOLO_CLASS_IDS.values())),
        'names': {v: k for k, v in YOLO_CLASS_IDS.items()}
    }

    with open(yaml_path, 'w') as f:
        yaml.dump(config, f, sort_keys=False)

    print(f"\n✅ Dataset YAML created: {yaml_path}")
    print(f"   Classes: {list(config['names'].values())}")

    return yaml_path


def main():
    parser = argparse.ArgumentParser(
        description='Prepare DeepFashion2 dataset for YOLOv8 training',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Show download instructions
  python scripts/prepare_deepfashion2.py --download
  
  # Convert dataset to YOLO format
  python scripts/prepare_deepfashion2.py --convert
  
  # Convert with limits
  python scripts/prepare_deepfashion2.py --convert --max-images 10000
  
  # Filter specific categories
  python scripts/prepare_deepfashion2.py --convert --categories dress pants
        """
    )

    parser.add_argument('--download', action='store_true',
                       help='Show download instructions')
    parser.add_argument('--convert', action='store_true',
                       help='Convert DeepFashion2 to YOLO format')
    parser.add_argument('--deepfashion2-dir', type=str,
                       default='src/lib/model/data/deepfashion2/DeepFashion2/deepfashion2_original_images',
                       help='DeepFashion2 dataset directory')
    parser.add_argument('--output-dir', type=str, default='data/fashion_train',
                       help='Output directory for YOLO format')
    parser.add_argument('--max-images', type=int,
                       help='Maximum images to process per split')
    parser.add_argument('--categories', nargs='+',
                       choices=list(YOLO_CLASS_IDS.keys()),
                       help='Only include specific categories')

    args = parser.parse_args()

    if args.download:
        download_deepfashion2(args.deepfashion2_dir)
    elif args.convert:
        convert_deepfashion2_to_yolo(
            args.deepfashion2_dir,
            args.output_dir,
            args.max_images,
            args.categories
        )

        print("\n" + "="*70)
        print("🎯 Next Steps")
        print("="*70)
        print("\n1. Review the converted dataset:")
        print(f"   ls {args.output_dir}/images/train/")
        print(f"   ls {args.output_dir}/labels/train/")

        print("\n2. Start fine-tuning:")
        print("   python scripts/finetune_yolo.py \\")
        print("       --data data/deepfashion2_yolo.yaml \\")
        print("       --epochs 100 \\")
        print("       --batch 16 \\")
        print("       --device 0 \\")
        print("       --name deepfashion2_finetuned")

        print("\n3. Or use the quick start:")
        print("   python scripts/quickstart_finetune.py")
    else:
        parser.print_help()


if __name__ == "__main__":
    main()






