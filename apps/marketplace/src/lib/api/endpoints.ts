/**
 * API endpoint paths - matches backend routes from FRONTEND_BACKEND_GUIDE.md
 */

export const endpoints = {
  // Auth
  auth: {
    signup: '/api/auth/signup',
    login: '/api/auth/login',
    refresh: '/api/auth/refresh',
    me: '/api/auth/me',
  },
  // Products
  products: {
    list: '/products',
    facets: '/products/facets',
    search: '/products/search',
    searchImage: '/products/search/image',
    byId: (id: number | string) => `/products/${id}`,
    recommendations: (id: number | string) => `/products/${id}/recommendations`,
    completeStyle: (id: number | string) => `/products/${id}/complete-style`,
    priceHistory: (id: number | string) => `/products/${id}/price-history`,
    priceDrops: '/products/price-drops',
    images: (id: number | string) => `/products/${id}/images`,
    recommendationsBatch: '/products/recommendations/batch',
  },
  // Search
  search: {
    text: '/search',
    image: '/search/image',
    multiImage: '/search/multi-image',
    multiVector: '/search/multi-vector',
    autocomplete: '/search/autocomplete',
    trending: '/search/trending',
    popular: '/search/popular',
  },
  // Image analysis (shop-the-look)
  images: {
    search: '/api/images/search',
    searchUrl: '/api/images/search/url',
    detect: '/api/images/detect',
    labels: '/api/images/labels',
    status: '/api/images/status',
  },
  // Favorites
  favorites: {
    list: '/api/favorites',
    toggle: '/api/favorites/toggle',
    check: (productId: number | string) => `/api/favorites/check/${productId}`,
    checkBatch: '/api/favorites/check',
  },
  // Wardrobe
  wardrobe: {
    items: '/api/wardrobe/items',
    item: (id: number | string) => `/api/wardrobe/items/${id}`,
    profile: '/api/wardrobe/profile',
    gaps: '/api/wardrobe/gaps',
    recommendations: '/api/wardrobe/recommendations',
    outfitSuggestions: '/api/wardrobe/outfit-suggestions',
    completeLook: '/api/wardrobe/complete-look',
    analyzePhoto: '/api/wardrobe/analyze-photo',
    outfitCoherence: '/api/wardrobe/outfit-coherence',
  },
  // Try-on
  tryon: {
    submit: '/api/tryon/',
    fromWardrobe: '/api/tryon/from-wardrobe',
    fromProduct: '/api/tryon/from-product',
    batch: '/api/tryon/batch',
    job: (id: string) => `/api/tryon/${id}`,
    history: '/api/tryon/history',
    saved: '/api/tryon/saved',
    save: (id: string) => `/api/tryon/${id}/save`,
    cancel: (id: string) => `/api/tryon/${id}/cancel`,
    delete: (id: string) => `/api/tryon/${id}`,
  },
  // Compare
  compare: '/api/compare',
  // Health
  health: '/health/live',
}
