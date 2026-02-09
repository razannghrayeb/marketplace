import json
import csv
import time
from pathlib import Path
from typing import Optional, Dict, Any, List
import requests
from bs4 import BeautifulSoup
from urllib.parse import urlparse
from concurrent.futures import ThreadPoolExecutor, as_completed


HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; RecommenderBot/1.0)"}


def _safe_filename(s: str) -> str:
    return "".join(c for c in s if c.isalnum() or c in ('-', '_', '.')).rstrip()


def _parse_json_ld(soup: BeautifulSoup) -> List[Dict[str, Any]]:
    results = []
    for tag in soup.find_all('script', type='application/ld+json'):
        try:
            data = json.loads(tag.string or '{}')
        except Exception:
            continue
        # data may be list or dict
        if isinstance(data, list):
            results.extend(data)
        elif isinstance(data, dict):
            results.append(data)
    return results


def _extract_from_ld(ld_list: List[Dict[str, Any]]) -> Dict[str, Any]:
    out = {}
    for d in ld_list:
        typ = d.get('@type')
        if not typ:
            # sometimes nested
            typ = d.get('type')
        if typ and 'Product' in typ:
            out['title'] = out.get('title') or d.get('name')
            out['brand'] = out.get('brand') or (d.get('brand', {}).get('name') if isinstance(d.get('brand'), dict) else d.get('brand'))
            out['image'] = out.get('image') or d.get('image')
            # price
            offers = d.get('offers') or {}
            if isinstance(offers, dict):
                out['price'] = offers.get('price')
                out['currency'] = offers.get('priceCurrency')
            # color/sku attributes
            if 'color' in d:
                out['color'] = d.get('color')
            if 'description' in d and not out.get('description'):
                out['description'] = d.get('description')
    return out


def parse_asos_product(url: str, timeout: int = 10) -> Dict[str, Any]:
    """Fetch product page and extract structured fields and primary image URL."""
    try:
        resp = requests.get(url, headers=HEADERS, timeout=timeout)
        if resp.status_code != 200:
            return {'url': url, 'error': f'HTTP {resp.status_code}'}
        text = resp.text
    except Exception as e:
        return {'url': url, 'error': str(e)}

    soup = BeautifulSoup(text, 'html.parser')

    # 1) JSON-LD
    ld = _parse_json_ld(soup)
    data = _extract_from_ld(ld)

    # 2) Fallbacks: meta tags
    if not data.get('title'):
        og = soup.find('meta', property='og:title') or soup.find('meta', attrs={'name': 'og:title'})
        if og and og.get('content'):
            data['title'] = og['content']
        else:
            h1 = soup.find('h1')
            if h1:
                data['title'] = h1.get_text(strip=True)

    if not data.get('brand'):
        brand_tag = soup.find('meta', property='og:site_name') or soup.find('meta', attrs={'name': 'application-name'})
        if brand_tag and brand_tag.get('content'):
            data['brand'] = brand_tag['content']

    # image extraction
    if not data.get('image'):
        og_img = soup.find('meta', property='og:image') or soup.find('meta', attrs={'name': 'og:image'})
        if og_img and og_img.get('content'):
            data['image'] = og_img['content']
        else:
            # find candidate images by heuristics
            imgs = soup.find_all('img')
            best = None
            for img in imgs:
                src = img.get('src') or img.get('data-src') or img.get('data-image')
                if not src:
                    continue
                low = src.lower()
                if 'product' in low or '/images/' in low or 'media' in low or 'asos' in low:
                    best = src
                    break
            data['image'] = best

    # price
    if not data.get('price'):
        price_sel = soup.select_one('[data-test-id*=price]') or soup.select_one('.product-price')
        if price_sel:
            data['price'] = price_sel.get_text(strip=True)

    # build labels: category, color, material
    labels = []
    # try to get breadcrumb/category
    crumbs = [c.get_text(strip=True) for c in soup.select('.breadcrumbs a')[:3]] if soup.select('.breadcrumbs a') else []
    if crumbs:
        labels.extend(crumbs)
    if data.get('brand'):
        labels.append(data['brand'])
    if data.get('color'):
        labels.append(f"color:{data['color']}")
    if data.get('description'):
        # try extract material keywords
        desc = data['description']
        # crude: look for words like cotton, polyester, leather
        for mat in ['cotton', 'polyester', 'leather', 'wool', 'silk']:
            if mat in desc.lower():
                labels.append(f'material:{mat}')

    out = {
        'url': url,
        'title': data.get('title', ''),
        'brand': data.get('brand', ''),
        'price': data.get('price', ''),
        'image_url': data.get('image', ''),
        'labels': ';'.join([l for l in labels if l])
    }
    return out


def download_image(img_url: str, out_dir: str, name_hint: Optional[str] = None, timeout: int = 15) -> Optional[str]:
    if not img_url:
        return None
    try:
        resp = requests.get(img_url, headers=HEADERS, timeout=timeout)
        if resp.status_code != 200:
            return None
        ext = Path(urlparse(img_url).path).suffix or '.jpg'
        key = _safe_filename(name_hint or Path(urlparse(img_url).path).stem)[:120]
        out_path = Path(out_dir) / f"{key}{ext}"
        Path(out_dir).mkdir(parents=True, exist_ok=True)
        with open(out_path, 'wb') as fh:
            fh.write(resp.content)
        return str(out_path)
    except Exception:
        return None


def process_csv(input_csv: str, url_column: str = 'url', id_column: Optional[str] = None, out_csv: str = 'data/asos_parsed.csv', download_images: bool = True, image_out_dir: str = 'data/asos_images', concurrency: int = 8, delay: float = 0.5):
    rows = []
    with open(input_csv, newline='', encoding='utf-8') as fh:
        reader = csv.DictReader(fh)
        tasks = []
        entries = []
        for row in reader:
            url = row.get(url_column)
            if not url:
                continue
            pid = row.get(id_column) if id_column else None
            entries.append((pid, url))

    results = []
    with ThreadPoolExecutor(max_workers=concurrency) as ex:
        future_to_entry = {ex.submit(parse_asos_product, url): (pid, url) for pid, url in entries}
        for f in as_completed(future_to_entry):
            pid, url = future_to_entry[f]
            try:
                out = f.result()
            except Exception as e:
                out = {'url': url, 'error': str(e)}
            # optional download
            local_img = None
            if download_images and out.get('image_url'):
                name_hint = pid or out.get('title') or Path(urlparse(url).path).stem
                local_img = download_image(out.get('image_url'), image_out_dir, name_hint=name_hint)
            results.append((pid, url, out, local_img))
            time.sleep(delay)

    # write CSV
    with open(out_csv, 'w', newline='', encoding='utf-8') as of:
        writer = csv.DictWriter(of, fieldnames=['id', 'url', 'image_path', 'title', 'brand', 'price', 'labels'])
        writer.writeheader()
        for pid, url, out, local_img in results:
            row = {
                'id': pid or '',
                'url': url,
                'image_path': local_img or out.get('image_url') or '',
                'title': out.get('title') or '',
                'brand': out.get('brand') or '',
                'price': out.get('price') or '',
                'labels': out.get('labels') or ''
            }
            writer.writerow(row)

    print(f"Wrote parsed data to {out_csv} ({len(results)} rows)")


if __name__ == '__main__':
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument('input_csv', help='CSV with ASOS product page URLs')
    p.add_argument('--url-column', default='url')
    p.add_argument('--id-column', default=None)
    p.add_argument('--out', default='data/asos_parsed.csv')
    p.add_argument('--download-images', action='store_true')
    p.add_argument('--image-out', default='data/asos_images')
    p.add_argument('--concurrency', type=int, default=8)
    p.add_argument('--delay', type=float, default=0.5)
    args = p.parse_args()

    process_csv(args.input_csv, url_column=args.url_column, id_column=args.id_column, out_csv=args.out, download_images=args.download_images, image_out_dir=args.image_out, concurrency=args.concurrency, delay=args.delay)
