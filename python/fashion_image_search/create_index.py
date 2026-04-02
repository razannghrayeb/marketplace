#!/usr/bin/env python3
"""
Create OpenSearch index with kNN mapping (idempotent: skips if exists).

Usage:
  python create_index.py
  python create_index.py --recreate   # delete then create
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys

from os_client import build_client, index_name

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

HERE = os.path.dirname(os.path.abspath(__file__))


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--recreate", action="store_true")
    args = p.parse_args()

    client = build_client()
    idx = index_name()
    mapping_path = os.path.join(HERE, "opensearch_products_mapping.json")
    with open(mapping_path, encoding="utf-8") as f:
        body = json.load(f)

    exists = client.indices.exists(index=idx)
    if exists and args.recreate:
        logger.warning("Deleting index %s", idx)
        client.indices.delete(index=idx)
        exists = False

    if not exists:
        client.indices.create(index=idx, body=body)
        logger.info("Created index %s", idx)
    else:
        logger.info("Index %s already exists — skip", idx)

    return 0


if __name__ == "__main__":
    sys.exit(main())
