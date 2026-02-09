import os
import csv
import time
import requests
from pathlib import Path
from urllib.parse import urlparse
from bs4 import BeautifulSoup


def _safe_filename(s: str) -> str:
    return "".join(c for c in s if c.isalnum() or c in ('-', '_', '.')).rstrip()


def download_images_from_csv(csv_path: str, url_column: str = 'url', id_column: str = None, out_dir: str = 'data/asos_images', delay: float = 1.0, max_per_domain: int = 1, timeout: int = 10):
    """Download product images from ASOS product page URLs listed in a CSV.

    CSV should contain a column with product page URLs. Optionally an ID column to name files.

    This is a pragmatic scraper: it fetches the page, looks for OpenGraph image tags (`og:image`) or
    first `<img>` with a product image, downloads and stores images as `{id}.jpg` or a hashed filename.

    Use responsibly: obey robots.txt and rate-limit requests for production use.
    """
    Path(out_dir).mkdir(parents=True, exist_ok=True)

    with open(csv_path, newline='', encoding='utf-8') as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            url = row.get(url_column)
            if not url:
                continue

            key = None
            if id_column and row.get(id_column):
                key = _safe_filename(row[id_column])
            else:
                parsed = urlparse(url)
                key = _safe_filename(Path(parsed.path).stem or parsed.netloc)

            try:
                resp = requests.get(url, timeout=timeout, headers={'User-Agent': 'Mozilla/5.0'})
                if resp.status_code != 200:
                    print(f"Failed to fetch {url}: {resp.status_code}")
                    continue

                soup = BeautifulSoup(resp.text, 'html.parser')

                # Try OpenGraph
                og = soup.find('meta', property='og:image')
                img_url = None
                if og and og.get('content'):
                    img_url = og['content']

                # Fallback: first large image tag
                if not img_url:
                    imgs = soup.find_all('img')
                    # Heuristic: pick src with 'product' or large size
                    for img in imgs:
                        src = img.get('src') or img.get('data-src') or img.get('data-image')
                        if not src:
                            continue
                        low_src = src.lower()
                        if 'product' in low_src or 'image' in low_src or 'media' in low_src or 'images' in low_src:
                            img_url = src
                            break

                if not img_url:
                    # last-resort: first img
                    first = soup.find('img')
                    if first and (first.get('src') or first.get('data-src')):
                        img_url = first.get('src') or first.get('data-src')

                if not img_url:
                    print(f"No image found on page: {url}")
                    continue

                # Resolve relative URLs
                if img_url.startswith('//'):
                    scheme = 'https:'
                    img_url = scheme + img_url
                elif img_url.startswith('/'):
                    parsed = urlparse(url)
                    img_url = f"{parsed.scheme}://{parsed.netloc}" + img_url

                # Download image
                img_resp = requests.get(img_url, timeout=timeout, headers={'User-Agent': 'Mozilla/5.0'})
                if img_resp.status_code == 200:
                    ext = os.path.splitext(urlparse(img_url).path)[1] or '.jpg'
                    fname = f"{key}{ext}"
                    outpath = Path(out_dir) / fname
                    with open(outpath, 'wb') as of:
                        of.write(img_resp.content)
                    print(f"Saved image for {url} -> {outpath}")
                else:
                    print(f"Failed to download image {img_url}: {img_resp.status_code}")

            except Exception as e:
                print(f"Error processing {url}: {e}")

            time.sleep(delay)


if __name__ == '__main__':
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument('csv', help='CSV file with product page URLs')
    p.add_argument('--url-column', default='url')
    p.add_argument('--id-column', default=None)
    p.add_argument('--out', default='data/asos_images')
    p.add_argument('--delay', type=float, default=1.0)
    args = p.parse_args()

    download_images_from_csv(args.csv, url_column=args.url_column, id_column=args.id_column, out_dir=args.out, delay=args.delay)
