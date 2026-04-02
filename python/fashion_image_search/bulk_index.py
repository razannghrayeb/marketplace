#!/usr/bin/env python3
"""
Bulk index JSONL: one object per line with keys product_id, image_url OR image_path,
optional title, vendor_id, category, is_hidden.

Example:
  {"product_id": "1", "image_path": "/data/sku1.jpg", "title": "Dress"}
  {"product_id": "2", "image_url": "https://cdn.example.com/a.jpg"}

Usage:
  python bulk_index.py --input products.jsonl
  python bulk_index.py --input products.jsonl --batch-size 32
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from typing import Any, Dict, Iterator, List

import requests

from embedding_pipeline import FashionClipEncoder, assert_opensearch_cosinesimil_compatible
from os_client import build_client, index_name

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def iter_jsonl(path: str) -> Iterator[Dict[str, Any]]:
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            yield json.loads(line)


def load_image_bytes(row: Dict[str, Any]) -> bytes:
    if row.get("image_path"):
        with open(row["image_path"], "rb") as f:
            return f.read()
    if row.get("image_url"):
        r = requests.get(row["image_url"], timeout=60)
        r.raise_for_status()
        return r.content
    raise ValueError("row needs image_path or image_url")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True, help="JSONL path")
    ap.add_argument("--batch-size", type=int, default=20)
    ap.add_argument("--garment", action="store_true", help="also set embedding_garment (same vec if no separate crop)")
    args = ap.parse_args()

    enc = FashionClipEncoder.load()
    client = build_client()
    idx = index_name()

    batch: List[Any] = []
    n_ok = 0
    n_err = 0

    def flush() -> None:
        nonlocal batch, n_ok, n_err
        if not batch:
            return
        try:
            client.bulk(body=batch, refresh=True)
            n_ok += len(batch) // 2
        except Exception as e:
            logger.exception("bulk failed: %s", e)
            n_err += len(batch) // 2
        batch = []

    for row in iter_jsonl(args.input):
        pid = str(row.get("product_id", "")).strip()
        if not pid:
            n_err += 1
            continue
        try:
            raw = load_image_bytes(row)
            vec = enc.embed_bytes(raw).tolist()
            assert_opensearch_cosinesimil_compatible(vec)
            doc: Dict[str, Any] = {
                "product_id": pid,
                "title": row.get("title") or "",
                "is_hidden": bool(row.get("is_hidden", False)),
                "category": (row.get("category") or "").lower(),
                "vendor_id": str(row.get("vendor_id", "")),
                "embedding": vec,
            }
            if args.garment:
                doc["embedding_garment"] = vec
            batch.append({"index": {"_index": idx, "_id": pid}})
            batch.append(doc)
            if len(batch) >= args.batch_size * 2:
                flush()
        except Exception as e:
            logger.warning("skip product_id=%s: %s", pid, e)
            n_err += 1

    flush()
    logger.info("indexed_ok=%s indexed_err=%s", n_ok, n_err)
    return 0 if n_err == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
