/**
 * Build product detail URLs that preserve an in-app back target (see products/[id] safe return handler).
 */
export const PRODUCT_RETURN_COMPARE = '/compare'

export function productDetailHref(productId: number | string, fromPath: string): string {
  const enc = encodeURIComponent(fromPath)
  return `/products/${productId}?from=${enc}`
}

export function productDetailHrefFromCompare(productId: number | string): string {
  return productDetailHref(productId, PRODUCT_RETURN_COMPARE)
}
