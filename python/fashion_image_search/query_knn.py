#!/usr/bin/env python3
"""
kNN image query against OpenSearch (cosinesimil).

Usage:
  python query_knn.py --image path/to/query.jpg --k 20
"""

from __future__ import annotations

import argparse
import logging
import sys

from embedding_pipeline import FashionClipEncoder, assert_opensearch_cosinesimil_compatible
from os_client import build_client, index_name

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", required=True)
    ap.add_argument("--k", type=int, default=20)
    ap.add_argument("--field", default="embedding", help="embedding | embedding_garment")
    ap.add_argument("--ef-search", type=int, default=128)
    args = ap.parse_args()

    enc = FashionClipEncoder.load()
    vec = enc.embed_path(args.image).tolist()
    assert_opensearch_cosinesimil_compatible(vec)

    client = build_client()
    idx = index_name()

    knn_clause: dict = {"vector": vec, "k": args.k}
    if args.ef_search > 0:
        knn_clause["ef_search"] = args.ef_search

    body = {
        "size": args.k,
        "_source": ["product_id", "title", "category", "image_cdn"],
        "query": {
            "bool": {
                "must": {"knn": {args.field: knn_clause}},
                "filter": [{"term": {"is_hidden": False}}],
            }
        },
    }

    resp = client.search(index=idx, body=body)
    hits = resp.get("hits", {}).get("hits", [])
    logger.info("hits=%s", len(hits))
    for i, h in enumerate(hits, 1):
        src = h.get("_source") or {}
        logger.info(
            "%s. id=%s score=%.6f product_id=%s title=%s",
            i,
            h.get("_id"),
            float(h.get("_score") or 0),
            src.get("product_id"),
            (src.get("title") or "")[:80],
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
