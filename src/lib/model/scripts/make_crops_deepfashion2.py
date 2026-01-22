"""
Script to create cropped images from DeepFashion2 annotations.
Run this before training to prepare the dataset.

Usage:
    python scripts/make_crops_deepfashion2.py \
        --ds_root "C:/Users/USER/Desktop/marketplace/data/raw/DeepFashion2/deepfashion2_original_images" \
        --split train \
        --out_root "data/df2"
"""
import os, json, csv
from pathlib import Path
from PIL import Image
from tqdm import tqdm

def clamp(value, min_value, max_value):
    return max(min_value, min(value, max_value))

def main(ds_root: str, split: str, out_root: str):
    ds_root = Path(ds_root)
    
    # DeepFashion2 structure: {split}/image/ and {split}/annos/
    img_dir = ds_root / split / "image"
    ann_dir = ds_root / split / "annos"
    
    out_dir = Path(out_root) / split / "crops"
    out_dir.mkdir(parents=True, exist_ok=True)

    csv_file_path = Path(out_root) / f"{split}_crops.csv"
    rows = []

    # Find all annotation files
    ann_files = sorted(ann_dir.glob("*.json"))
    if not ann_files:
        raise ValueError(f"No annotation files found in {ann_dir}")
    
    print(f"Found {len(ann_files)} annotation files in {ann_dir}")
    print(f"Image directory: {img_dir}")
    print(f"Output directory: {out_dir}")
    
    skipped = 0
    processed = 0
    
    for ann_path in tqdm(ann_files, desc=f"Processing {split}"):
        with open(ann_path, 'r') as f:
            ann_data = json.load(f)
        
        # Image filename matches annotation filename (000001.json -> 000001.jpg)
        img_name = ann_path.stem + ".jpg"
        img_path = img_dir / img_name
        
        if not img_path.exists():
            skipped += 1
            continue
            
        try:
            pil = Image.open(img_path).convert("RGB")
        except Exception as e:
            print(f"Error loading {img_path}: {e}")
            skipped += 1
            continue
            
        width, height = pil.size

        # DeepFashion2 format: item1, item2, ... for each item in image
        for key, item in ann_data.items():
            if not key.startswith("item"):
                continue
                
            # Extract bounding box [x1, y1, x2, y2]
            bbox = item.get("bounding_box")
            if not bbox or len(bbox) != 4:
                continue
                
            x1, y1, x2, y2 = bbox
            
            # Clamp coordinates
            x1 = clamp(int(x1), 0, width - 1)
            y1 = clamp(int(y1), 0, height - 1)
            x2 = clamp(int(x2), 0, width - 1)
            y2 = clamp(int(y2), 0, height - 1)

            # Skip too small boxes
            box_area = (x2 - x1) * (y2 - y1)
            if box_area < 32 * 32:
                continue
            
            # Crop and save
            crop = pil.crop((x1, y1, x2, y2))
            crop_filename = f"{ann_path.stem}_{key}.jpg"
            crop_path = out_dir / crop_filename
            crop.save(crop_path, format="JPEG", quality=95)

            # Get category info (1-13 in DeepFashion2)
            category_id = item.get("category_id", 1)
            category_name = item.get("category_name", "unknown")
            style = item.get("style", 0)
            
            row = {
                "path": str(crop_path.as_posix()),
                "category_id": category_id,
                "category_name": category_name,
                "original_image": img_name,
                "style": style,
                "x1": x1,
                "y1": y1,
                "x2": x2,
                "y2": y2,
                # Default values for other attributes
                "color_ids": "0",
                "pattern_id": 0,
                "material_id": 0,
                "season_ids": "4",
                "occasion_ids": "0",
            }
            rows.append(row)
            processed += 1
    
    # Write CSV
    fieldnames = [
        "path", "category_id", "category_name", "original_image", "style",
        "x1", "y1", "x2", "y2",
        "color_ids", "pattern_id", "material_id", "season_ids", "occasion_ids"
    ]
    
    with open(csv_file_path, 'w', newline='', encoding='utf-8') as csvfile:
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    
    print(f"\n=== Summary ===")
    print(f"Processed: {processed} crops")
    print(f"Skipped images: {skipped}")
    print(f"CSV saved to: {csv_file_path}")


if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='Make cropped images from DeepFashion2 annotations')
    parser.add_argument('--ds_root', required=True, help='Path to DeepFashion2 dataset root')
    parser.add_argument('--split', required=True, choices=['train', 'validation', 'test'], help='Dataset split')
    parser.add_argument('--out_root', required=True, help='Output root for crops and CSV')
    args = parser.parse_args()

    main(args.ds_root, args.split, args.out_root)