/**
 * Catalog of backend HTTP operations for the Admin API console.
 * Paths match `src/server.ts` mounts and `lib/api/endpoints.ts`.
 * `auth`: token behavior — still send Bearer if logged in; backend enforces roles.
 */

export type CatalogAuth = 'none' | 'user' | 'admin'

export interface CatalogOp {
  id: string
  group: string
  label: string
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT'
  pathTemplate: string
  auth: CatalogAuth
  /** Example JSON body for POST/PATCH/PUT */
  defaultBody?: string
  /** Hint for query JSON object keys */
  queryHint?: string
  /** Response is not JSON (e.g. Prometheus) */
  rawText?: boolean
  /** Multipart field names — console shows file pickers */
  multipartFields?: string[]
  note?: string
}

function op(p: Omit<CatalogOp, 'group'> & { group?: string }): CatalogOp {
  return { group: p.group ?? 'Misc', ...p } as CatalogOp
}

/** All callable operations (subset uses multipart — use Try-On / Discover pages for heavy uploads). */
export const ADMIN_API_CATALOG: CatalogOp[] = [
  // —— Auth ——
  op({ id: 'auth-signup', group: 'Auth', label: 'Signup', method: 'POST', pathTemplate: '/api/auth/signup', auth: 'none', defaultBody: '{"email":"","password":"","user_type":"customer"}' }),
  op({ id: 'auth-login', group: 'Auth', label: 'Login', method: 'POST', pathTemplate: '/api/auth/login', auth: 'none', defaultBody: '{"email":"","password":""}' }),
  op({ id: 'auth-refresh', group: 'Auth', label: 'Refresh token', method: 'POST', pathTemplate: '/api/auth/refresh', auth: 'none', defaultBody: '{"refresh_token":""}' }),
  op({ id: 'auth-logout', group: 'Auth', label: 'Logout', method: 'POST', pathTemplate: '/api/auth/logout', auth: 'user', defaultBody: '{"refresh_token":""}' }),
  op({ id: 'auth-me-get', group: 'Auth', label: 'Get profile (me)', method: 'GET', pathTemplate: '/api/auth/me', auth: 'user' }),
  op({ id: 'auth-me-patch', group: 'Auth', label: 'Update profile (me)', method: 'PATCH', pathTemplate: '/api/auth/me', auth: 'user', defaultBody: '{"email":"new@example.com"}' }),

  // —— Products ——
  op({ id: 'products-list', group: 'Products', label: 'List products', method: 'GET', pathTemplate: '/products', auth: 'none', queryHint: '{"page":1,"limit":24}' }),
  op({ id: 'products-facets', group: 'Products', label: 'Facets', method: 'GET', pathTemplate: '/products/facets', auth: 'none' }),
  op({ id: 'products-search-get', group: 'Products', label: 'Search (GET)', method: 'GET', pathTemplate: '/products/search', auth: 'none', queryHint: '{"q":"dress","limit":20}' }),
  op({ id: 'products-by-id', group: 'Products', label: 'Product by id', method: 'GET', pathTemplate: '/products/:id', auth: 'none' }),
  op({ id: 'products-reco', group: 'Products', label: 'Recommendations', method: 'GET', pathTemplate: '/products/:id/recommendations', auth: 'none' }),
  op({ id: 'products-complete-style-get', group: 'Products', label: 'Complete style (GET)', method: 'GET', pathTemplate: '/products/:id/complete-style', auth: 'none' }),
  op({ id: 'products-style-profile', group: 'Products', label: 'Style profile', method: 'GET', pathTemplate: '/products/:id/style-profile', auth: 'none' }),
  op({ id: 'products-price-history', group: 'Products', label: 'Price history', method: 'GET', pathTemplate: '/products/:id/price-history', auth: 'none' }),
  op({ id: 'products-similar', group: 'Products', label: 'Similar products', method: 'GET', pathTemplate: '/products/:id/similar', auth: 'none' }),
  op({ id: 'products-price-drops', group: 'Products', label: 'Price drops', method: 'GET', pathTemplate: '/products/price-drops', auth: 'none' }),
  op({ id: 'products-images-list', group: 'Products', label: 'Product images', method: 'GET', pathTemplate: '/products/:id/images', auth: 'none' }),
  op({ id: 'products-image-primary', group: 'Products', label: 'Set primary image', method: 'PUT', pathTemplate: '/products/:id/images/:imageId/primary', auth: 'admin', note: 'Usually admin/catalog tooling' }),
  op({ id: 'products-image-delete', group: 'Products', label: 'Delete product image', method: 'DELETE', pathTemplate: '/products/:id/images/:imageId', auth: 'admin' }),
  op({
    id: 'products-image-upload',
    group: 'Products',
    label: 'Upload product image (multipart)',
    method: 'POST',
    pathTemplate: '/products/:id/images',
    auth: 'admin',
    multipartFields: ['image'],
    note: 'Admin/catalog use; field name: image',
  }),
  op({ id: 'products-reco-batch', group: 'Products', label: 'Recommendations batch', method: 'POST', pathTemplate: '/products/recommendations/batch', auth: 'none', defaultBody: '{"productIds":[1,2]}' }),
  op({ id: 'products-complete-style-post', group: 'Products', label: 'Complete style (POST)', method: 'POST', pathTemplate: '/products/complete-style', auth: 'none', defaultBody: '{"product_id":1}' }),
  op({ id: 'products-variants-batch', group: 'Products', label: 'Variants batch', method: 'POST', pathTemplate: '/products/variants/batch', auth: 'none', defaultBody: '{"productIds":[1]}' }),
  op({ id: 'products-search-image', group: 'Products', label: 'Search by image (multipart)', method: 'POST', pathTemplate: '/products/search/image', auth: 'none', multipartFields: ['image'], note: 'Field name: image' }),

  // —— Search ——
  op({ id: 'search-text', group: 'Search', label: 'Text search', method: 'GET', pathTemplate: '/search', auth: 'none', queryHint: '{"q":"blue","limit":20}' }),
  op({ id: 'search-image', group: 'Search', label: 'Image search (multipart)', method: 'POST', pathTemplate: '/search/image', auth: 'none', multipartFields: ['image'] }),
  op({ id: 'search-multi-image', group: 'Search', label: 'Multi-image search (multipart)', method: 'POST', pathTemplate: '/search/multi-image', auth: 'none', multipartFields: ['images'], note: 'May expect multiple files under same field name' }),
  op({ id: 'search-multi-vector', group: 'Search', label: 'Multi-vector search', method: 'POST', pathTemplate: '/search/multi-vector', auth: 'none', defaultBody: '{}' }),
  op({ id: 'search-autocomplete', group: 'Search', label: 'Autocomplete', method: 'GET', pathTemplate: '/search/autocomplete', auth: 'none', queryHint: '{"q":"dr"}' }),
  op({ id: 'search-trending', group: 'Search', label: 'Trending', method: 'GET', pathTemplate: '/search/trending', auth: 'none' }),
  op({ id: 'search-popular', group: 'Search', label: 'Popular', method: 'GET', pathTemplate: '/search/popular', auth: 'none' }),
  op({ id: 'search-session', group: 'Search', label: 'Session', method: 'GET', pathTemplate: '/search/session/:sessionId', auth: 'none' }),
  op({ id: 'search-prompt-templates', group: 'Search', label: 'Prompt templates', method: 'GET', pathTemplate: '/search/prompt-templates', auth: 'none' }),
  op({ id: 'search-prompt-analyze', group: 'Search', label: 'Prompt analyze', method: 'POST', pathTemplate: '/search/prompt-analyze', auth: 'none', defaultBody: '{"prompt":""}' }),
  op({ id: 'search-prompt-suggestions', group: 'Search', label: 'Prompt suggestions', method: 'GET', pathTemplate: '/search/prompt-suggestions', auth: 'none', queryHint: '{"partial":""}' }),

  // —— Images API ——
  op({ id: 'img-search', group: 'Images API', label: 'Images search', method: 'POST', pathTemplate: '/api/images/search', auth: 'user', defaultBody: '{}' }),
  op({ id: 'img-search-sel', group: 'Images API', label: 'Images search selective', method: 'POST', pathTemplate: '/api/images/search/selective', auth: 'user', defaultBody: '{}' }),
  op({ id: 'img-search-url', group: 'Images API', label: 'Images search by URL', method: 'POST', pathTemplate: '/api/images/search/url', auth: 'user', defaultBody: '{"url":""}' }),
  op({ id: 'img-analyze', group: 'Images API', label: 'Analyze (multipart)', method: 'POST', pathTemplate: '/api/images/analyze', auth: 'user', multipartFields: ['image'] }),
  op({ id: 'img-detect', group: 'Images API', label: 'Detect (multipart)', method: 'POST', pathTemplate: '/api/images/detect', auth: 'user', multipartFields: ['image'] }),
  op({ id: 'img-detect-url', group: 'Images API', label: 'Detect URL', method: 'POST', pathTemplate: '/api/images/detect/url', auth: 'user', defaultBody: '{"url":""}' }),
  op({ id: 'img-detect-batch', group: 'Images API', label: 'Detect batch', method: 'POST', pathTemplate: '/api/images/detect/batch', auth: 'user', defaultBody: '{"urls":[]}' }),
  op({ id: 'img-labels', group: 'Images API', label: 'Labels', method: 'GET', pathTemplate: '/api/images/labels', auth: 'none' }),
  op({ id: 'img-status', group: 'Images API', label: 'Status', method: 'GET', pathTemplate: '/api/images/status', auth: 'none' }),

  // —— Ingest ——
  op({ id: 'ingest-image', group: 'Ingest', label: 'Ingest image (multipart)', method: 'POST', pathTemplate: '/api/ingest/image', auth: 'admin', multipartFields: ['image'], note: 'Backend may require admin/service auth' }),
  op({ id: 'ingest-job', group: 'Ingest', label: 'Ingest job status', method: 'GET', pathTemplate: '/api/ingest/:jobId', auth: 'user' }),

  // —— Labeling ——
  op({ id: 'lab-tasks', group: 'Labeling', label: 'Tasks', method: 'GET', pathTemplate: '/api/labeling/tasks', auth: 'user', queryHint: '{"status":"pending"}' }),
  op({ id: 'lab-assign', group: 'Labeling', label: 'Assign task', method: 'POST', pathTemplate: '/api/labeling/tasks/:id/assign', auth: 'user', defaultBody: '{}' }),
  op({ id: 'lab-submit', group: 'Labeling', label: 'Submit task', method: 'POST', pathTemplate: '/api/labeling/tasks/:id/submit', auth: 'user', defaultBody: '{}' }),
  op({ id: 'lab-skip', group: 'Labeling', label: 'Skip task', method: 'POST', pathTemplate: '/api/labeling/tasks/:id/skip', auth: 'user', defaultBody: '{}' }),
  op({ id: 'lab-stats', group: 'Labeling', label: 'Stats', method: 'GET', pathTemplate: '/api/labeling/stats', auth: 'user' }),
  op({ id: 'lab-queue', group: 'Labeling', label: 'Queue items', method: 'POST', pathTemplate: '/api/labeling/queue', auth: 'admin', defaultBody: '{}' }),
  op({ id: 'lab-categories', group: 'Labeling', label: 'Categories', method: 'GET', pathTemplate: '/api/labeling/categories', auth: 'none' }),
  op({ id: 'lab-patterns', group: 'Labeling', label: 'Patterns', method: 'GET', pathTemplate: '/api/labeling/patterns', auth: 'none' }),
  op({ id: 'lab-materials', group: 'Labeling', label: 'Materials', method: 'GET', pathTemplate: '/api/labeling/materials', auth: 'none' }),

  // —— Favorites ——
  op({ id: 'fav-list', group: 'Favorites', label: 'List favorites', method: 'GET', pathTemplate: '/api/favorites', auth: 'user' }),
  op({ id: 'fav-toggle', group: 'Favorites', label: 'Toggle favorite', method: 'POST', pathTemplate: '/api/favorites/toggle', auth: 'user', defaultBody: '{"product_id":1}' }),
  op({ id: 'fav-check', group: 'Favorites', label: 'Check favorite', method: 'GET', pathTemplate: '/api/favorites/check/:productId', auth: 'user' }),
  op({ id: 'fav-check-batch', group: 'Favorites', label: 'Check batch', method: 'POST', pathTemplate: '/api/favorites/check', auth: 'user', defaultBody: '{"product_ids":[1,2]}' }),

  // —— Cart ——
  op({ id: 'cart-get', group: 'Cart', label: 'Get cart', method: 'GET', pathTemplate: '/api/cart', auth: 'user' }),
  op({ id: 'cart-add', group: 'Cart', label: 'Add to cart', method: 'POST', pathTemplate: '/api/cart', auth: 'user', defaultBody: '{"product_id":1,"quantity":1}' }),
  op({ id: 'cart-patch', group: 'Cart', label: 'Update line item', method: 'PATCH', pathTemplate: '/api/cart/:productId', auth: 'user', defaultBody: '{"quantity":2}' }),
  op({ id: 'cart-delete', group: 'Cart', label: 'Remove line item', method: 'DELETE', pathTemplate: '/api/cart/:productId', auth: 'user' }),
  op({ id: 'cart-clear', group: 'Cart', label: 'Clear cart', method: 'DELETE', pathTemplate: '/api/cart/clear', auth: 'user' }),

  // —— Wardrobe (representative set) ——
  op({ id: 'wd-items', group: 'Wardrobe', label: 'List items', method: 'GET', pathTemplate: '/api/wardrobe/items', auth: 'user' }),
  op({ id: 'wd-item-get', group: 'Wardrobe', label: 'Get item', method: 'GET', pathTemplate: '/api/wardrobe/items/:id', auth: 'user' }),
  op({
    id: 'wd-item-patch',
    group: 'Wardrobe',
    label: 'Update item metadata',
    method: 'PATCH',
    pathTemplate: '/api/wardrobe/items/:id',
    auth: 'user',
    defaultBody: '{}',
    note: 'Fields depend on backend updateItem schema',
  }),
  op({ id: 'wd-item-del', group: 'Wardrobe', label: 'Delete item', method: 'DELETE', pathTemplate: '/api/wardrobe/items/:id', auth: 'user' }),
  op({ id: 'wd-profile', group: 'Wardrobe', label: 'Profile', method: 'GET', pathTemplate: '/api/wardrobe/profile', auth: 'user' }),
  op({ id: 'wd-profile-recompute', group: 'Wardrobe', label: 'Profile recompute', method: 'POST', pathTemplate: '/api/wardrobe/profile/recompute', auth: 'user', defaultBody: '{}' }),
  op({ id: 'wd-gaps', group: 'Wardrobe', label: 'Gaps', method: 'GET', pathTemplate: '/api/wardrobe/gaps', auth: 'user' }),
  op({ id: 'wd-reco', group: 'Wardrobe', label: 'Recommendations', method: 'GET', pathTemplate: '/api/wardrobe/recommendations', auth: 'user' }),
  op({ id: 'wd-compat-score', group: 'Wardrobe', label: 'Compatibility score', method: 'GET', pathTemplate: '/api/wardrobe/compatibility/score', auth: 'user' }),
  op({ id: 'wd-compat-item', group: 'Wardrobe', label: 'Compatibility by item', method: 'GET', pathTemplate: '/api/wardrobe/compatibility/:itemId', auth: 'user' }),
  op({ id: 'wd-compat-pre', group: 'Wardrobe', label: 'Compatibility precompute', method: 'POST', pathTemplate: '/api/wardrobe/compatibility/precompute', auth: 'user', defaultBody: '{}' }),
  op({ id: 'wd-outfit-suggest', group: 'Wardrobe', label: 'Outfit suggestions', method: 'POST', pathTemplate: '/api/wardrobe/outfit-suggestions', auth: 'user', defaultBody: '{}' }),
  op({ id: 'wd-complete-look', group: 'Wardrobe', label: 'Complete look', method: 'POST', pathTemplate: '/api/wardrobe/complete-look', auth: 'user', defaultBody: '{}' }),
  op({ id: 'wd-backfill-emb', group: 'Wardrobe', label: 'Backfill embeddings', method: 'POST', pathTemplate: '/api/wardrobe/backfill-embeddings', auth: 'user', defaultBody: '{}' }),
  op({ id: 'wd-similar', group: 'Wardrobe', label: 'Similar to item', method: 'GET', pathTemplate: '/api/wardrobe/similar/:itemId', auth: 'user' }),
  op({ id: 'wd-auto-settings', group: 'Wardrobe', label: 'Auto-sync settings (get)', method: 'GET', pathTemplate: '/api/wardrobe/auto-sync/settings', auth: 'user' }),
  op({
    id: 'wd-auto-settings-put',
    group: 'Wardrobe',
    label: 'Auto-sync settings (update)',
    method: 'PUT',
    pathTemplate: '/api/wardrobe/auto-sync/settings',
    auth: 'user',
    defaultBody: '{}',
    note: 'Shape matches backend updateAutoSyncSettings',
  }),
  op({ id: 'wd-auto-manual', group: 'Wardrobe', label: 'Auto-sync manual', method: 'POST', pathTemplate: '/api/wardrobe/auto-sync/manual', auth: 'user', defaultBody: '{}' }),
  op({ id: 'wd-analyze-photo', group: 'Wardrobe', label: 'Analyze photo (multipart)', method: 'POST', pathTemplate: '/api/wardrobe/analyze-photo', auth: 'user', multipartFields: ['image'] }),
  op({ id: 'wd-reanalyze', group: 'Wardrobe', label: 'Re-analyze item', method: 'POST', pathTemplate: '/api/wardrobe/items/:id/re-analyze', auth: 'user', defaultBody: '{}' }),
  op({ id: 'wd-outfit-coh', group: 'Wardrobe', label: 'Outfit coherence', method: 'POST', pathTemplate: '/api/wardrobe/outfit-coherence', auth: 'user', defaultBody: '{}' }),
  op({ id: 'wd-outfit-coh-id', group: 'Wardrobe', label: 'Outfit coherence by id', method: 'POST', pathTemplate: '/api/wardrobe/outfit/:outfitId/coherence', auth: 'user', defaultBody: '{}' }),
  op({ id: 'wd-layer-analyze', group: 'Wardrobe', label: 'Layering analyze', method: 'POST', pathTemplate: '/api/wardrobe/layering/analyze', auth: 'user', defaultBody: '{}' }),
  op({ id: 'wd-layer-suggest', group: 'Wardrobe', label: 'Layering suggest', method: 'POST', pathTemplate: '/api/wardrobe/layering/suggest', auth: 'user', defaultBody: '{}' }),
  op({
    id: 'wd-layer-weather',
    group: 'Wardrobe',
    label: 'Layering weather check',
    method: 'GET',
    pathTemplate: '/api/wardrobe/layering/weather-check',
    auth: 'user',
    queryHint: '{"piece_ids":"1,2","temperature":"18"}',
  }),
  op({ id: 'wd-cat-learned', group: 'Wardrobe', label: 'Category learned rules', method: 'GET', pathTemplate: '/api/wardrobe/compatibility/:category/learned', auth: 'user' }),
  op({ id: 'wd-compat-graph', group: 'Wardrobe', label: 'Compatibility graph', method: 'GET', pathTemplate: '/api/wardrobe/compatibility/graph', auth: 'user' }),
  op({ id: 'wd-compat-learn', group: 'Wardrobe', label: 'Compatibility learn', method: 'POST', pathTemplate: '/api/wardrobe/compatibility/learn', auth: 'user', defaultBody: '{}' }),
  op({ id: 'wd-onboarding', group: 'Wardrobe', label: 'Onboarding', method: 'GET', pathTemplate: '/api/wardrobe/onboarding', auth: 'user' }),
  op({ id: 'wd-essentials', group: 'Wardrobe', label: 'Essentials', method: 'GET', pathTemplate: '/api/wardrobe/essentials', auth: 'user' }),
  op({ id: 'wd-price-tier', group: 'Wardrobe', label: 'Price tier', method: 'GET', pathTemplate: '/api/wardrobe/price-tier', auth: 'user' }),
  op({ id: 'wd-items-post', group: 'Wardrobe', label: 'Add wardrobe item (multipart)', method: 'POST', pathTemplate: '/api/wardrobe/items', auth: 'user', multipartFields: ['image'], note: 'Also try /try-on page for guided flow' }),
  op({ id: 'wd-analyze-batch', group: 'Wardrobe', label: 'Analyze photos batch (multipart)', method: 'POST', pathTemplate: '/api/wardrobe/analyze-photos/batch', auth: 'user', multipartFields: ['images'] }),

  // —— Try-On ——
  op({ id: 'tryon-health', group: 'Try-On', label: 'Service health', method: 'GET', pathTemplate: '/api/tryon/service/health', auth: 'none' }),
  op({ id: 'tryon-history', group: 'Try-On', label: 'History', method: 'GET', pathTemplate: '/api/tryon/history', auth: 'user' }),
  op({ id: 'tryon-saved', group: 'Try-On', label: 'Saved results', method: 'GET', pathTemplate: '/api/tryon/saved', auth: 'user' }),
  op({ id: 'tryon-job', group: 'Try-On', label: 'Job status', method: 'GET', pathTemplate: '/api/tryon/:id', auth: 'user' }),
  op({ id: 'tryon-cancel', group: 'Try-On', label: 'Cancel job', method: 'POST', pathTemplate: '/api/tryon/:id/cancel', auth: 'user', defaultBody: '{}' }),
  op({ id: 'tryon-save', group: 'Try-On', label: 'Save result', method: 'POST', pathTemplate: '/api/tryon/:id/save', auth: 'user', defaultBody: '{}' }),
  op({ id: 'tryon-delete', group: 'Try-On', label: 'Delete job', method: 'DELETE', pathTemplate: '/api/tryon/:id', auth: 'user' }),
  op({ id: 'tryon-saved-patch', group: 'Try-On', label: 'Update saved', method: 'PATCH', pathTemplate: '/api/tryon/saved/:savedId', auth: 'user', defaultBody: '{}' }),
  op({ id: 'tryon-saved-del', group: 'Try-On', label: 'Delete saved', method: 'DELETE', pathTemplate: '/api/tryon/saved/:savedId', auth: 'user' }),
  op({ id: 'tryon-submit', group: 'Try-On', label: 'Submit try-on (multipart)', method: 'POST', pathTemplate: '/api/tryon', auth: 'user', multipartFields: ['person_image', 'garment_image'], note: 'Optional garment_id as form field' }),
  op({ id: 'tryon-from-wardrobe', group: 'Try-On', label: 'From wardrobe (multipart)', method: 'POST', pathTemplate: '/api/tryon/from-wardrobe', auth: 'user', multipartFields: ['person_image'], defaultBody: '', queryHint: 'Add wardrobe_item_id in form' }),
  op({ id: 'tryon-from-product', group: 'Try-On', label: 'From product (multipart)', method: 'POST', pathTemplate: '/api/tryon/from-product', auth: 'user', multipartFields: ['person_image'], note: 'Add product_id in form' }),
  op({ id: 'tryon-batch', group: 'Try-On', label: 'Batch (multipart)', method: 'POST', pathTemplate: '/api/tryon/batch', auth: 'user', multipartFields: ['person_image', 'garment_images'] }),

  // —— Compare ——
  op({ id: 'cmp-root', group: 'Compare', label: 'Compare products', method: 'POST', pathTemplate: '/api/compare', auth: 'user', defaultBody: '{"product_ids":[1,2]}' }),
  op({ id: 'cmp-quality', group: 'Compare', label: 'Quality', method: 'GET', pathTemplate: '/api/compare/quality/:productId', auth: 'none' }),
  op({ id: 'cmp-analyze-text', group: 'Compare', label: 'Analyze text', method: 'POST', pathTemplate: '/api/compare/analyze-text', auth: 'none', defaultBody: '{"text":""}' }),
  op({ id: 'cmp-price', group: 'Compare', label: 'Price insight', method: 'GET', pathTemplate: '/api/compare/price/:productId', auth: 'none' }),
  op({ id: 'cmp-baseline', group: 'Compare', label: 'Baseline', method: 'GET', pathTemplate: '/api/compare/baseline/:category', auth: 'none' }),
  op({ id: 'cmp-baselines-compute', group: 'Compare', label: 'Compute baselines', method: 'POST', pathTemplate: '/api/compare/admin/compute-baselines', auth: 'admin', defaultBody: '{}' }),
  op({ id: 'cmp-tooltips', group: 'Compare', label: 'Tooltips', method: 'GET', pathTemplate: '/api/compare/tooltips', auth: 'none' }),

  // —— Doc-only (listed in API Routes Documentation; not mounted in this repo) ——
  op({
    id: 'cmp-reviews-one',
    group: 'Doc only (not in server)',
    label: 'Compare review analysis (doc)',
    method: 'GET',
    pathTemplate: '/api/compare/reviews/:productId',
    auth: 'none',
    note: 'No matching route in src/routes/compare — expect 404 until implemented',
  }),
  op({
    id: 'cmp-reviews-batch',
    group: 'Doc only (not in server)',
    label: 'Compare reviews batch (doc)',
    method: 'POST',
    pathTemplate: '/api/compare/reviews',
    auth: 'none',
    defaultBody: '{"product_ids":[]}',
    note: 'No matching route in src/routes/compare — expect 404 until implemented',
  }),
  op({
    id: 'tryon-validate-doc',
    group: 'Doc only (not in server)',
    label: 'Try-on validate (doc)',
    method: 'POST',
    pathTemplate: '/api/tryon/validate',
    auth: 'user',
    note: 'Not exposed in tryon.routes.ts — validation runs inside submit handlers',
  }),
  op({
    id: 'tryon-webhook-post',
    group: 'Doc only (not in server)',
    label: 'Try-on webhooks configure (doc)',
    method: 'POST',
    pathTemplate: '/api/tryon/webhooks',
    auth: 'user',
    defaultBody: '{}',
    note: 'Not implemented in this codebase',
  }),
  op({
    id: 'tryon-webhook-get',
    group: 'Doc only (not in server)',
    label: 'Try-on webhooks read (doc)',
    method: 'GET',
    pathTemplate: '/api/tryon/webhooks',
    auth: 'user',
    note: 'Not implemented in this codebase',
  }),
  op({
    id: 'tryon-webhook-del',
    group: 'Doc only (not in server)',
    label: 'Try-on webhooks delete (doc)',
    method: 'DELETE',
    pathTemplate: '/api/tryon/webhooks',
    auth: 'user',
    note: 'Not implemented in this codebase',
  }),
  op({
    id: 'tryon-webhook-disable',
    group: 'Doc only (not in server)',
    label: 'Try-on webhooks disable (doc)',
    method: 'POST',
    pathTemplate: '/api/tryon/webhooks/disable',
    auth: 'user',
    defaultBody: '{}',
    note: 'Not implemented in this codebase',
  }),
  op({
    id: 'tryon-dlq',
    group: 'Doc only (not in server)',
    label: 'Try-on admin DLQ (doc)',
    method: 'GET',
    pathTemplate: '/api/tryon/admin/dlq',
    auth: 'user',
    note: 'Not implemented in this codebase',
  }),
  op({
    id: 'tryon-dlq-retry',
    group: 'Doc only (not in server)',
    label: 'Try-on DLQ retry (doc)',
    method: 'POST',
    pathTemplate: '/api/tryon/admin/dlq/:jobId/retry',
    auth: 'user',
    defaultBody: '{}',
    note: 'Not implemented in this codebase',
  }),
  op({
    id: 'tryon-process-retries',
    group: 'Doc only (not in server)',
    label: 'Try-on process retries (doc)',
    method: 'POST',
    pathTemplate: '/api/tryon/admin/process-retries',
    auth: 'user',
    defaultBody: '{}',
    note: 'Not implemented in this codebase',
  }),

  // —— Admin ——
  op({ id: 'adm-stats', group: 'Admin', label: 'Dashboard stats', method: 'GET', pathTemplate: '/admin/stats', auth: 'admin' }),
  op({ id: 'adm-flagged', group: 'Admin', label: 'Flagged products', method: 'GET', pathTemplate: '/admin/products/flagged', auth: 'admin', queryHint: '{"page":1,"limit":50}' }),
  op({ id: 'adm-hidden', group: 'Admin', label: 'Hidden products', method: 'GET', pathTemplate: '/admin/products/hidden', auth: 'admin' }),
  op({ id: 'adm-dup', group: 'Admin', label: 'Duplicates', method: 'GET', pathTemplate: '/admin/products/:id/duplicates', auth: 'admin' }),
  op({ id: 'adm-hide', group: 'Admin', label: 'Hide product', method: 'POST', pathTemplate: '/admin/products/:id/hide', auth: 'admin', defaultBody: '{}' }),
  op({ id: 'adm-unhide', group: 'Admin', label: 'Unhide product', method: 'POST', pathTemplate: '/admin/products/:id/unhide', auth: 'admin', defaultBody: '{}' }),
  op({ id: 'adm-flag', group: 'Admin', label: 'Flag product', method: 'POST', pathTemplate: '/admin/products/:id/flag', auth: 'admin', defaultBody: '{}' }),
  op({ id: 'adm-unflag', group: 'Admin', label: 'Unflag product', method: 'POST', pathTemplate: '/admin/products/:id/unflag', auth: 'admin', defaultBody: '{}' }),
  op({ id: 'adm-hide-batch', group: 'Admin', label: 'Hide batch', method: 'POST', pathTemplate: '/admin/products/hide-batch', auth: 'admin', defaultBody: '{"productIds":[1,2],"reason":"spam"}' }),
  op({ id: 'adm-canonicals', group: 'Admin', label: 'List canonicals', method: 'GET', pathTemplate: '/admin/canonicals', auth: 'admin' }),
  op({ id: 'adm-canonical', group: 'Admin', label: 'Get canonical', method: 'GET', pathTemplate: '/admin/canonicals/:id', auth: 'admin' }),
  op({ id: 'adm-canonical-merge', group: 'Admin', label: 'Merge canonicals', method: 'POST', pathTemplate: '/admin/canonicals/merge', auth: 'admin', defaultBody: '{"sourceId":1,"targetId":2}' }),
  op({ id: 'adm-canonical-detach', group: 'Admin', label: 'Detach product', method: 'POST', pathTemplate: '/admin/canonicals/:id/detach/:productId', auth: 'admin', defaultBody: '{}' }),
  op({ id: 'adm-job-run', group: 'Admin', label: 'Run job', method: 'POST', pathTemplate: '/admin/jobs/:type/run', auth: 'admin', defaultBody: '{}', note: 'type: nightly-crawl | price-snapshot | canonical-recompute | cleanup-old-data' }),
  op({ id: 'adm-job-schedules', group: 'Admin', label: 'Job schedules', method: 'GET', pathTemplate: '/admin/jobs/schedules', auth: 'admin' }),
  op({ id: 'adm-job-metrics', group: 'Admin', label: 'Job metrics', method: 'GET', pathTemplate: '/admin/jobs/metrics', auth: 'admin' }),
  op({ id: 'adm-job-history', group: 'Admin', label: 'Job history', method: 'GET', pathTemplate: '/admin/jobs/history', auth: 'admin' }),
  op({ id: 'adm-reco-label-get', group: 'Admin', label: 'Reco for labeling', method: 'GET', pathTemplate: '/admin/reco/label', auth: 'admin', queryHint: '{"baseProductId":1}' }),
  op({ id: 'adm-reco-label-post', group: 'Admin', label: 'Save reco label', method: 'POST', pathTemplate: '/admin/reco/label', auth: 'admin', defaultBody: '{"baseProductId":1,"candidateProductId":2,"label":"good"}' }),
  op({ id: 'adm-reco-label-batch', group: 'Admin', label: 'Save reco labels batch', method: 'POST', pathTemplate: '/admin/reco/label/batch', auth: 'admin', defaultBody: '{"labels":[{"baseProductId":1,"candidateProductId":2,"label":"good"}]}' }),
  op({ id: 'adm-reco-labels', group: 'Admin', label: 'Export labels', method: 'GET', pathTemplate: '/admin/reco/labels', auth: 'admin' }),
  op({ id: 'adm-reco-stats', group: 'Admin', label: 'Reco labeling stats', method: 'GET', pathTemplate: '/admin/reco/stats', auth: 'admin' }),

  // —— Health / Metrics ——
  op({ id: 'health-live', group: 'System', label: 'Liveness', method: 'GET', pathTemplate: '/health/live', auth: 'none' }),
  op({ id: 'health-ready', group: 'System', label: 'Readiness', method: 'GET', pathTemplate: '/health/ready', auth: 'none' }),
  op({ id: 'health-detailed', group: 'System', label: 'Detailed health', method: 'GET', pathTemplate: '/health/detailed', auth: 'none' }),
  op({ id: 'metrics-prom', group: 'System', label: 'Prometheus metrics', method: 'GET', pathTemplate: '/metrics', auth: 'none', rawText: true }),
]

export function catalogGroups(): string[] {
  const s = new Set<string>()
  ADMIN_API_CATALOG.forEach((o) => s.add(o.group))
  return Array.from(s).sort()
}

export function catalogByGroup(group: string): CatalogOp[] {
  return ADMIN_API_CATALOG.filter((o) => o.group === group)
}
