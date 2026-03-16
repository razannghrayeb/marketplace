# Endpoint Matrix (Auto-Generated)

Generated at: 2026-03-15T12:42:37.044Z

Source of truth:
- Mounted prefixes from src/server.ts
- Route handlers parsed from src/routes/**/* where router.<method>("path") is used

## Endpoints

| Method | Path | Mount | Source |
|--------|------|-------|--------|
| GET | /admin/canonicals | /admin | src/routes/admin/index.ts |
| GET | /admin/canonicals/:id | /admin | src/routes/admin/index.ts |
| POST | /admin/canonicals/:id/detach/:productId | /admin | src/routes/admin/index.ts |
| POST | /admin/canonicals/merge | /admin | src/routes/admin/index.ts |
| POST | /admin/jobs/:type/run | /admin | src/routes/admin/index.ts |
| GET | /admin/jobs/history | /admin | src/routes/admin/index.ts |
| GET | /admin/jobs/metrics | /admin | src/routes/admin/index.ts |
| GET | /admin/jobs/schedules | /admin | src/routes/admin/index.ts |
| GET | /admin/products/:id/duplicates | /admin | src/routes/admin/index.ts |
| POST | /admin/products/:id/flag | /admin | src/routes/admin/index.ts |
| POST | /admin/products/:id/hide | /admin | src/routes/admin/index.ts |
| POST | /admin/products/:id/unflag | /admin | src/routes/admin/index.ts |
| POST | /admin/products/:id/unhide | /admin | src/routes/admin/index.ts |
| GET | /admin/products/flagged | /admin | src/routes/admin/index.ts |
| GET | /admin/products/hidden | /admin | src/routes/admin/index.ts |
| POST | /admin/products/hide-batch | /admin | src/routes/admin/index.ts |
| GET | /admin/reco/label | /admin | src/routes/admin/index.ts |
| POST | /admin/reco/label | /admin | src/routes/admin/index.ts |
| POST | /admin/reco/label/batch | /admin | src/routes/admin/index.ts |
| GET | /admin/reco/labels | /admin | src/routes/admin/index.ts |
| GET | /admin/reco/stats | /admin | src/routes/admin/index.ts |
| GET | /admin/stats | /admin | src/routes/admin/index.ts |
| POST | /api/compare | /api/compare | src/routes/compare/compare.controller.ts |
| POST | /api/compare/admin/compute-baselines | /api/compare | src/routes/compare/compare.controller.ts |
| POST | /api/compare/analyze-text | /api/compare | src/routes/compare/compare.controller.ts |
| GET | /api/compare/baseline/:category | /api/compare | src/routes/compare/compare.controller.ts |
| GET | /api/compare/price/:productId | /api/compare | src/routes/compare/compare.controller.ts |
| GET | /api/compare/quality/:productId | /api/compare | src/routes/compare/compare.controller.ts |
| GET | /api/compare/tooltips | /api/compare | src/routes/compare/compare.controller.ts |
| POST | /api/images/analyze | /api/images | src/routes/products/image-analysis.controller.ts |
| POST | /api/images/detect | /api/images | src/routes/products/image-analysis.controller.ts |
| POST | /api/images/detect/batch | /api/images | src/routes/products/image-analysis.controller.ts |
| POST | /api/images/detect/url | /api/images | src/routes/products/image-analysis.controller.ts |
| GET | /api/images/labels | /api/images | src/routes/products/image-analysis.controller.ts |
| POST | /api/images/search | /api/images | src/routes/products/image-analysis.controller.ts |
| POST | /api/images/search/url | /api/images | src/routes/products/image-analysis.controller.ts |
| GET | /api/images/status | /api/images | src/routes/products/image-analysis.controller.ts |
| GET | /api/ingest/:jobId | /api/ingest | src/routes/ingest/ingest.routes.ts |
| POST | /api/ingest/image | /api/ingest | src/routes/ingest/ingest.routes.ts |
| GET | /health/live | /health | src/routes/health/health.controller.ts |
| GET | /health/ready | /health | src/routes/health/health.controller.ts |
| GET | /metrics | /metrics | src/routes/metrics/index.ts |
| GET | /products | /products | src/routes/products/index.ts |
| GET | /products/:id/complete-style | /products | src/routes/products/index.ts |
| GET | /products/:id/images | /products | src/routes/products/index.ts |
| POST | /products/:id/images | /products | src/routes/products/index.ts |
| DELETE | /products/:id/images/:imageId | /products | src/routes/products/index.ts |
| PUT | /products/:id/images/:imageId/primary | /products | src/routes/products/index.ts |
| GET | /products/:id/price-history | /products | src/routes/products/index.ts |
| GET | /products/:id/recommendations | /products | src/routes/products/index.ts |
| GET | /products/:id/similar | /products | src/routes/products/index.ts |
| GET | /products/:id/style-profile | /products | src/routes/products/index.ts |
| POST | /products/complete-style | /products | src/routes/products/index.ts |
| GET | /products/facets | /products | src/routes/products/index.ts |
| GET | /products/price-drops | /products | src/routes/products/index.ts |
| GET | /products/price-drops | /products/price-drops | src/routes/products/index.ts |
| GET | /products/price-drops/:id/complete-style | /products/price-drops | src/routes/products/index.ts |
| GET | /products/price-drops/:id/images | /products/price-drops | src/routes/products/index.ts |
| POST | /products/price-drops/:id/images | /products/price-drops | src/routes/products/index.ts |
| DELETE | /products/price-drops/:id/images/:imageId | /products/price-drops | src/routes/products/index.ts |
| PUT | /products/price-drops/:id/images/:imageId/primary | /products/price-drops | src/routes/products/index.ts |
| GET | /products/price-drops/:id/price-history | /products/price-drops | src/routes/products/index.ts |
| GET | /products/price-drops/:id/recommendations | /products/price-drops | src/routes/products/index.ts |
| GET | /products/price-drops/:id/similar | /products/price-drops | src/routes/products/index.ts |
| GET | /products/price-drops/:id/style-profile | /products/price-drops | src/routes/products/index.ts |
| POST | /products/price-drops/complete-style | /products/price-drops | src/routes/products/index.ts |
| GET | /products/price-drops/facets | /products/price-drops | src/routes/products/index.ts |
| GET | /products/price-drops/price-drops | /products/price-drops | src/routes/products/index.ts |
| POST | /products/price-drops/recommendations/batch | /products/price-drops | src/routes/products/index.ts |
| GET | /products/price-drops/search | /products/price-drops | src/routes/products/index.ts |
| POST | /products/price-drops/search/image | /products/price-drops | src/routes/products/index.ts |
| POST | /products/recommendations/batch | /products | src/routes/products/index.ts |
| GET | /products/search | /products | src/routes/products/index.ts |
| POST | /products/search/image | /products | src/routes/products/index.ts |
| GET | /search | /search | src/routes/search/search.controller.ts |
| POST | /search/image | /search | src/routes/search/search.controller.ts |
| POST | /search/multi-image | /search | src/routes/search/search.controller.ts |
| POST | /search/multi-vector | /search | src/routes/search/search.controller.ts |

## Regeneration

Run one of:
- pnpm docs:endpoints
- npx tsx scripts/generate-endpoint-matrix.ts
