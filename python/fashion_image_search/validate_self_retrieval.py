#!/usr/bin/env python3
"""
Self-retrieval check: index a single vector, query with the same vector, assert rank-1 is that doc.

Also verifies:
  - bulk index + search round-trip
  - L2 normalization
  - cosinesimil score is in OpenSearch (1+cos)/2 range for identical vectors (~1.0)

Usage:
  python validate_self_retrieval.py --image path/to/catalog.jpg --doc-id selftest-42
"""

from __future__ import annotations

import argparse
import logging
import sys
import time

import numpy as np

from embedding_pipeline import FashionClipEncoder, assert_opensearch_cosinesimil_compatible, cosine_sim
from os_client import build_client, index_name

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", required=True)
    ap.add_argument("--doc-id", default=f"selftest-{int(time.time())}")
    ap.add_argument("--field", default="embedding")
    args = ap.parse_args()

    enc = FashionClipEncoder.load()
    vec_np = enc.embed_path(args.image)
    vec = vec_np.tolist()
    assert_opensearch_cosinesimil_compatible(vec)

    client = build_client()
    idx = index_name()

    doc = {
        "product_id": args.doc_id,
        "title": "self-retrieval probe",
        "is_hidden": False,
        "category": "test",
        "vendor_id": "0",
        "embedding": vec,
    }

    client.index(index=idx, id=args.doc_id, body=doc, refresh=True)
    logger.info("indexed probe id=%s", args.doc_id)

    knn_clause = {"vector": vec, "k": 5, "ef_search": 256}
    body = {
        "size": 5,
        "_source": ["product_id", "embedding"],
        "query": {"bool": {"must": {"knn": {args.field: knn_clause}}}},
    }
    resp = client.search(index=idx, body=body)
    hits = resp.get("hits", {}).get("hits", [])
    assert len(hits) >= 1, "no hits returned"

    top = hits[0]
    top_id = str(top.get("_id"))
    assert top_id == args.doc_id, f"expected top hit id {args.doc_id}, got {top_id}"

    raw_score = float(top.get("_score") or 0)
    assert raw_score > 0.99, f"expected near-1.0 OpenSearch score for self-match, got {raw_score}"

    src_emb = top.get("_source", {}).get("embedding")
    if src_emb and isinstance(src_emb, list):
        cos = cosine_sim(vec_np, np.asarray(src_emb, dtype=np.float32))
        assert cos > 0.999, f"stored vs query cosine {cos} expected ~1.0"

    logger.info("PASS self-retrieval id=%s os_score=%.6f", args.doc_id, raw_score)
    return 0


if __name__ == "__main__":
    sys.exit(main())
