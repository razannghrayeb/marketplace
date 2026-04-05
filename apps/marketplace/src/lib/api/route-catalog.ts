/**
 * Catalog for the Admin API Explorer — mirrors backend routes (path + method).
 * Paths are relative to API root (same as `NEXT_PUBLIC_API_URL`).
 */

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE'

export type CatalogParam = { name: string; label: string; placeholder?: string }

export type CatalogRoute = {
  id: string
  group: string
  label: string
  method: HttpMethod
  path: string
  pathParams?: CatalogParam[]
  /** Example JSON for POST/PATCH body */
  defaultBody?: string
  queryHint?: string
  adminOnly?: boolean
}

export const routeCatalog: CatalogRoute[] = [
  // —— Health & metrics ——
  { id: 'health-live', group: 'Health', label: 'Liveness', method: 'GET', path: '/health/live' },
  { id: 'health-ready', group: 'Health', label: 'Readiness', method: 'GET', path: '/health/ready' },
  { id: 'health-detailed', group: 'Health', label: 'Detailed', method: 'GET', path: '/health/detailed' },
  { id: 'metrics', group: 'Health', label: 'Prometheus metrics', method: 'GET', path: '/metrics' },

  // —— Auth (session) ——
  {
    id: 'auth-me',
    group: 'Auth',
    label: 'Current user (GET /api/auth/me)',
    method: 'GET',
    path: '/api/auth/me',
  },
  {
    id: 'auth-me-patch',
    group: 'Auth',
    label: 'Update profile (PATCH)',
    method: 'PATCH',
    path: '/api/auth/me',
    defaultBody: '{\n  "email": "new@example.com"\n}',
  },

  // —— Cart ——
  { id: 'cart-get', group: 'Cart', label: 'Get cart', method: 'GET', path: '/api/cart' },
  {
    id: 'cart-add',
    group: 'Cart',
    label: 'Add to cart',
    method: 'POST',
    path: '/api/cart',
    defaultBody: '{\n  "product_id": 1,\n  "quantity": 1\n}',
  },
  {
    id: 'cart-patch',
    group: 'Cart',
    label: 'Update quantity (0 removes)',
    method: 'PATCH',
    path: '/api/cart/:productId',
    pathParams: [{ name: 'productId', label: 'Product ID', placeholder: '123' }],
    defaultBody: '{\n  "quantity": 2\n}',
  },
  { id: 'cart-delete-item', group: 'Cart', label: 'Remove line', method: 'DELETE', path: '/api/cart/:productId', pathParams: [{ name: 'productId', label: 'Product ID' }] },
  { id: 'cart-clear', group: 'Cart', label: 'Clear cart', method: 'DELETE', path: '/api/cart/clear' },

  // —— Favorites ——
  { id: 'fav-list', group: 'Favorites', label: 'List favorites', method: 'GET', path: '/api/favorites' },
  {
    id: 'fav-toggle',
    group: 'Favorites',
    label: 'Toggle favorite',
    method: 'POST',
    path: '/api/favorites/toggle',
    defaultBody: '{\n  "product_id": 1\n}',
  },
  {
    id: 'fav-check',
    group: 'Favorites',
    label: 'Check one product',
    method: 'GET',
    path: '/api/favorites/check/:productId',
    pathParams: [{ name: 'productId', label: 'Product ID' }],
  },

  // —— Products (public) ——
  { id: 'prod-list', group: 'Products', label: 'List products', method: 'GET', path: '/products' },
  {
    id: 'prod-by-id',
    group: 'Products',
    label: 'Product by ID',
    method: 'GET',
    path: '/products/:id',
    pathParams: [{ name: 'id', label: 'Product ID' }],
  },
  {
    id: 'prod-similar',
    group: 'Products',
    label: 'Similar products',
    method: 'GET',
    path: '/products/:id/similar',
    pathParams: [{ name: 'id', label: 'Product ID' }],
  },
  {
    id: 'prod-reco',
    group: 'Products',
    label: 'Recommendations',
    method: 'GET',
    path: '/products/:id/recommendations',
    pathParams: [{ name: 'id', label: 'Product ID' }],
  },

  // —— Search ——
  {
    id: 'search-text',
    group: 'Search',
    label: 'Text search (body)',
    method: 'POST',
    path: '/search',
    defaultBody: '{\n  "query": "blue dress",\n  "limit": 20\n}',
  },
  { id: 'search-autocomplete', group: 'Search', label: 'Autocomplete', method: 'GET', path: '/search/autocomplete', queryHint: 'q=blu' },

  // —— Compare ——
  {
    id: 'compare-root',
    group: 'Compare',
    label: 'Compare products (POST)',
    method: 'POST',
    path: '/api/compare',
    defaultBody: '{\n  "product_ids": [1, 2, 3],\n  "compare_goal": "best_value",\n  "occasion": "work"\n}',
  },
  {
    id: 'compare-quality',
    group: 'Compare',
    label: 'Quality score',
    method: 'GET',
    path: '/api/compare/quality/:productId',
    pathParams: [{ name: 'productId', label: 'Product ID' }],
  },
  {
    id: 'compare-price',
    group: 'Compare',
    label: 'Price analysis',
    method: 'GET',
    path: '/api/compare/price/:productId',
    pathParams: [{ name: 'productId', label: 'Product ID' }],
  },
  {
    id: 'compare-baseline',
    group: 'Compare',
    label: 'Category baseline',
    method: 'GET',
    path: '/api/compare/baseline/:category',
    pathParams: [{ name: 'category', label: 'Category slug', placeholder: 'dresses' }],
  },
  {
    id: 'compare-tooltips',
    group: 'Compare',
    label: 'Tooltips config',
    method: 'GET',
    path: '/api/compare/tooltips',
  },
  {
    id: 'compare-compute-baselines',
    group: 'Compare',
    label: 'Compute baselines (admin-style)',
    method: 'POST',
    path: '/api/compare/admin/compute-baselines',
    defaultBody: '{}',
  },

  // —— Try-on ——
  { id: 'tryon-health', group: 'Try-on', label: 'Service health', method: 'GET', path: '/api/tryon/service/health' },
  { id: 'tryon-history', group: 'Try-on', label: 'History', method: 'GET', path: '/api/tryon/history' },
  { id: 'tryon-saved', group: 'Try-on', label: 'Saved results', method: 'GET', path: '/api/tryon/saved' },
  {
    id: 'tryon-job',
    group: 'Try-on',
    label: 'Job status',
    method: 'GET',
    path: '/api/tryon/:id',
    pathParams: [{ name: 'id', label: 'Job ID' }],
  },

  // —— Wardrobe (sample) ——
  { id: 'wardrobe-items', group: 'Wardrobe', label: 'List items', method: 'GET', path: '/api/wardrobe/items' },
  { id: 'wardrobe-profile', group: 'Wardrobe', label: 'Profile', method: 'GET', path: '/api/wardrobe/profile' },
  { id: 'wardrobe-gaps', group: 'Wardrobe', label: 'Gaps', method: 'GET', path: '/api/wardrobe/gaps' },

  // —— Admin ——
  {
    id: 'admin-stats',
    group: 'Admin',
    label: 'Dashboard stats',
    method: 'GET',
    path: '/admin/stats',
    adminOnly: true,
  },
  {
    id: 'admin-flagged',
    group: 'Admin',
    label: 'Flagged products',
    method: 'GET',
    path: '/admin/products/flagged',
    adminOnly: true,
  },
  {
    id: 'admin-hidden',
    group: 'Admin',
    label: 'Hidden products',
    method: 'GET',
    path: '/admin/products/hidden',
    adminOnly: true,
  },
  {
    id: 'admin-hide',
    group: 'Admin',
    label: 'Hide product',
    method: 'POST',
    path: '/admin/products/:id/hide',
    pathParams: [{ name: 'id', label: 'Product ID' }],
    adminOnly: true,
  },
  {
    id: 'admin-unhide',
    group: 'Admin',
    label: 'Unhide product',
    method: 'POST',
    path: '/admin/products/:id/unhide',
    pathParams: [{ name: 'id', label: 'Product ID' }],
    adminOnly: true,
  },
  {
    id: 'admin-flag',
    group: 'Admin',
    label: 'Flag product',
    method: 'POST',
    path: '/admin/products/:id/flag',
    pathParams: [{ name: 'id', label: 'Product ID' }],
    adminOnly: true,
  },
  {
    id: 'admin-unflag',
    group: 'Admin',
    label: 'Unflag product',
    method: 'POST',
    path: '/admin/products/:id/unflag',
    pathParams: [{ name: 'id', label: 'Product ID' }],
    adminOnly: true,
  },
  {
    id: 'admin-hide-batch',
    group: 'Admin',
    label: 'Hide batch',
    method: 'POST',
    path: '/admin/products/hide-batch',
    defaultBody: '{\n  "product_ids": [1, 2, 3]\n}',
    adminOnly: true,
  },
  {
    id: 'admin-duplicates',
    group: 'Admin',
    label: 'Find duplicates',
    method: 'GET',
    path: '/admin/products/:id/duplicates',
    pathParams: [{ name: 'id', label: 'Product ID' }],
    adminOnly: true,
  },
  {
    id: 'admin-canonicals',
    group: 'Admin',
    label: 'List canonicals',
    method: 'GET',
    path: '/admin/canonicals',
    adminOnly: true,
  },
  {
    id: 'admin-canonical',
    group: 'Admin',
    label: 'Get canonical',
    method: 'GET',
    path: '/admin/canonicals/:id',
    pathParams: [{ name: 'id', label: 'Canonical ID' }],
    adminOnly: true,
  },
  {
    id: 'admin-canonical-merge',
    group: 'Admin',
    label: 'Merge canonicals',
    method: 'POST',
    path: '/admin/canonicals/merge',
    defaultBody: '{\n  "source_id": "a",\n  "target_id": "b"\n}',
    adminOnly: true,
  },
  {
    id: 'admin-canonical-detach',
    group: 'Admin',
    label: 'Detach product from canonical',
    method: 'POST',
    path: '/admin/canonicals/:id/detach/:productId',
    pathParams: [
      { name: 'id', label: 'Canonical ID' },
      { name: 'productId', label: 'Product ID' },
    ],
    adminOnly: true,
  },
  {
    id: 'admin-job-run',
    group: 'Admin',
    label: 'Run job',
    method: 'POST',
    path: '/admin/jobs/:type/run',
    pathParams: [{ name: 'type', label: 'Job type', placeholder: 'embeddings' }],
    defaultBody: '{}',
    adminOnly: true,
  },
  {
    id: 'admin-job-schedules',
    group: 'Admin',
    label: 'Job schedules',
    method: 'GET',
    path: '/admin/jobs/schedules',
    adminOnly: true,
  },
  {
    id: 'admin-job-metrics',
    group: 'Admin',
    label: 'Job metrics',
    method: 'GET',
    path: '/admin/jobs/metrics',
    adminOnly: true,
  },
  {
    id: 'admin-job-history',
    group: 'Admin',
    label: 'Job history',
    method: 'GET',
    path: '/admin/jobs/history',
    adminOnly: true,
  },
  {
    id: 'admin-reco-label-get',
    group: 'Admin',
    label: 'Reco for labeling (GET)',
    method: 'GET',
    path: '/admin/reco/label',
    queryHint: 'baseProductId=123',
    adminOnly: true,
  },
  {
    id: 'admin-reco-label-post',
    group: 'Admin',
    label: 'Save reco label',
    method: 'POST',
    path: '/admin/reco/label',
    defaultBody: '{\n  "base_product_id": 1,\n  "recommended_product_id": 2,\n  "label": "good"\n}',
    adminOnly: true,
  },
  {
    id: 'admin-reco-label-batch',
    group: 'Admin',
    label: 'Save reco labels batch',
    method: 'POST',
    path: '/admin/reco/label/batch',
    defaultBody: '{\n  "labels": []\n}',
    adminOnly: true,
  },
  {
    id: 'admin-reco-labels',
    group: 'Admin',
    label: 'Export labeled data',
    method: 'GET',
    path: '/admin/reco/labels',
    adminOnly: true,
  },
  {
    id: 'admin-reco-stats',
    group: 'Admin',
    label: 'Labeling stats',
    method: 'GET',
    path: '/admin/reco/stats',
    adminOnly: true,
  },
]

export function resolveCatalogPath(path: string, paramValues: Record<string, string>): string {
  let out = path
  const names = (path.match(/:[a-zA-Z0-9_]+/g) || []).map((s) => s.slice(1))
  for (const name of names) {
    const v = paramValues[name] ?? ''
    out = out.replace(`:${name}`, v)
  }
  return out
}

export function catalogGroups(): string[] {
  const s = new Set<string>()
  routeCatalog.forEach((r) => s.add(r.group))
  return Array.from(s)
}
