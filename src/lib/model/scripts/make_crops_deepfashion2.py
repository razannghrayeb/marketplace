import os, json, csv
from pathlib import Path
from PIL import Image
from tqdm import tqdm

def clamp (value, min_value, max_value):
    return max(min_value, min(value, max_value))

def main(ds_root:str , split:str ,out_root:str):
    ds_root=Path(ds_root)
    img_dir=ds_root/split/"images"
    ann_file=ds_root/split/f"{split}_annotations"
    out_dir=Path(out_root)/split/"crops_deepfashion2"
    out_dir.mkdir(parents=True, exist_ok=True)

    csv_file_path=Path(out_root)/split/f"{split}_crops_deepfashion2_annotations.csv"
    rows=[]

    ann_files = sorted(ann_file.glob("*.json"))
    if not ann_files:
        raise ValueError(f"No annotation files found in {ann_file}")
    
    for ann_path in tqdm(ann_files, desc="Processing annotations"):
        with open(ann_path, 'r') as f:
            ann_data=json.load(f)
        
        img_path=img_dir/ann_data['image_name']
        pil=Image.open(img_path).convert("RGB")
        width, height=pil.size

        for idx, item in enumerate(ann_data['annotations']):
            x1=clamp(item['bbox'][0], 0, width-1)
            y1=clamp(item['bbox'][1], 0, height-1)
            x2=clamp(x1 + item['bbox'][2], 0, width-1)
            y2=clamp(y1 + item['bbox'][3], 0, height-1)

            box_area=(x2 - x1)*(y2 - y1)
            if box_area < 32*32:
                continue
            crop=pil.crop((x1, y1, x2, y2))
            crop_filename=f"{ann_path.stem}_ann{idx}.jpg"
            crop_path=out_dir/crop_filename
            crop.save(crop_path, format="JPEG", quality=95)

            row={
                "path": str(crop_path),
                "original_image": ann_data['image_name'],
                "category_id": item['category_id'],
                "x1": x1,
                "y1": y1,
                "x2": x2,
                "y2": y2,
            }
            rows.append(row)
    
    # Write CSV with proper headers
    with open(csv_file_path, 'w', newline='') as csvfile:
        fieldnames = ["path", "category_id", "original_image", "x1", "y1", "x2", "y2"]
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    
    print(f"Processed {len(rows)} crops, saved to {csv_file_path}")


if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='Make cropped images from DeepFashion2 annotations')
    parser.add_argument('--ds_root', required=True, help='Path to DeepFashion2 dataset root')
    parser.add_argument('--split', required=True, choices=['train', 'validation', 'test'], help='Dataset split')
    parser.add_argument('--out_root', required=True, help='Output root for crops and CSV')
    args = parser.parse_args()

    main(args.ds_root, args.split, args.out_root)