'use client'

import { useEffect, useState } from 'react'
import { X, ExternalLink } from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts'
import type { Product, PriceHistory } from '@/types'
import { Badge, AvailBadge } from '@/components/ui'
import {
  formatCents, formatRelativeTime,
  getProductFlags, getActiveFlags, discountPercent,
} from '@/lib/utils/quality'

interface Props {
  product: Product
  onClose: () => void
}

type Tab = 'details' | 'images' | 'history'

export function ProductDrawer({ product: p, onClose }: Props) {
  const [tab, setTab]           = useState<Tab>('details')
  const [history, setHistory]   = useState<PriceHistory[]>([])
  const [loadingH, setLoadingH] = useState(false)

  const flags = getProductFlags(p)
  const active = getActiveFlags(flags)
  const disc = discountPercent(p.price_cents, p.sales_price_cents)

  useEffect(() => {
    if (tab === 'history' && history.length === 0) {
      setLoadingH(true)
      fetch(`/api/products/${p.id}/price-history`)
        .then((r) => r.json())
        .then((d) => setHistory(d ?? []))
        .finally(() => setLoadingH(false))
    }
  }, [tab, p.id, history.length])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const images = [
    ...(p.image_url ? [p.image_url] : []),
    ...(p.image_urls?.filter((u) => u !== p.image_url) ?? []),
  ]

  const chartData = history.map((h) => ({
    date: h.recorded_at.slice(0, 10),
    price: (h.price_cents ?? 0) / 100,
    sale: h.sales_price_cents ? h.sales_price_cents / 100 : undefined,
  }))

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'details', label: 'Details' },
    { id: 'images', label: `Images${images.length ? ` (${images.length})` : ''}` },
    { id: 'history', label: 'Price history' },
  ]

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />

      <div className="fixed right-0 top-0 bottom-0 w-[520px] max-w-full bg-white shadow-2xl z-50 flex flex-col overflow-hidden">
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <div className="flex-1 min-w-0 pr-4">
            <h2 className="font-semibold text-gray-900 text-sm leading-snug line-clamp-2">{p.title}</h2>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <Badge color="gray">{p.vendor?.name ?? p.vendor_id}</Badge>
              {p.brand && <span className="text-xs text-gray-400">{p.brand}</span>}
              {active.length > 0 && (
                <Badge severity={active.some((f) => f.severity === 'critical') ? 'critical' : 'warning'}>
                  {active.length} issue{active.length > 1 ? 's' : ''}
                </Badge>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            title="Close product drawer"
            aria-label="Close product drawer"
            className="p-1 hover:bg-gray-100 rounded-lg transition-colors shrink-0"
          >
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        <div className="flex border-b border-gray-100 px-5 shrink-0">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`text-xs py-2.5 px-1 mr-5 border-b-2 transition-colors whitespace-nowrap ${
                tab === t.id
                  ? 'border-gray-900 text-gray-900 font-medium'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {tab === 'details' && (
            <div className="space-y-4">
              {active.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                  <p className="text-[11px] font-semibold text-amber-700 uppercase tracking-wide mb-2">Quality flags</p>
                  <div className="flex flex-wrap gap-1.5">
                    {active.map((f) => (
                      <Badge key={f.key} severity={f.severity}>{f.label}</Badge>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[11px] text-gray-400 uppercase tracking-wide mb-1">Price</p>
                  <p className="text-lg font-semibold text-gray-900">{formatCents(p.price_cents, p.currency ?? undefined)}</p>
                </div>
                <div className={`rounded-xl p-3 ${p.sales_price_cents ? 'bg-teal-50' : 'bg-gray-50'}`}>
                  <p className="text-[11px] text-gray-400 uppercase tracking-wide mb-1">Sale price</p>
                  {p.sales_price_cents ? (
                    <>
                      <p className="text-lg font-semibold text-teal-600">{formatCents(p.sales_price_cents, p.currency ?? undefined)}</p>
                      {disc && <p className="text-[11px] text-teal-500">-{disc}% off</p>}
                    </>
                  ) : (
                    <p className="text-gray-300 text-sm">-</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                {[
                  { label: 'Category', value: p.category, missing: flags.missing_category },
                  { label: 'Color', value: p.color, missing: flags.missing_color, warn: flags.color_looks_like_size },
                  { label: 'Size', value: p.size, missing: flags.missing_size, warn: flags.size_looks_like_color },
                  { label: 'Brand', value: p.brand, missing: flags.missing_brand },
                  { label: 'Currency', value: p.currency, missing: false },
                  { label: 'Last seen', value: p.last_seen ? formatRelativeTime(p.last_seen) : null, missing: false },
                  { label: 'Variant ID', value: p.variant_id, missing: flags.missing_variant_id },
                  { label: 'Availability', value: null, missing: false, custom: <AvailBadge avail={p.availability} /> },
                ].map(({ label, value, missing, warn, custom }) => (
                  <div key={label} className="bg-gray-50 rounded-lg p-2.5">
                    <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1">{label}</p>
                    {custom ?? (
                      missing
                        ? <Badge severity="warning">missing</Badge>
                        : warn
                          ? <span className="font-medium text-amber-600">{value}</span>
                          : <span className="font-medium text-gray-800">{value ?? '-'}</span>
                    )}
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                {[
                  { label: 'Product URL', value: p.product_url },
                  { label: 'Parent product URL', value: p.parent_product_url },
                ].map(({ label, value }) => value && (
                  <div key={label} className="bg-gray-50 rounded-lg p-2.5">
                    <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1">{label}</p>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-mono text-gray-600 break-all line-clamp-2">{value}</span>
                      <a
                        href={value}
                        target="_blank"
                        rel="noreferrer"
                        title={`Open ${label}`}
                        aria-label={`Open ${label}`}
                        className="shrink-0"
                      >
                        <ExternalLink className="w-3 h-3 text-blue-500" />
                      </a>
                    </div>
                  </div>
                ))}
              </div>

              <div className="bg-gray-50 rounded-lg p-2.5">
                <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1">Return policy</p>
                {p.return_policy
                  ? <p className="text-xs text-gray-700 leading-relaxed">{p.return_policy}</p>
                  : <Badge severity="info">Not scraped</Badge>}
              </div>
            </div>
          )}

          {tab === 'images' && (
            <div>
              {images.length === 0 ? (
                <div className="text-center py-12 text-gray-400 text-sm">
                  <p>No images available</p>
                  {flags.missing_image_url && <Badge severity="warning" className="mt-2">image_url is null</Badge>}
                  {flags.missing_image_urls && <Badge severity="info" className="mt-2 ml-1">image_urls is empty</Badge>}
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {images.map((url, i) => (
                    <div key={url} className="relative aspect-square rounded-xl overflow-hidden border border-gray-200 bg-gray-100">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt={`Image ${i + 1}`} className="w-full h-full object-cover" />
                      {i === 0 && (
                        <span className="absolute top-1.5 left-1.5 text-[10px] bg-black/60 text-white px-1.5 py-0.5 rounded">
                          Primary
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'history' && (
            <div className="space-y-4">
              {loadingH ? (
                <div className="text-xs text-gray-400 py-8 text-center">Loading...</div>
              ) : history.length === 0 ? (
                <div className="text-xs text-gray-400 py-8 text-center">No price history recorded yet</div>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={180}>
                    <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} />
                      <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                      <Tooltip
                        contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e5e7eb' }}
                        formatter={(v: number) => `$${v.toFixed(2)}`}
                      />
                      <Line type="monotone" dataKey="price" stroke="#3b82f6" strokeWidth={1.5} dot={false} name="Price" />
                      <Line type="monotone" dataKey="sale" stroke="#10b981" strokeWidth={1.5} dot={false} name="Sale" strokeDasharray="3 3" />
                    </LineChart>
                  </ResponsiveContainer>

                  <div className="space-y-1.5">
                    {history.slice().reverse().map((h) => (
                      <div key={h.id} className="flex items-center justify-between text-xs py-2 px-3 bg-gray-50 rounded-lg">
                        <span className="text-gray-400">{h.recorded_at.slice(0, 10)}</span>
                        <span className="font-medium">{formatCents(h.price_cents, h.currency)}</span>
                        {h.sales_price_cents && (
                          <span className="text-teal-600">{formatCents(h.sales_price_cents, h.currency)} (sale)</span>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
