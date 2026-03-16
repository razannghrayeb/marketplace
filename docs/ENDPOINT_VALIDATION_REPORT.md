# Endpoint Validation Report

Base URL tested: `http://localhost:4000`

## Summary

- Total endpoints tested: 77
- Passing (including validation/auth-protected): 55
- Failing: 22

## Failed Endpoints

- `GET /admin/canonicals` -> status `500` | note: {"success":false,"error":"relation \"canonical_products\" does not exist"}
- `GET /admin/canonicals/:id` -> status `500` | note: {"success":false,"error":"relation \"canonical_products\" does not exist"}
- `POST /admin/canonicals/:id/detach/:productId` -> status `500` | note: {"success":false,"error":"column \"canonical_id\" does not exist"}
- `POST /admin/canonicals/merge` -> status `500` | note: {"success":false,"error":"column \"canonical_id\" does not exist"}
- `GET /admin/jobs/history` -> status `500` | note: {"success":false,"error":"relation \"job_schedules\" does not exist"}
- `POST /admin/products/:id/hide` -> status `500` | note: {"success":false,"error":"column \"flag_reason\" does not exist"}
- `POST /admin/products/:id/unflag` -> status `500` | note: {"success":false,"error":"column \"is_flagged\" of relation \"products\" does not exist"}
- `POST /admin/products/:id/unhide` -> status `500` | note: {"success":false,"error":"column \"is_hidden\" of relation \"products\" does not exist"}
- `GET /admin/products/flagged` -> status `500` | note: {"success":false,"error":"column \"is_flagged\" does not exist"}
- `GET /admin/products/hidden` -> status `500` | note: {"success":false,"error":"column \"source\" does not exist"}
- `GET /admin/reco/label` -> status `500` | note: {"success":false,"error":"relation \"recommendation_impressions\" does not exist"}
- `POST /admin/reco/label` -> status `500` | note: {"success":false,"error":"relation \"recommendation_labels\" does not exist"}
- `GET /admin/reco/labels` -> status `500` | note: {"success":false,"error":"relation \"recommendation_labels\" does not exist"}
- `GET /admin/reco/stats` -> status `500` | note: {"success":false,"error":"relation \"recommendation_labels\" does not exist"}
- `GET /admin/stats` -> status `500` | note: {"success":false,"error":"column \"is_hidden\" does not exist"}
- `POST /api/compare/admin/compute-baselines` -> status `500` | note: {"error":"Failed to compute baselines"}
- `GET /api/compare/price/:productId` -> status `500` | note: {"error":"Failed to analyze price"}
- `GET /api/compare/quality/:productId` -> status `500` | note: {"error":"Failed to analyze product quality"}
- `GET /api/images/labels` -> status `500` | note: {"success":false,"error":"fetch failed"}
- `GET /api/ingest/:jobId` -> status `500` | note: {"success":false,"error":"relation \"ingest_jobs\" does not exist"}
- `GET /products/facets` -> status `500` | note: {"success":false,"error":"Failed to fetch facets"}
- `GET /products/price-drops/facets` -> status `500` | note: {"success":false,"error":"Failed to fetch facets"}

## Full Results

| Status | Method | Endpoint | HTTP | Note |
|--------|--------|----------|------|------|
| FAIL | GET | /admin/canonicals | 500 | {"success":false,"error":"relation \"canonical_products\" does not exist"} |
| FAIL | GET | /admin/canonicals/:id | 500 | {"success":false,"error":"relation \"canonical_products\" does not exist"} |
| FAIL | POST | /admin/canonicals/:id/detach/:productId | 500 | {"success":false,"error":"column \"canonical_id\" does not exist"} |
| FAIL | POST | /admin/canonicals/merge | 500 | {"success":false,"error":"column \"canonical_id\" does not exist"} |
| PASS | POST | /admin/jobs/:type/run | 200 | {"success":true,"jobId":"3","message":"Job nightly-crawl queued"} |
| FAIL | GET | /admin/jobs/history | 500 | {"success":false,"error":"relation \"job_schedules\" does not exist"} |
| PASS | GET | /admin/jobs/metrics | 200 | {"waiting":0,"active":0,"completed":0,"failed":0,"delayed":0} |
| PASS | GET | /admin/jobs/schedules | 200 | {"schedules":[]} |
| PASS | GET | /admin/products/:id/duplicates | 200 | {"duplicates":[]} |
| PASS_VALIDATION | POST | /admin/products/:id/flag | 400 | {"error":"Reason is required"} |
| FAIL | POST | /admin/products/:id/hide | 500 | {"success":false,"error":"column \"flag_reason\" does not exist"} |
| FAIL | POST | /admin/products/:id/unflag | 500 | {"success":false,"error":"column \"is_flagged\" of relation \"products\" does not exist"} |
| FAIL | POST | /admin/products/:id/unhide | 500 | {"success":false,"error":"column \"is_hidden\" of relation \"products\" does not exist"} |
| FAIL | GET | /admin/products/flagged | 500 | {"success":false,"error":"column \"is_flagged\" does not exist"} |
| FAIL | GET | /admin/products/hidden | 500 | {"success":false,"error":"column \"source\" does not exist"} |
| PASS_VALIDATION | POST | /admin/products/hide-batch | 400 | {"error":"productIds array is required"} |
| FAIL | GET | /admin/reco/label | 500 | {"success":false,"error":"relation \"recommendation_impressions\" does not exist"} |
| FAIL | POST | /admin/reco/label | 500 | {"success":false,"error":"relation \"recommendation_labels\" does not exist"} |
| PASS | POST | /admin/reco/label/batch | 200 | {"success":true,"savedCount":0,"message":"0 labels saved"} |
| FAIL | GET | /admin/reco/labels | 500 | {"success":false,"error":"relation \"recommendation_labels\" does not exist"} |
| FAIL | GET | /admin/reco/stats | 500 | {"success":false,"error":"relation \"recommendation_labels\" does not exist"} |
| FAIL | GET | /admin/stats | 500 | {"success":false,"error":"column \"is_hidden\" does not exist"} |
| PASS_VALIDATION | POST | /api/compare | 400 | {"error":"At least 2 product IDs required","example":{"product_ids":[123,456]}} |
| FAIL | POST | /api/compare/admin/compute-baselines | 500 | {"error":"Failed to compute baselines"} |
| PASS_VALIDATION | POST | /api/compare/analyze-text | 400 | {"error":"Title is required"} |
| PASS_VALIDATION | GET | /api/compare/baseline/:category | 404 | {"error":"No baseline found for category","category":"1"} |
| FAIL | GET | /api/compare/price/:productId | 500 | {"error":"Failed to analyze price"} |
| FAIL | GET | /api/compare/quality/:productId | 500 | {"error":"Failed to analyze product quality"} |
| PASS | GET | /api/compare/tooltips | 200 | {"better_description_quality":"This product has more complete description including fabric, fit, and sizing details","stable_pricing":"Price has remained stable over time, indicating reliable pricing","original_images":"Product images appear unique and not widely reused across other listings","clear |
| PASS_VALIDATION | POST | /api/images/analyze | 400 | {"success":false,"error":"No image file provided. Use 'image' field in multipart/form-data."} |
| PASS_VALIDATION | POST | /api/images/detect | 400 | {"success":false,"error":"No image file provided. Use 'image' field in multipart/form-data."} |
| PASS_VALIDATION | POST | /api/images/detect/batch | 400 | {"success":false,"error":"No image files provided. Use 'images' field in multipart/form-data."} |
| PASS_VALIDATION | POST | /api/images/detect/url | 400 | {"success":false,"error":"No image URL provided. Send JSON with 'url' field."} |
| FAIL | GET | /api/images/labels | 500 | {"success":false,"error":"fetch failed"} |
| PASS_VALIDATION | POST | /api/images/search | 400 | {"success":false,"error":"No image file provided. Use 'image' field in multipart/form-data."} |
| PASS_VALIDATION | POST | /api/images/search/url | 400 | {"success":false,"error":"No image URL provided. Send JSON with 'url' field."} |
| PASS | GET | /api/images/status | 200 | {"ok":true,"services":{"clip":true,"yolo":false,"blip":true}} |
| FAIL | GET | /api/ingest/:jobId | 500 | {"success":false,"error":"relation \"ingest_jobs\" does not exist"} |
| PASS_VALIDATION | POST | /api/ingest/image | 400 | {"success":false,"error":"No image file provided"} |
| PASS | GET | /health/live | 200 | {"ok":true} |
| PASS | GET | /health/ready | 200 | {"ok":true,"search":"yellow","db":"ok"} |
| PASS | GET | /metrics | 200 | # HELP process_cpu_user_seconds_total Total user CPU time spent in seconds. # TYPE process_cpu_user_seconds_total counter process_cpu_user_seconds_total 8.61  # HELP process_cpu_system_seconds_total Total system CPU time spent in seconds. # TYPE process_cpu_system_seconds_total counter process_cpu_s |
| PASS | GET | /products | 200 | {"success":true,"data":[],"pagination":{"page":1,"limit":20}} |
| PASS_VALIDATION | GET | /products/:id/complete-style | 404 | {"error":"Product not found"} |
| PASS | GET | /products/:id/images | 200 | {"success":true,"data":[]} |
| PASS_VALIDATION | POST | /products/:id/images | 404 | {"success":false,"error":"Product not found"} |
| PASS_VALIDATION | DELETE | /products/:id/images/:imageId | 404 | {"success":false,"error":"Image not found"} |
| PASS_VALIDATION | PUT | /products/:id/images/:imageId/primary | 404 | {"success":false,"error":"Image not found"} |
| PASS | GET | /products/:id/price-history | 200 | {"success":true,"data":{"history":[],"stats":null}} |
| PASS_VALIDATION | GET | /products/:id/recommendations | 404 | {"error":"Product not found","message":"Product not found: 1"} |
| PASS | GET | /products/:id/similar | 200 | {"success":true,"candidates":[],"meta":{"baseProductId":"1","clipCandidates":0,"textCandidates":0,"mergedTotal":0,"pHashFiltered":0,"finalCount":0}} |
| PASS_VALIDATION | GET | /products/:id/style-profile | 404 | {"error":"Product not found"} |
| PASS_VALIDATION | POST | /products/complete-style | 400 | {"error":"Product with title is required"} |
| FAIL | GET | /products/facets | 500 | {"success":false,"error":"Failed to fetch facets"} |
| PASS | GET | /products/price-drops | 200 | {"success":true,"data":[]} |
| PASS_VALIDATION | GET | /products/price-drops/:id/complete-style | 404 | {"error":"Product not found"} |
| PASS | GET | /products/price-drops/:id/images | 200 | {"success":true,"data":[]} |
| PASS_VALIDATION | POST | /products/price-drops/:id/images | 404 | {"success":false,"error":"Product not found"} |
| PASS_VALIDATION | DELETE | /products/price-drops/:id/images/:imageId | 404 | {"success":false,"error":"Image not found"} |
| PASS_VALIDATION | PUT | /products/price-drops/:id/images/:imageId/primary | 404 | {"success":false,"error":"Image not found"} |
| PASS | GET | /products/price-drops/:id/price-history | 200 | {"success":true,"data":{"history":[],"stats":null}} |
| PASS_VALIDATION | GET | /products/price-drops/:id/recommendations | 404 | {"error":"Product not found","message":"Product not found: 1"} |
| PASS | GET | /products/price-drops/:id/similar | 200 | {"success":true,"candidates":[],"meta":{"baseProductId":"1","clipCandidates":0,"textCandidates":0,"mergedTotal":0,"pHashFiltered":0,"finalCount":0}} |
| PASS_VALIDATION | GET | /products/price-drops/:id/style-profile | 404 | {"error":"Product not found"} |
| PASS_VALIDATION | POST | /products/price-drops/complete-style | 400 | {"error":"Product with title is required"} |
| FAIL | GET | /products/price-drops/facets | 500 | {"success":false,"error":"Failed to fetch facets"} |
| PASS | GET | /products/price-drops/price-drops | 200 | {"success":true,"data":[]} |
| PASS_VALIDATION | POST | /products/price-drops/recommendations/batch | 400 | {"error":"Invalid request","message":"productIds must be a non-empty array"} |
| PASS | GET | /products/price-drops/search | 200 | {"success":true,"data":[],"meta":{"query":"test","total_results":0,"total_related":0,"parsed_query":{"originalQuery":"test","normalizedQuery":"test","entities":{"brands":[],"categories":[],"colors":[],"sizes":[],"attributes":[]},"intent":"product_search","expandedTerms":[],"semanticQuery":"test"},"p |
| PASS_VALIDATION | POST | /products/price-drops/search/image | 400 | {"success":false,"error":"Upload an image file or provide an embedding array"} |
| PASS_VALIDATION | POST | /products/recommendations/batch | 400 | {"error":"Invalid request","message":"productIds must be a non-empty array"} |
| PASS | GET | /products/search | 200 | {"success":true,"data":[],"meta":{"query":"test","total_results":0,"total_related":0,"parsed_query":{"originalQuery":"test","normalizedQuery":"test","entities":{"brands":[],"categories":[],"colors":[],"sizes":[],"attributes":[]},"intent":"product_search","expandedTerms":[],"semanticQuery":"test"},"p |
| PASS_VALIDATION | POST | /products/search/image | 400 | {"success":false,"error":"Upload an image file or provide an embedding array"} |
| PASS | GET | /search | 200 | {"results":[{"brand":"Adidas","category":"bottoms","score":1},{"brand":"Levi's","category":"bottoms","score":1},{"brand":"Nike","category":"tops","score":1}],"total":3,"tookMs":281,"query":{"original":"","searchQuery":"","intent":{"type":"search","confidence":0.7},"entities":{"brands":[],"categories |
| PASS_VALIDATION | POST | /search/image | 400 | {"error":"Image file is required"} |
| PASS_VALIDATION | POST | /search/multi-image | 400 | {"error":"At least one image is required"} |
| PASS_VALIDATION | POST | /search/multi-vector | 400 | {"error":"At least one image is required"} |

## Legend

- `PASS`: 2xx response
- `PASS_VALIDATION`: route is reachable; returned expected 400/404 due to missing/invalid test payload or data
- `PASS_AUTH_PROTECTED`: route is reachable; blocked by auth/permission
- `FAIL`: route appears broken (5xx, network error, unexpected status)
