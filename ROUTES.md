# API Routes Documentation

This document describes what each route does by feature.

## Base Notes

- API + ML routes are mounted in `src/server.ts`.
- Some routes are available only when specific `SERVICE_ROLE` values are enabled.
- Paths below are shown as full mounted paths.

## Health

Base path: `/health`

- `GET /health/ready` - Readiness check (dependencies available).
- `GET /health/live` - Liveness check (service process is running).
- `GET /health/detailed` - Detailed health report (includes internals like breakers/cache status).

## Metrics

Base path: `/metrics`

- `GET /metrics` - Prometheus metrics payload for monitoring/scraping.

## Admin

Base path: `/admin`  
Auth: `requireAuth + requireAdmin`

- `POST /admin/products/:id/hide` - Hide one product from normal visibility.
- `POST /admin/products/:id/unhide` - Unhide a previously hidden product.
- `POST /admin/products/:id/flag` - Flag a product for moderation review.
- `POST /admin/products/:id/unflag` - Remove moderation flag from a product.
- `POST /admin/products/hide-batch` - Hide multiple products in one request.
- `GET /admin/products/flagged` - List flagged products.
- `GET /admin/products/hidden` - List hidden products.
- `GET /admin/products/:id/duplicates` - Find likely duplicate products for a product id.
- `GET /admin/canonicals` - List canonical groups/entities.
- `GET /admin/canonicals/:id` - Get one canonical entity details.
- `POST /admin/canonicals/merge` - Merge canonical entities.
- `POST /admin/canonicals/:id/detach/:productId` - Detach product from canonical.
- `POST /admin/jobs/:type/run` - Trigger a background/admin job manually.
- `GET /admin/jobs/schedules` - Show configured job schedules.
- `GET /admin/jobs/metrics` - Show job execution metrics.
- `GET /admin/jobs/history` - Show job run history.
- `GET /admin/stats` - Dashboard/admin summary stats.
- `GET /admin/reco/label` - Fetch recommendations that need labeling.
- `POST /admin/reco/label` - Save one recommendation label.
- `POST /admin/reco/label/batch` - Save labels in bulk.
- `GET /admin/reco/labels` - Export/list labeled recommendation data.
- `GET /admin/reco/stats` - Recommendation-labeling statistics.

## Auth

Base path: `/api/auth`

- `POST /api/auth/signup` - Register a user account.
- `POST /api/auth/login` - Authenticate and issue tokens.
- `POST /api/auth/refresh` - Rotate/refresh access token.
- `POST /api/auth/logout` - Invalidate session/refresh token.
- `GET /api/auth/me` - Get current authenticated user profile.
- `PATCH /api/auth/me` - Update current user profile fields.

## Cart

Base path: `/api/cart`  
Auth: required for all routes

- `GET /api/cart` - Get current user's cart.
- `POST /api/cart` - Add product to cart.
- `PATCH /api/cart/:productId` - Update product quantity in cart.
- `DELETE /api/cart/clear` - Remove all cart items.
- `DELETE /api/cart/:productId` - Remove one product from cart.

## Favorites

Base path: `/api/favorites`  
Auth: required for all routes

- `GET /api/favorites` - List current user's favorite products.
- `POST /api/favorites/toggle` - Toggle favorite status for a product.
- `GET /api/favorites/check/:productId` - Check if one product is favorited.
- `POST /api/favorites/check` - Batch check favorite status for multiple product ids.

## Compare

Base path: `/api/compare`

- `POST /api/compare` - Compare 2-5 products and return verdict/explanations.
- `GET /api/compare/quality/:productId` - Quality signal breakdown for one product.
- `POST /api/compare/analyze-text` - Quality analysis for raw text (no product required).
- `GET /api/compare/price/:productId` - Price anomaly/risk analysis for one product.
- `GET /api/compare/baseline/:category` - Get category price baseline.
- `POST /api/compare/admin/compute-baselines` - Recompute category baselines.
- `GET /api/compare/tooltips` - Static tooltip content for compare reason labels.
- `GET /api/compare/reviews/:productId` - Review sentiment/quality analysis for one product.
- `POST /api/compare/reviews` - Compare review analysis across multiple products.

## Search

Base path: `/search`

- `GET /search` - Main product search endpoint (query + filters).
- `POST /search/image` - Search by one uploaded image.
- `POST /search/multi-image` - Search by multiple uploaded images.
- `POST /search/multi-vector` - Multi-image/vector-assisted search flow.
- `GET /search/autocomplete` - Query suggestions/autocomplete terms.
- `GET /search/trending` - Trending searches/products.
- `GET /search/popular` - Popular search/product signals.
- `GET /search/session/:sessionId` - Get saved search session details.
- `GET /search/prompt-templates` - Prompt templates for guided AI search input.
- `POST /search/prompt-analyze` - Analyze natural-language prompt into structured intent.
- `GET /search/prompt-suggestions` - Suggested prompts/prompts assistance.

## Products

Base path: `/products`

- `GET /products` - List products.
- `GET /products/facets` - Aggregated filter facets for product discovery.
- `GET /products/search` - Title/text search over products.
- `POST /products/search/image` - Search products by uploaded image.
- `GET /products/:id/price-history` - Price history timeline for a product.
- `GET /products/:id/similar` - Similar products (legacy candidate retrieval).
- `GET /products/:id/recommendations` - ML-ranked recommendations for product.
- `POST /products/recommendations/batch` - Batch recommendations for multiple products.
- `GET /products/price-drops` - Products with recent/meaningful price drops.
- `GET /products/:id/complete-style` - Outfit completion suggestions for product.
- `GET /products/:id/style-profile` - Style profile generated for product.
- `POST /products/complete-style` - Outfit completion from body payload (not only path id).
- `GET /products/:id/images` - List product images.
- `POST /products/:id/images` - Upload and attach product image.
- `PUT /products/:id/images/:imageId/primary` - Set primary image.
- `DELETE /products/:id/images/:imageId` - Remove product image.

## Image Analysis

Base path: `/api/images`

- `GET /api/images/status` - Health/status for image-analysis dependencies/services.
- `GET /api/images/labels` - Supported labels/categories for fashion detection.
- `POST /api/images/analyze` - Full image analysis pipeline on uploaded image.
- `POST /api/images/search` - Search products from uploaded image analysis.
- `POST /api/images/search/selective` - Search using selected detections/parts from image.
- `POST /api/images/search/url` - Same search flow using image URL input.
- `POST /api/images/detect` - Object/garment detection on uploaded image.
- `POST /api/images/detect/url` - Detection on image provided by URL.
- `POST /api/images/detect/batch` - Batch detection for multiple uploaded images.

## Ingest

Base path: `/api/ingest`

- `POST /api/ingest/image` - Upload image and enqueue processing job.
- `GET /api/ingest/:jobId` - Retrieve ingest job status/result.

## Labeling

Base path: `/api/labeling`

- `GET /api/labeling/tasks` - Get labeling tasks queue/list.
- `POST /api/labeling/tasks/:id/assign` - Assign a task to a labeler.
- `POST /api/labeling/tasks/:id/submit` - Submit labels for task.
- `POST /api/labeling/tasks/:id/skip` - Skip a labeling task.
- `GET /api/labeling/stats` - Labeling throughput/quality statistics.
- `POST /api/labeling/queue` - Queue new items for labeling.
- `GET /api/labeling/categories` - Reference categories for labeling UI.
- `GET /api/labeling/patterns` - Reference patterns for labeling UI.
- `GET /api/labeling/materials` - Reference materials for labeling UI.

## Wardrobe

Base path: `/api/wardrobe`  
Auth: required for all routes

- `GET /api/wardrobe/items` - List wardrobe items.
- `POST /api/wardrobe/items` - Create wardrobe item (supports image upload).
- `GET /api/wardrobe/items/:id` - Get wardrobe item details.
- `PATCH /api/wardrobe/items/:id` - Update wardrobe item metadata.
- `DELETE /api/wardrobe/items/:id` - Delete wardrobe item.
- `GET /api/wardrobe/profile` - Get user style profile derived from wardrobe.
- `POST /api/wardrobe/profile/recompute` - Rebuild style profile.
- `GET /api/wardrobe/gaps` - Gap analysis (missing essentials/opportunities).
- `GET /api/wardrobe/recommendations` - Personalized recommendations from wardrobe context.
- `GET /api/wardrobe/compatibility/score` - Compatibility score overview.
- `GET /api/wardrobe/compatibility/:itemId` - Compatible items for one wardrobe item.
- `POST /api/wardrobe/compatibility/precompute` - Precompute compatibility graph/scores.
- `POST /api/wardrobe/outfit-suggestions` - Generate outfit suggestions.
- `POST /api/wardrobe/complete-look` - Build complete look from wardrobe context.
- `POST /api/wardrobe/backfill-embeddings` - Backfill embeddings for wardrobe items.
- `GET /api/wardrobe/similar/:itemId` - Similar wardrobe items.
- `GET /api/wardrobe/auto-sync/settings` - Get wardrobe auto-sync configuration.
- `PUT /api/wardrobe/auto-sync/settings` - Update wardrobe auto-sync configuration.
- `POST /api/wardrobe/auto-sync/manual` - Trigger manual purchase/wardrobe sync.
- `POST /api/wardrobe/analyze-photo` - Analyze one wardrobe photo.
- `POST /api/wardrobe/analyze-photos/batch` - Analyze multiple wardrobe photos.
- `POST /api/wardrobe/items/:id/re-analyze` - Re-run analysis for one item.
- `POST /api/wardrobe/outfit-coherence` - Evaluate visual coherence of ad-hoc outfit.
- `POST /api/wardrobe/outfit/:outfitId/coherence` - Evaluate coherence of saved outfit.
- `POST /api/wardrobe/layering/analyze` - Analyze layering viability.
- `POST /api/wardrobe/layering/suggest` - Suggest layering combinations.
- `GET /api/wardrobe/layering/weather-check` - Weather appropriateness for layers.
- `GET /api/wardrobe/compatibility/:category/learned` - Learned compatibility by category.
- `GET /api/wardrobe/compatibility/graph` - Compatibility graph data.
- `POST /api/wardrobe/compatibility/learn` - Trigger compatibility learning pipeline.
- `GET /api/wardrobe/onboarding` - Wardrobe onboarding hints/state.
- `GET /api/wardrobe/essentials` - Essential items recommendation/checklist.
- `GET /api/wardrobe/price-tier` - User price-tier insights/preferences.

## Try-On

Base path: `/api/tryon`

- `GET /api/tryon/service/health` - Try-on service/dependency health.
- `POST /api/tryon/validate` - Validate garment image/input before try-on.
- `POST /api/tryon/webhooks` - Configure webhook callback destination.
- `GET /api/tryon/webhooks` - Read current webhook configuration.
- `DELETE /api/tryon/webhooks` - Remove webhook configuration.
- `POST /api/tryon/webhooks/disable` - Temporarily disable webhook delivery.
- `GET /api/tryon/admin/dlq` - View dead-letter queue for failed jobs.
- `POST /api/tryon/admin/dlq/:jobId/retry` - Retry a dead-lettered job.
- `POST /api/tryon/admin/process-retries` - Process pending retry queue.
- `GET /api/tryon/saved` - List saved try-on results.
- `PATCH /api/tryon/saved/:savedId` - Update metadata for a saved result.
- `DELETE /api/tryon/saved/:savedId` - Delete saved result.
- `POST /api/tryon` - Submit generic try-on job (person + garment input).
- `POST /api/tryon/from-wardrobe` - Submit try-on using a wardrobe item.
- `POST /api/tryon/from-product` - Submit try-on using a product catalog item.
- `POST /api/tryon/batch` - Submit batch try-on jobs.
- `GET /api/tryon/history` - List recent try-on jobs/history.
- `GET /api/tryon/:id` - Get try-on job status/result.
- `DELETE /api/tryon/:id` - Delete try-on job/result.
- `POST /api/tryon/:id/cancel` - Cancel a running/pending try-on job.
- `POST /api/tryon/:id/save` - Save one try-on result.

## Notes For Maintenance

- Keep this file updated whenever adding/removing a `router.<method>()` entry in `src/routes/**`.
- If behavior changes, update the endpoint description in this file in the same PR.
