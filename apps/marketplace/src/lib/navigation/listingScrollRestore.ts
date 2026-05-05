const PREFIX = 'tz_scroll_v1:'

export function listingScrollStorageKey(returnPath: string): string {
  return PREFIX + returnPath
}

/** Call before navigating to product detail so returning can restore scroll. */
export function saveListingScrollY(returnPath: string | undefined | null, scrollY: number): void {
  if (!returnPath || typeof window === 'undefined') return
  try {
    sessionStorage.setItem(listingScrollStorageKey(returnPath), String(Math.round(scrollY)))
  } catch {
    /* quota / private mode */
  }
}

/** Read saved scroll for this listing URL and remove the key (one-shot restore). */
export function readAndClearListingScrollY(returnPath: string): number | null {
  try {
    const key = listingScrollStorageKey(returnPath)
    const raw = sessionStorage.getItem(key)
    if (raw == null) return null
    sessionStorage.removeItem(key)
    const y = parseInt(raw, 10)
    return Number.isFinite(y) && y >= 0 ? y : null
  } catch {
    return null
  }
}
