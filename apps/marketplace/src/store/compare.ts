import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

interface CompareState {
  productIds: number[]
  add: (id: number) => void
  remove: (id: number) => void
  clear: () => void
  has: (id: number) => boolean
}

/** JSON / APIs sometimes yield string ids; compare APIs require integers. */
export function normalizeCompareProductId(id: unknown): number | null {
  if (typeof id === 'number' && Number.isFinite(id)) {
    const n = Math.trunc(id)
    return n >= 1 ? n : null
  }
  if (typeof id === 'string') {
    const n = parseInt(id, 10)
    return Number.isInteger(n) && n >= 1 ? n : null
  }
  return null
}

function normalizeCompareProductIdList(ids: unknown): number[] {
  if (!Array.isArray(ids)) return []
  const out: number[] = []
  const seen = new Set<number>()
  for (const raw of ids) {
    const n = normalizeCompareProductId(raw)
    if (n != null && !seen.has(n)) {
      seen.add(n)
      out.push(n)
    }
  }
  return out
}

export const useCompareStore = create<CompareState>()(
  persist(
    (set, get) => ({
      productIds: [],
      add: (id) =>
        set((s) => {
          const n = normalizeCompareProductId(id)
          if (n == null || s.productIds.includes(n) || s.productIds.length >= 5) return s
          return { productIds: [...s.productIds, n] }
        }),
      remove: (id) =>
        set((s) => {
          const n = normalizeCompareProductId(id)
          if (n == null) return s
          return {
            productIds: s.productIds.filter((x) => normalizeCompareProductId(x) !== n),
          }
        }),
      clear: () => set({ productIds: [] }),
      /** Prefer `useCompareStore(s => s.productIds.includes(id))` in components — this fn’s ref is stable, so `select(s => s.has)` will not re-render on id changes. */
      has: (id) => {
        const n = normalizeCompareProductId(id)
        return n != null && get().productIds.includes(n)
      },
    }),
    {
      name: 'compare-products',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ productIds: state.productIds }),
      merge: (persisted, current) => {
        const p = persisted as Partial<Pick<CompareState, 'productIds'>> | undefined
        const merged = { ...current, ...p } as CompareState
        const fromDisk = normalizeCompareProductIdList(p?.productIds)
        const fromMem = normalizeCompareProductIdList(current.productIds)
        const seen = new Set<number>()
        const union: number[] = []
        for (const id of [...fromDisk, ...fromMem]) {
          if (seen.has(id)) continue
          seen.add(id)
          union.push(id)
          if (union.length >= 5) break
        }
        merged.productIds = union
        return merged
      },
    }
  )
)
