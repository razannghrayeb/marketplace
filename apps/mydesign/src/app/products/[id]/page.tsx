'use client'

import { useParams } from 'next/navigation'
import { useCallback, useState } from 'react'
import { apiJson, apiFetch } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'
import { JsonPanel } from '@/components/JsonPanel'

type Tab =
  | 'detail'
  | 'price-history'
  | 'recommendations'
  | 'complete-style'
  | 'images'
  | 'quality'

export default function ProductDetailPage() {
  const params = useParams()
  const id = String(params.id ?? '')
  const [tab, setTab] = useState<Tab>('detail')
  const [data, setData] = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      let path = endpoints.products.byId(id)
      if (tab === 'price-history') path = endpoints.products.priceHistory(id)
      if (tab === 'recommendations') path = endpoints.products.recommendations(id)
      if (tab === 'complete-style') path = endpoints.products.completeStyle(id)
      if (tab === 'images') path = endpoints.products.images(id)
      if (tab === 'quality') path = endpoints.compare.quality(id)
      const json = await apiJson<unknown>(path)
      setData(json)
    } catch (e) {
      setError(String(e))
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [id, tab])

  return (
    <div className="p-8 max-w-5xl">
      <h1 className="font-display text-2xl font-bold text-neutral-900">Product {id}</h1>
      <p className="text-sm text-neutral-600 mt-1">
        Read-only calls aligned with README product routes.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {(
          [
            ['detail', 'GET /products/:id'],
            ['price-history', 'GET /products/:id/price-history'],
            ['recommendations', 'GET /products/:id/recommendations'],
            ['complete-style', 'GET /products/:id/complete-style'],
            ['images', 'GET /products/:id/images'],
            ['quality', 'GET /api/compare/quality/:id'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              setTab(k)
              setData(null)
            }}
            className={`text-xs px-3 py-1.5 rounded-full font-medium border transition-colors ${
              tab === k
                ? 'bg-violet-600 text-white border-violet-600'
                : 'bg-white text-neutral-700 border-neutral-200 hover:border-violet-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-4 flex gap-2">
        <button type="button" className="btn-primary" onClick={load} disabled={loading}>
          Run request
        </button>
      </div>

      <div className="mt-4">
        <JsonPanel title={`Tab: ${tab}`} data={data} error={error} loading={loading} />
      </div>

      <ImageTools productId={id} />
    </div>
  )
}

function ImageTools({ productId }: { productId: string }) {
  const [file, setFile] = useState<File | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function upload() {
    if (!file || !productId) return
    setBusy(true)
    setMsg(null)
    try {
      const fd = new FormData()
      fd.append('image', file)
      const res = await apiFetch(endpoints.products.images(productId), { method: 'POST', body: fd })
      const text = await res.text()
      setMsg(`${res.status} ${text.slice(0, 500)}`)
    } catch (e) {
      setMsg(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-8 surface-card">
      <h2 className="text-sm font-semibold text-neutral-800 mb-2">Upload image (POST)</h2>
      <p className="text-xs text-neutral-500 mb-3">
        POST {endpoints.products.images(':id')} — multipart field <code>image</code>
      </p>
      <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <button type="button" className="btn-secondary mt-3 ml-2 inline-block" onClick={upload} disabled={busy}>
        Upload
      </button>
      {msg && <pre className="mt-3 text-xs bg-neutral-100 p-3 rounded-lg overflow-auto">{msg}</pre>}
    </div>
  )
}
