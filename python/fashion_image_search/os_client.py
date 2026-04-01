"""OpenSearch client from environment (same vars as Node config / .env)."""

from __future__ import annotations

import os
from urllib.parse import urlparse

from dotenv import load_dotenv
from opensearchpy import OpenSearch

load_dotenv()


def build_client() -> OpenSearch:
    node = (
        os.environ.get("OS_NODE")
        or os.environ.get("OPENSEARCH_NODE")
        or os.environ.get("OPENSEARCH_URL")
        or "http://localhost:9200"
    )
    parsed = urlparse(node)
    user = os.environ.get("OS_USERNAME") or os.environ.get("OPENSEARCH_USERNAME") or parsed.username or None
    password = os.environ.get("OS_PASSWORD") or os.environ.get("OPENSEARCH_PASSWORD") or parsed.password or None
    use_ssl = parsed.scheme == "https"
    hosts = [{"host": parsed.hostname or "localhost", "port": parsed.port or (443 if use_ssl else 9200), "scheme": parsed.scheme or "http"}]

    auth = (user, password) if user and password else None
    return OpenSearch(
        hosts=hosts,
        http_auth=auth,
        use_ssl=use_ssl,
        verify_certs=False,
        timeout=60,
        max_retries=3,
        retry_on_timeout=True,
    )


def index_name() -> str:
    return os.environ.get("OS_INDEX") or os.environ.get("OPENSEARCH_INDEX") or "products"
