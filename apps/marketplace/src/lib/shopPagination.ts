import type { ApiResponse } from '@/lib/api/client'

/**
 * Pagination totals must come only from API meta/pagination — never from the current page's item count.
 */
export function getStablePagination<T>(
  payload: ApiResponse<T> | undefined,
  itemsPerPage: number
): { totalItems: number; totalPages: number } | null {
  if (!payload || payload.success === false) return null

  const totalItemsRaw = payload.meta?.total ?? payload.pagination?.total
  const pagesRaw = payload.meta?.pages ?? payload.pagination?.pages

  if (typeof pagesRaw === 'number' && Number.isFinite(pagesRaw) && pagesRaw >= 1) {
    const totalPages = Math.trunc(pagesRaw)
    const totalItems =
      typeof totalItemsRaw === 'number' && totalItemsRaw >= 0
        ? totalItemsRaw
        : totalPages * itemsPerPage
    return { totalItems, totalPages }
  }

  if (typeof totalItemsRaw === 'number' && totalItemsRaw >= 0) {
    return {
      totalItems: totalItemsRaw,
      totalPages: Math.max(1, Math.ceil(totalItemsRaw / itemsPerPage)),
    }
  }

  return null
}
