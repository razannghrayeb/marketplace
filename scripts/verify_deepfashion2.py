"""
Verify DeepFashion2 Dataset Structure

Quick script to check if DeepFashion2 is properly installed and show statistics.
"""

import os
import json
from pathlib import Path
from collections import defaultdict


def verify_deepfashion2(deepfashion2_dir: str = 'src/lib/model/deepfashion2'):
    """Verify DeepFashion2 dataset structure and show statistics"""

    print("\n" + "="*70)
    print("DeepFashion2 Dataset Verification")
    print("="*70)

    df2_path = Path(deepfashion2_dir)

    # Check if directory exists
    if not df2_path.exists():
        print(f"\n❌ Directory not found: {deepfashion2_dir}")
        print("\nExpected location: src/lib/model/data/deepfashion2/")
        print("\nPlease download DeepFashion2 and extract to this location:")
        print("  - src/lib/model/data/deepfashion2/train/image/")
        print("  - src/lib/model/data/deepfashion2/train/annos/")
        print("  - src/lib/model/data/deepfashion2/validation/image/")
        print("  - src/lib/model/data/deepfashion2/validation/annos/")
        print("\nDownload from: https://github.com/switchablenorms/DeepFashion2")
        return False

    print(f"\n✅ Found directory: {deepfashion2_dir}")

    # Check structure
    required_dirs = [
        'train/image',
        'train/annos',
        'validation/image',
        'validation/annos'
    ]

    missing_dirs = []
    for dir_name in required_dirs:
        dir_path = df2_path / dir_name
        if dir_path.exists():
            print(f"✅ {dir_name}/")
        else:
            print(f"❌ {dir_name}/ (missing)")
            missing_dirs.append(dir_name)

    if missing_dirs:
        print(f"\n❌ Missing required directories: {missing_dirs}")
        return False

    # Count files
    print("\n" + "="*70)
    print("Dataset Statistics")
    print("="*70)

    stats = {}

    for split in ['train', 'validation']:
        image_dir = df2_path / split / 'image'
        anno_dir = df2_path / split / 'annos'

        images = list(image_dir.glob('*.jpg'))
        annos = list(anno_dir.glob('*.json'))

        stats[split] = {
            'images': len(images),
            'annotations': len(annos)
        }

        print(f"\n{split.upper()}:")
        print(f"  Images: {len(images):,}")
        print(f"  Annotations: {len(annos):,}")

    # Sample annotation
    print("\n" + "="*70)
    print("Sample Annotation")
    print("="*70)

    sample_anno = list((df2_path / 'train' / 'annos').glob('*.json'))[0]
    with open(sample_anno, 'r') as f:
        data = json.load(f)

    print(f"\nFile: {sample_anno.name}")
    print(f"Image size: {data.get('width', 'N/A')}x{data.get('height', 'N/A')}")

    # Count items by category
    category_counts = defaultdict(int)
    item_count = 0

    for key, value in data.items():
        if key in ['source', 'pair_id', 'height', 'width']:
            continue
        if isinstance(value, dict) and 'category_id' in value:
            category_counts[value['category_id']] += 1
            item_count += 1

    print(f"Items in this image: {item_count}")
    print(f"Categories: {dict(category_counts)}")

    # Category distribution (sample first 100 annotations)
    print("\n" + "="*70)
    print("Category Distribution (first 100 train images)")
    print("="*70)

    all_categories = defaultdict(int)
    anno_files = list((df2_path / 'train' / 'annos').glob('*.json'))[:100]

    for anno_file in anno_files:
        try:
            with open(anno_file, 'r') as f:
                data = json.load(f)

            for key, value in data.items():
                if key in ['source', 'pair_id', 'height', 'width']:
                    continue
                if isinstance(value, dict) and 'category_id' in value:
                    cat_id = value['category_id']
                    all_categories[cat_id] += 1
        except Exception as e:
            print(f"Error reading {anno_file}: {e}")

    # DeepFashion2 categories
    categories = {
        1: 'short_sleeve_top',
        2: 'long_sleeve_top',
        3: 'short_sleeve_outwear',
        4: 'long_sleeve_outwear',
        5: 'vest',
        6: 'sling',
        7: 'shorts',
        8: 'trousers',
        9: 'skirt',
        10: 'short_sleeve_dress',
        11: 'long_sleeve_dress',
        12: 'vest_dress',
        13: 'sling_dress'
    }

    for cat_id in sorted(all_categories.keys()):
        cat_name = categories.get(cat_id, f'unknown_{cat_id}')
        count = all_categories[cat_id]
        print(f"  {cat_id:2d}. {cat_name:25s}: {count:4d} items")

    print("\n" + "="*70)
    print("✅ Dataset is ready for conversion!")
    print("="*70)

    print("\nNext step:")
    print("  python scripts/prepare_deepfashion2.py --convert")

    return True


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description='Verify DeepFashion2 dataset')
    parser.add_argument('--path', type=str,
                       default='src/lib/model/data/deepfashion2/DeepFashion2/deepfashion2_original_images',
                       help='Path to DeepFashion2 dataset')

    args = parser.parse_args()

    verify_deepfashion2(args.path)



