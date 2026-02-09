import json
import pandas as pd
from pathlib import Path
from typing import Optional


def fashionpedia_to_csv(ann_json_path: str, images_dir: Optional[str], out_csv: str):
    """Convert Fashionpedia (COCO-like) annotations to CSV with columns: image_path, labels, outfit_id

    - `ann_json_path` : path to annotations JSON
    - `images_dir` : optional base directory for image files (if None, use file_name from JSON)
    - `out_csv` : output CSV path

    The converter aggregates annotation categories and attribute key/value pairs per image into the `labels` column,
    separated by semicolons. `outfit_id` is left empty for Fashionpedia.
    """
    with open(ann_json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    images = {img['id']: img for img in data.get('images', [])}
    cats = {c['id']: c['name'] for c in data.get('categories', [])}

    # Some Fashionpedia releases include an attributes section; map id->name if present
    attributes_map = {}
    for a in data.get('attributes', []):
        # attributes may be list of dicts with id and name
        if isinstance(a, dict) and 'id' in a and 'name' in a:
            attributes_map[a['id']] = a['name']

    # Collect labels per image id
    img_labels = {img_id: set() for img_id in images.keys()}

    for ann in data.get('annotations', []):
        img_id = ann.get('image_id')
        if img_id not in images:
            continue
        # Category
        cat_id = ann.get('category_id')
        if cat_id and cat_id in cats:
            img_labels[img_id].add(cats[cat_id])

        # Attributes -- flexible handling
        # 1) dict field 'attributes'
        if 'attributes' in ann and isinstance(ann['attributes'], dict):
            for k, v in ann['attributes'].items():
                if v is None or v == '':
                    continue
                img_labels[img_id].add(f"{k}:{v}")

        # 2) list of attribute ids under 'attribute_ids' or similar
        if 'attribute_ids' in ann and isinstance(ann['attribute_ids'], (list, tuple)):
            for aid in ann['attribute_ids']:
                name = attributes_map.get(aid) or str(aid)
                img_labels[img_id].add(name)

    rows = []
    for img_id, img in images.items():
        file_name = img.get('file_name') or img.get('file_name', '')
        if images_dir:
            img_path = str(Path(images_dir) / file_name)
        else:
            img_path = file_name

        labels = sorted(list(img_labels.get(img_id, set())))
        label_str = ';'.join(labels) if labels else ''
        rows.append({'image_path': img_path, 'labels': label_str, 'outfit_id': ''})

    df = pd.DataFrame(rows)
    df.to_csv(out_csv, index=False)
    print(f"Wrote {len(df)} rows to {out_csv}")


if __name__ == '__main__':
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument('--ann', required=True, help='Annotations JSON (fashionpedia)')
    p.add_argument('--images-dir', default=None, help='Optional images directory prefix')
    p.add_argument('--out', required=True, help='Output CSV')
    args = p.parse_args()
    fashionpedia_to_csv(args.ann, args.images_dir, args.out)
