/**
 * Paths for the Fashion Aggregator API (Express monolith).
 * Aligned with repo `src/server.ts` and README; README-only routes are noted in the UI.
 */
export const endpoints = {
  health: {
    live: '/health/live',
    ready: '/health/ready',
    detailed: '/health/detailed',
  },
  metrics: '/metrics',
  products: {
    list: '/products',
    facets: '/products/facets',
    search: '/products/search',
    searchImage: '/products/search/image',
    byId: (id: number | string) => `/products/${id}`,
    recommendations: (id: number | string) => `/products/${id}/recommendations`,
    recommendationsBatch: '/products/recommendations/batch',
    completeStyle: (id: number | string) => `/products/${id}/complete-style`,
    completeStylePost: '/products/complete-style',
    styleProfile: (id: number | string) => `/products/${id}/style-profile`,
    priceHistory: (id: number | string) => `/products/${id}/price-history`,
    similar: (id: number | string) => `/products/${id}/similar`,
    priceDrops: '/products/price-drops',
    images: (id: number | string) => `/products/${id}/images`,
    imagePrimary: (id: number | string, imageId: number | string) =>
      `/products/${id}/images/${imageId}/primary`,
    imageDelete: (id: number | string, imageId: number | string) =>
      `/products/${id}/images/${imageId}`,
    variantsBatch: '/products/variants/batch',
  },
  search: {
    text: '/search',
    image: '/search/image',
    multiImage: '/search/multi-image',
    multiVector: '/search/multi-vector',
  },
  images: {
    search: '/api/images/search',
    status: '/api/images/status',
    labels: '/api/images/labels',
    analyze: '/api/images/analyze',
    detect: '/api/images/detect',
  },
  compare: {
    root: '/api/compare',
    quality: (productId: string) => `/api/compare/quality/${productId}`,
    analyzeText: '/api/compare/analyze-text',
    price: (productId: string) => `/api/compare/price/${productId}`,
    baseline: (category: string) => `/api/compare/baseline/${encodeURIComponent(category)}`,
    computeBaselines: '/api/compare/admin/compute-baselines',
    tooltips: '/api/compare/tooltips',
    reviews: (productId: string) => `/api/compare/reviews/${productId}`,
    reviewsCompare: '/api/compare/reviews',
  },
  auth: {
    login: '/api/auth/login',
    me: '/api/auth/me',
  },
  admin: {
    stats: '/admin/stats',
    flagged: '/admin/products/flagged',
    hidden: '/admin/products/hidden',
    hideBatch: '/admin/products/hide-batch',
    hideProduct: (id: string) => `/admin/products/${id}/hide`,
    unhideProduct: (id: string) => `/admin/products/${id}/unhide`,
    flagProduct: (id: string) => `/admin/products/${id}/flag`,
    unflagProduct: (id: string) => `/admin/products/${id}/unflag`,
    duplicates: (id: string) => `/admin/products/${id}/duplicates`,
    canonicals: '/admin/canonicals',
    canonical: (id: string) => `/admin/canonicals/${id}`,
    canonicalMerge: '/admin/canonicals/merge',
    canonicalDetach: (id: string, productId: string) =>
      `/admin/canonicals/${id}/detach/${productId}`,
    jobRun: (type: string) => `/admin/jobs/${encodeURIComponent(type)}/run`,
    jobSchedules: '/admin/jobs/schedules',
    jobMetrics: '/admin/jobs/metrics',
    jobHistory: '/admin/jobs/history',
    recoLabel: '/admin/reco/label',
    recoLabelPost: '/admin/reco/label',
    recoLabelBatch: '/admin/reco/label/batch',
    recoLabels: '/admin/reco/labels',
    recoStats: '/admin/reco/stats',
  },
  wardrobe: {
    completeLook: '/api/wardrobe/complete-look',
  },
} as const
