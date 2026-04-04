'use client'

import { useCallback, useState } from 'react'
import Link from 'next/link'
import { apiJson, getApiBase } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'
import { JsonPanel } from '@/components/JsonPanel'
import { ApiBaseBanner } from '@/components/ApiBaseBanner'

export default function ProductsPage() {
  const [limit, setLimit] = useState('24')
  const [page, setPage] = useState('1')
  const [q, setQ] = useState('')
  const [facets, setFacets] = useState<unknown>(null)
  const [list, setList] = useState<unknown>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadFacets = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const data = await apiJson<unknown>(endpoints.products.facets)
      setFacets(data)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  const loadList = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit, page })
      if (q.trim()) params.set('q', q.trim())
      const data = await apiJson<unknown>(`${endpoints.products.list}?${params}`)
      setList(data)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [limit, page, q])

  return (
    <div className="p-8 max-w-6xl">
      <h1 className="font-display text-2xl font-bold text-neutral-900">Products</h1>
      <p className="text-sm text-neutral-600 mt-1">
        GET {endpoints.products.list} and {endpoints.products.facets}
      </p>
      <div className="mt-2">
        <ApiBaseBanner />
      </div>

      <div className="mt-6 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-neutral-500 mb-1">Page</label>
          <input className="input-field w-24" value={page} onChange={(e) => setPage(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-500 mb-1">Limit</label>
          <input className="input-field w-24" value={limit} onChange={(e) => setLimit(e.target.value)} />
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-medium text-neutral-500 mb-1">q (optional)</label>
          <input
            className="input-field"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter / query"
          />
        </div>
        <button type="button" className="btn-primary" onClick={loadList} disabled={loading}>
          Load list
        </button>
        <button type="button" className="btn-secondary" onClick={loadFacets} disabled={loading}>
          Load facets
        </button>
      </div>

      {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}

      <div className="mt-6 grid lg:grid-cols-2 gap-4">
        <JsonPanel title="Facets response" data={facets ?? { hint: 'Click Load facets' }} />
        <JsonPanel title="List response" data={list ?? { hint: 'Click Load list' }} />
      </div>

      <p className="mt-6 text-xs text-neutral-500">
        Drill-down:{' '}
        <Link href="/products/1" className="text-violet-600 hover:underline">
          /products/1
        </Link>
        . Manual base: {getApiBase()}
      </p>
    </div>
  )
}
