"""

    main()
if __name__ == "__main__":


    print("  From COCO: python scripts/prepare_dataset.py --from-coco data.json --image-dir images/")
    print("  Create YAML: python scripts/prepare_dataset.py --create-yaml")
    print("  Setup: python scripts/prepare_dataset.py --setup")
    print("Usage:")

        return
        create_dataset_yaml(args.output_dir)
        convert_from_coco_json(args.from_coco, args.image_dir, args.output_dir)
        create_directory_structure(args.output_dir)
            return
            print("❌ --image-dir required for COCO conversion")
        if not args.image_dir:
    if args.from_coco:

        return
        create_dataset_yaml(args.output_dir)
    if args.create_yaml:

        return
        print("3. Run: python scripts/finetune_yolo.py --data data/fashion_dataset.yaml")
        print("2. Run: python scripts/prepare_dataset.py --create-yaml")
        print("1. Add your images and labels to the created directories")
        print("\n📝 Next steps:")
        create_directory_structure(args.output_dir)
    if args.setup:

    args = parser.parse_args()

                       help='Directory containing images (for COCO conversion)')
    parser.add_argument('--image-dir', type=str,
                       help='Convert from COCO JSON file')
    parser.add_argument('--from-coco', type=str,
                       help='Create dataset YAML file')
    parser.add_argument('--create-yaml', action='store_true',
                       help='Output directory')
    parser.add_argument('--output-dir', type=str, default='data/fashion_train',
                       help='Create directory structure')
    parser.add_argument('--setup', action='store_true',

    parser = argparse.ArgumentParser(description='Prepare Fashion Dataset for YOLOv8')
def main():


    print(f"\n✅ Conversion complete!")

        process_from_detection_api(str(img_path), detections, output_dir, split)
        split = 'train' if random.random() < 0.8 else 'val'
        # Randomly assign to train or val

            })
                }
                    'y2': y + h
                    'x2': x + w,
                    'y1': y,
                    'x1': x,
                'box': {
                'label': category_name,
            detections.append({

            category_name = category_map[ann['category_id']]
            x, y, w, h = ann['bbox']
        for ann in annotations:
        detections = []
        # Convert COCO bbox [x, y, width, height] to our format

            continue
            print(f"⚠️  Image not found: {img_path}")
        if not img_path.exists():

        img_path = Path(image_dir) / img_info['file_name']
        img_info = image_map[img_id]
    for img_id, annotations in image_annotations.items():

    image_map = {img['id']: img for img in coco_data['images']}
    # Process each image

        image_annotations[img_id].append(ann)
            image_annotations[img_id] = []
        if img_id not in image_annotations:
        img_id = ann['image_id']
    for ann in coco_data['annotations']:
    image_annotations = {}
    # Group annotations by image

    category_map = {cat['id']: cat['name'] for cat in coco_data['categories']}
    # Create category mapping

        coco_data = json.load(f)
    with open(coco_json_path, 'r') as f:

    print(f"\n📦 Converting COCO format to YOLO...")
    """
        output_dir: Output directory
        image_dir: Directory containing images
        coco_json_path: Path to COCO JSON file
    Args:

    Convert COCO format annotations to YOLO format
    """
):
    output_dir: str = 'data/fashion_train'
    image_dir: str,
    coco_json_path: str,
def convert_from_coco_json(


    return yaml_path
    
    print(f"  Classes: {sorted_names[:10]}...")
    print(f"  Number of classes: {len(categories)}")
    print(f"\n✅ Dataset YAML created: {yaml_path}")
    
        yaml.dump(config, f, sort_keys=False)
    with open(yaml_path, 'w') as f:
    
    }
        'names': sorted_names
        'nc': len(categories),
        'val': 'images/val',
        'train': 'images/train',
        'path': os.path.abspath(output_dir),
    config = {
    
    sorted_names = [class_names[i] for i in sorted(class_names.keys())]
    class_names = {v: k for k, v in categories.items()}
    # Reverse mapping (id -> name)
    
    """Create dataset YAML file for YOLOv8"""
):
    categories: Dict[str, int] = FASHION_CATEGORIES
    yaml_path: str = 'data/fashion_dataset.yaml',
    output_dir: str = 'data/fashion_train',
def create_dataset_yaml(


    return train_images, val_images
    
    print(f"  Validation: {len(val_images)} ({(1-train_ratio)*100:.0f}%)")
    print(f"  Training: {len(train_images)} ({train_ratio*100:.0f}%)")
    print(f"  Total images: {len(image_files)}")
    print(f"\n📊 Dataset Split:")
    
    val_images = image_files[split_idx:]
    train_images = image_files[:split_idx]
    split_idx = int(len(image_files) * train_ratio)
    # Split
    
    random.shuffle(image_files)
    image_files = list(Path(image_dir).glob('*.[jp][pn][g]'))
    # Get all images
    
    random.seed(seed)
    """
        seed: Random seed for reproducibility
        train_ratio: Ratio of training images (0-1)
        output_dir: Output directory for dataset
        image_dir: Directory containing all images
    Args:

    Split images into train/val sets
    """
):
    seed: int = 42
    train_ratio: float = 0.8,
    output_dir: str = 'data/fashion_train',
    image_dir: str,
def split_dataset(


    print(f"✅ Processed: {img_name} ({len(detections)} objects)")
    
    create_label_file(detections, img_width, img_height, label_output)
    
    label_output = f"{output_dir}/labels/{split}/{label_name}"
    label_name = Path(img_name).stem + '.txt'
    # Create label file
    
    shutil.copy(image_path, img_output)
    img_output = f"{output_dir}/images/{split}/{img_name}"
    img_name = Path(image_path).name
    # Copy image to appropriate directory
    
    img_width, img_height = img.size
    img = Image.open(image_path)
    # Load image to get dimensions
    """
        split: 'train' or 'val'
        output_dir: Base output directory (data/fashion_train)
        detections: List of detections from API (with 'label', 'box', 'confidence')
        image_path: Path to image file
    Args:

    Process image and detections from YOLO detection API response
    """
):
    split: str = 'train'
    output_dir: str,
    detections: List[Dict],
    image_path: str,
def process_from_detection_api(


            f.write(f"{class_id} {x_center:.6f} {y_center:.6f} {width:.6f} {height:.6f}\n")
            # Write YOLO format: class_id x_center y_center width height
            
            )
                bbox, img_width, img_height
            x_center, y_center, width, height = convert_bbox_to_yolo(
            
            bbox = ann['box']
            class_id = category_map[label]
            
                continue
                print(f"⚠️  Unknown category: {label}, skipping")
            if label not in category_map:
            label = ann['label'].lower().strip()
        for ann in annotations:
    with open(output_path, 'w') as f:
    """
        category_map: Mapping from category name to class ID
        output_path: Where to save label file
        img_height: Image height
        img_width: Image width
        annotations: List of annotations with 'label' and 'box'
    Args:

    Create YOLO format label file
    """
):
    category_map: Dict[str, int] = FASHION_CATEGORIES
    output_path: str,
    img_height: int,
    img_width: int,
    annotations: List[Dict],
def create_label_file(


    return x_center, y_center, width, height
    
    height = max(0, min(1, height))
    width = max(0, min(1, width))
    y_center = max(0, min(1, y_center))
    x_center = max(0, min(1, x_center))
    # Clamp to 0-1
    
    height = (y2 - y1) / img_height
    width = (x2 - x1) / img_width
    y_center = ((y1 + y2) / 2) / img_height
    x_center = ((x1 + x2) / 2) / img_width
    # Calculate center and dimensions
    
    x2, y2 = bbox['x2'], bbox['y2']
    x1, y1 = bbox['x1'], bbox['y1']
    """
        Tuple (x_center, y_center, width, height) normalized 0-1
    Returns:

        img_height: Image height
        img_width: Image width
        bbox: Dict with x1, y1, x2, y2 (pixel coordinates)
    Args:

    Convert bounding box to YOLO format
    """
) -> tuple:
    img_height: int
    img_width: int,
    bbox: Dict[str, float],
def convert_bbox_to_yolo(


    return base_path
    print(f"✅ Created directory structure at {base_path}")
    
        Path(path).mkdir(parents=True, exist_ok=True)
    for path in paths:
    
    ]
        f'{base_path}/labels/val',
        f'{base_path}/labels/train',
        f'{base_path}/images/val',
        f'{base_path}/images/train',
    paths = [
    """Create YOLOv8 dataset directory structure"""
def create_directory_structure(base_path: str = 'data/fashion_train'):


}
    'necklace': 43, 'bracelet': 44, 'earrings': 45, 'ring': 46, 'jewelry': 47,
    # Jewelry
    
    'tie': 40, 'scarf': 41, 'gloves': 42,
    'hat': 36, 'sunglasses': 37, 'watch': 38, 'belt': 39,
    # Accessories
    
    'bag': 31, 'backpack': 32, 'clutch': 33, 'tote': 34, 'crossbody': 35,
    # Bags
    
    'loafers': 29, 'flats': 30,
    'sneakers': 25, 'boots': 26, 'heels': 27, 'sandals': 28,
    # Footwear
    
    'jacket': 20, 'coat': 21, 'blazer': 22, 'parka': 23, 'bomber': 24,
    # Outerwear
    
    'jeans': 15, 'pants': 16, 'shorts': 17, 'skirt': 18, 'leggings': 19,
    # Bottoms
    
    'mini_dress': 13, 'midi_dress': 14,
    'dress': 10, 'gown': 11, 'maxi_dress': 12, 
    # Dresses
    
    'crop_top': 8, 'top': 9,
    'hoodie': 4, 'sweatshirt': 5, 'cardigan': 6, 'tank_top': 7,
    'shirt': 0, 'tshirt': 1, 'blouse': 2, 'sweater': 3,
    # Tops
FASHION_CATEGORIES = {
# Fashion category mapping


import yaml
from PIL import Image
import json
import random
from typing import List, Dict
from pathlib import Path
import shutil
import os
import argparse

"""
    (all values normalized 0-1)
    Example: 0 0.5 0.5 0.3 0.4
    class_id x_center y_center width height
Label Format (YOLO):

                image3.txt
            val/
                image2.txt
                image1.txt  (YOLO format)
            train/
        labels/
                image3.jpg
            val/
                image2.jpg
                image1.jpg
            train/
        images/
    data/fashion_train/
Dataset Structure:

- Generate dataset YAML
- Split into train/val sets
- Create label files in YOLO format
- Convert images to proper format
This script helps you prepare your fashion dataset in YOLOv8 format:

Prepare Fashion Dataset for YOLOv8 Training
