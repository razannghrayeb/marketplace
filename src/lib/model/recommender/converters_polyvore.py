import json
import pandas as pd
from pathlib import Path
from typing import Optional


def polyvore_to_csv(polyvore_json_path: str, images_dir: Optional[str], out_csv: str, download_images: bool = False):
    """Convert Polyvore Outfits dataset (common JSON formats) to CSV with columns: image_path, labels, outfit_id

    The function attempts to handle two common variants:
      - A JSON with `items` (id, image, category/tags) and `outfits` (id, item_ids)
      - A JSON list of outfits where each outfit contains item entries

    If `images_dir` is given, the converter will assume item image file names live under it; otherwise the image URL is left in `image_path`.
    """
    with open(polyvore_json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    rows = []

    # Variant A: has items + outfits
    if isinstance(data, dict) and 'items' in data and 'outfits' in data:
        items = {itm['id']: itm for itm in data['items']}
        for outfit in data['outfits']:
            oid = outfit.get('id') or outfit.get('set_id') or outfit.get('outfit_id')
            item_ids = outfit.get('items') or outfit.get('item_ids') or outfit.get('components') or []
            for iid in item_ids:
                itm = items.get(iid)
                if not itm:
                    continue
                img = itm.get('image') or itm.get('img') or itm.get('image_url') or itm.get('original_image')
                category = itm.get('category') or itm.get('label') or ''
                tags = itm.get('tags') or itm.get('attributes') or []
                label_list = []
                if category:
                    label_list.append(str(category))
                if isinstance(tags, list):
                    label_list.extend([str(t) for t in tags])
                label_str = ';'.join([l for l in label_list if l])

                if images_dir and img and (not str(img).startswith('http')):
                    img_path = str(Path(images_dir) / img)
                else:
                    img_path = img or ''

                rows.append({'image_path': img_path, 'labels': label_str, 'outfit_id': oid})

    # Variant B: top-level list of outfits
    elif isinstance(data, list):
        for outfit in data:
            oid = outfit.get('id') or outfit.get('set_id') or None
            items = outfit.get('items') or outfit.get('parts') or outfit.get('components') or []
            for itm in items:
                img = itm.get('image') or itm.get('img') or itm.get('image_url')
                category = itm.get('category') or itm.get('label') or ''
                tags = itm.get('tags') or itm.get('attributes') or []
                label_list = []
                if category:
                    label_list.append(str(category))
                if isinstance(tags, list):
                    label_list.extend([str(t) for t in tags])
                label_str = ';'.join([l for l in label_list if l])

                if images_dir and img and (not str(img).startswith('http')):
                    img_path = str(Path(images_dir) / img)
                else:
                    img_path = img or ''

                rows.append({'image_path': img_path, 'labels': label_str, 'outfit_id': oid})

    else:
        raise ValueError('Unrecognized Polyvore JSON structure')

    df = pd.DataFrame(rows)
    df.to_csv(out_csv, index=False)
    print(f"Wrote {len(df)} rows to {out_csv}")


if __name__ == '__main__':
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument('--polyvore', required=True, help='Polyvore JSON file')
    p.add_argument('--images-dir', default=None, help='Optional images directory prefix')
    p.add_argument('--out', required=True, help='Output CSV')
    args = p.parse_args()
    polyvore_to_csv(args.polyvore, args.images_dir, args.out)
