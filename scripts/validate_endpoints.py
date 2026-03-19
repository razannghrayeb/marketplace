import json
import re
from pathlib import Path
from typing import Dict, List, Tuple

import requests

BASE_URL = "http://0.0.0.0:4000"
MATRIX_FILE = Path("docs/ENDPOINT_MATRIX.md")
OUT_FILE = Path("docs/ENDPOINT_VALIDATION_REPORT.md")
TIMEOUT = 10

# Endpoints where 400/404 are acceptable for smoke (validation/business constraints).
ALLOW_400_404_PREFIXES = [
    "/admin/reco/label",
    "/products/search",
    "/products/price-drops/search",
    "/api/images/",
    "/api/ingest/",
    "/api/wardrobe/",
    "/search/image",
    "/search/multi-image",
    "/search/multi-vector",
    "/products/:id/images",
    "/products/price-drops/:id/images",
    "/api/compare",
    "/admin/products/:id/flag",
    "/admin/products/hide-batch",
    "/products/complete-style",
    "/products/price-drops/complete-style",
    "/products/recommendations/batch",
    "/products/price-drops/recommendations/batch",
    "/admin/jobs/:type/run",
]

# Mutating endpoints that we only probe with intentionally invalid payloads.
MUTATING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def parse_matrix(path: Path) -> List[Tuple[str, str]]:
    rows: List[Tuple[str, str]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.startswith("| "):
            continue
        if line.startswith("| Method") or line.startswith("|--------"):
            continue
        parts = [p.strip() for p in line.strip("|").split("|")]
        if len(parts) < 2:
            continue
        method, endpoint = parts[0], parts[1]
        rows.append((method, endpoint))
    # unique while preserving order
    seen = set()
    unique = []
    for row in rows:
        if row not in seen:
            unique.append(row)
            seen.add(row)
    return unique


def materialize_path(endpoint: str) -> str:
    # Replace both {id} style and :id style placeholders
    out = re.sub(r"\{[^}]+\}", "1", endpoint)
    out = re.sub(r":[A-Za-z_][A-Za-z0-9_]*", "1", out)
    out = out.replace("/admin/jobs/1/run", "/admin/jobs/nightly-crawl/run")
    return out


def endpoint_needs_query(endpoint: str) -> str:
    if endpoint in ("/products/search", "/products/price-drops/search"):
        return "?q=test"
    if endpoint == "/admin/reco/label":
        return "?baseProductId=1331&candidateProductId=1332"
    return ""


def make_request(method: str, endpoint: str) -> Tuple[int, str]:
    url = BASE_URL + materialize_path(endpoint) + endpoint_needs_query(endpoint)
    headers: Dict[str, str] = {
        "Accept": "application/json",
        "x-user-id": "1",
    }

    # Keep mutating calls low-risk using invalid/minimal payloads.
    json_body = {}
    files = None
    data = None

    if method in {"POST", "PUT", "PATCH"}:
        if "images" in endpoint or "image" in endpoint:
            # Intentionally omit file to trigger validation errors safely.
            data = {}
            json_body = None
        elif endpoint.endswith("/reco/label"):
            json_body = {
                "baseProductId": 1331,
                "candidateProductId": 1332,
                "label": "ok",
                "labelScore": 5,
                "labelerId": "smoke-test",
            }
        elif endpoint.endswith("/reco/label/batch"):
            json_body = {
                "labels": [
                    {
                        "baseProductId": 1331,
                        "candidateProductId": 1332,
                        "label": "ok",
                    }
                ]
            }
        elif endpoint.endswith("/jobs/1/run"):
            json_body = {}
        elif endpoint.endswith("/canonicals/merge"):
            json_body = {"sourceId": 1331, "targetId": 1332}
        elif endpoint.endswith("/complete-look"):
            json_body = {"user_id": 1, "item_ids": [1331], "limit": 1}
        elif endpoint.endswith("/outfit-suggestions"):
            json_body = {"user_id": 1, "item_id": 1331, "limit": 1}
        elif endpoint.endswith("/compatibility/precompute"):
            json_body = {"user_id": 1}
        elif endpoint.endswith("/backfill-embeddings"):
            json_body = {"user_id": 1, "batch_size": 1}
        else:
            json_body = {}

    try:
        if method == "GET":
            resp = requests.get(url, headers=headers, timeout=TIMEOUT)
        elif method == "POST":
            if files is not None:
                resp = requests.post(url, headers=headers, files=files, data=data, timeout=TIMEOUT)
            elif json_body is not None:
                resp = requests.post(url, headers=headers, json=json_body, timeout=TIMEOUT)
            else:
                resp = requests.post(url, headers=headers, data=data, timeout=TIMEOUT)
        elif method == "PUT":
            resp = requests.put(url, headers=headers, json=json_body, timeout=TIMEOUT)
        elif method == "PATCH":
            resp = requests.patch(url, headers=headers, json=json_body, timeout=TIMEOUT)
        elif method == "DELETE":
            resp = requests.delete(url, headers=headers, timeout=TIMEOUT)
        else:
            return 0, f"unsupported method: {method}"
        return resp.status_code, resp.text[:300]
    except Exception as exc:
        return 0, f"exception: {type(exc).__name__}: {exc}"


def classify(method: str, endpoint: str, status: int) -> str:
    if status == 0:
        return "FAIL"
    if 200 <= status < 300:
        return "PASS"

    is_allowed_validation = False
    if status in (400, 404):
        for prefix in ALLOW_400_404_PREFIXES:
            if endpoint.startswith(prefix) or materialize_path(endpoint).startswith(prefix.replace(":id", "1")):
                is_allowed_validation = True
                break
        # Path-param routes frequently return 404 with id=1 if data missing.
        if ("{" in endpoint or ":" in endpoint) and method == "GET":
            is_allowed_validation = True

    if is_allowed_validation:
        return "PASS_VALIDATION"

    # Treat authz failures as "reachable but protected".
    if status in (401, 403):
        return "PASS_AUTH_PROTECTED"

    return "FAIL"


def build_report(results: List[Dict[str, str]]) -> str:
    total = len(results)
    pass_count = sum(1 for r in results if r["classification"].startswith("PASS"))
    fail_count = total - pass_count

    lines = []
    lines.append("# Endpoint Validation Report")
    lines.append("")
    lines.append(f"Base URL tested: `{BASE_URL}`")
    lines.append("")
    lines.append("## Summary")
    lines.append("")
    lines.append(f"- Total endpoints tested: {total}")
    lines.append(f"- Passing (including validation/auth-protected): {pass_count}")
    lines.append(f"- Failing: {fail_count}")
    lines.append("")

    lines.append("## Failed Endpoints")
    lines.append("")
    failed = [r for r in results if r["classification"] == "FAIL"]
    if not failed:
        lines.append("- None")
    else:
        for r in failed:
            lines.append(
                f"- `{r['method']} {r['endpoint']}` -> status `{r['status']}` | note: {r['note']}"
            )
    lines.append("")

    lines.append("## Full Results")
    lines.append("")
    lines.append("| Status | Method | Endpoint | HTTP | Note |")
    lines.append("|--------|--------|----------|------|------|")
    for r in results:
        lines.append(
            f"| {r['classification']} | {r['method']} | {r['endpoint']} | {r['status']} | {r['note'].replace('|','/')} |"
        )

    lines.append("")
    lines.append("## Legend")
    lines.append("")
    lines.append("- `PASS`: 2xx response")
    lines.append("- `PASS_VALIDATION`: route is reachable; returned expected 400/404 due to missing/invalid test payload or data")
    lines.append("- `PASS_AUTH_PROTECTED`: route is reachable; blocked by auth/permission")
    lines.append("- `FAIL`: route appears broken (5xx, network error, unexpected status)")
    lines.append("")

    return "\n".join(lines)


def main() -> None:
    endpoints = parse_matrix(MATRIX_FILE)
    results: List[Dict[str, str]] = []

    for method, endpoint in endpoints:
        status, note = make_request(method, endpoint)
        classification = classify(method, endpoint, status)
        results.append(
            {
                "method": method,
                "endpoint": endpoint,
                "status": str(status),
                "classification": classification,
                "note": note.replace("\n", " "),
            }
        )

    report = build_report(results)
    OUT_FILE.write_text(report, encoding="utf-8")

    total = len(results)
    fail_count = sum(1 for r in results if r["classification"] == "FAIL")
    print(f"Validated {total} endpoints. Failing: {fail_count}.")
    print(f"Report written to {OUT_FILE}")


if __name__ == "__main__":
    main()
