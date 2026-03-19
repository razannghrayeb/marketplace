import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface CompareState {
  productIds: number[]
  add: (id: number) => void
  remove: (id: number) => void
  clear: () => void
  has: (id: number) => boolean
}

export const useCompareStore = create<CompareState>()(
  persist(
    (set, get) => ({
      productIds: [],
      add: (id) =>
        set((s) => {
          if (s.productIds.includes(id) || s.productIds.length >= 5) return s
          return { productIds: [...s.productIds, id] }
        }),
      remove: (id) =>
        set((s) => ({
          productIds: s.productIds.filter((x) => x !== id),
        })),
      clear: () => set({ productIds: [] }),
      has: (id) => get().productIds.includes(id),
    }),
    { name: 'compare-products' }
  )
)
