'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Image from 'next/image'
import Link from 'next/link'
import { ShoppingBag, Trash2 } from 'lucide-react'
import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'
import { useAuthStore } from '@/store/auth'

type CartItem = {
  product_id: number
  quantity: number
  title: string
  brand: string | null
  price_cents: number
  sales_price_cents: number | null
  currency: string
  image_url: string | null
  image_cdn: string | null
}

function formatPrice(cents: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 0 }).format(cents / 100)
}

export default function CartPage() {
  const qc = useQueryClient()
  const isAuth = useAuthStore((s) => s.isAuthenticated())

  const cart = useQuery({
    queryKey: ['cart'],
    queryFn: async () => {
      const res = (await api.get<unknown>(endpoints.cart.root)) as {
        success?: boolean
        items?: CartItem[]
        total_items?: number
        total_price_cents?: number
        error?: { message?: string }
      }
      if (res.success === false) throw new Error(res.error?.message ?? 'Failed to load cart')
      return res
    },
    enabled: isAuth,
  })

  const patchQty = useMutation({
    mutationFn: ({ productId, quantity }: { productId: number; quantity: number }) =>
      api.patch(endpoints.cart.item(productId), { quantity }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['cart'] }),
  })

  const remove = useMutation({
    mutationFn: (productId: number) => api.delete(endpoints.cart.item(productId)),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['cart'] }),
  })

  const clear = useMutation({
    mutationFn: () => api.delete(endpoints.cart.clear),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['cart'] }),
  })

  if (!isAuth) {
    return (
      <div className="max-w-lg mx-auto px-4 py-20 text-center">
        <ShoppingBag className="w-14 h-14 text-neutral-300 mx-auto mb-4" />
        <h1 className="font-display text-2xl font-bold text-neutral-800">Your cart</h1>
        <p className="text-neutral-600 mt-2 mb-6">Sign in to view and manage your bag.</p>
        <Link href="/login" className="btn-primary">
          Sign in
        </Link>
      </div>
    )
  }

  const items = cart.data?.items ?? []
  const totalCents = cart.data?.total_price_cents ?? 0

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <div className="flex items-center justify-between mb-8">
        <h1 className="font-display text-3xl font-bold text-neutral-800">Cart</h1>
        {items.length > 0 && (
          <button type="button" className="text-sm text-neutral-800 hover:underline" disabled={clear.isPending} onClick={() => clear.mutate()}>
            Clear all
          </button>
        )}
      </div>

      {cart.isLoading ? (
        <p className="text-neutral-500">Loading…</p>
      ) : items.length === 0 ? (
        <div className="text-center py-16 bg-neutral-50 rounded-2xl border border-neutral-200">
          <p className="text-neutral-600 mb-4">Your cart is empty</p>
          <Link href="/products" className="btn-primary text-sm">
            Browse shop
          </Link>
        </div>
      ) : (
        <ul className="space-y-4">
          {items.map((line) => {
            const img = line.image_cdn || line.image_url || 'https://placehold.co/120x160/f5ede4/1a1a1a?text=+'
            const unit = line.sales_price_cents ?? line.price_cents
            return (
              <li key={line.product_id} className="flex gap-4 p-4 rounded-2xl border border-neutral-200 bg-white">
                <Link href={`/products/${line.product_id}`} className="relative w-24 h-32 shrink-0 rounded-xl overflow-hidden bg-neutral-100">
                  <Image src={img} alt="" fill className="object-cover" sizes="96px" />
                </Link>
                <div className="flex-1 min-w-0">
                  <Link href={`/products/${line.product_id}`} className="font-medium text-neutral-800 hover:text-violet-600 line-clamp-2">
                    {line.title}
                  </Link>
                  <p className="text-xs text-neutral-500 mt-1">{line.brand}</p>
                  <p className="text-sm font-semibold mt-2">{formatPrice(unit * line.quantity, line.currency)}</p>
                  <div className="flex items-center gap-3 mt-3">
                    <label className="text-xs text-neutral-600">Qty</label>
                    <input
                      type="number"
                      min={0}
                      max={99}
                      className="input-field w-20 text-sm py-1"
                      value={line.quantity}
                      onChange={(e) => {
                        const q = parseInt(e.target.value, 10)
                        if (!Number.isFinite(q)) return
                        patchQty.mutate({ productId: line.product_id, quantity: q })
                      }}
                    />
                    <button
                      type="button"
                      className="p-2 text-neutral-400 hover:text-violet-600"
                      aria-label="Remove"
                      onClick={() => remove.mutate(line.product_id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {items.length > 0 && (
        <div className="mt-8 flex justify-between items-center border-t border-neutral-200 pt-6">
          <span className="text-lg font-semibold text-neutral-800">Estimated total</span>
          <span className="text-xl font-bold text-neutral-800">{formatPrice(totalCents)}</span>
        </div>
      )}
    </div>
  )
}
