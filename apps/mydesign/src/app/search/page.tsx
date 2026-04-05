'use client'

import { useState } from 'react'
import { apiJson } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'
import { JsonPanel } from '@/components/JsonPanel'
import { ApiBaseBanner } from '@/components/ApiBaseBanner'

export default function TextSearchPage() {
  const [q, setQ] = useState('dress')
  const [limit, setLimit] = useState('20')
  const [data, setData] = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function run() {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ q, limit })
      const path = `${endpoints.search.text}?${params}`
      const json = await apiJson<unknown>(path)
      setData(json)
    } catch (e) {
      setError(String(e))
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-8 max-w-5xl">
      <h1 className="font-display text-2xl font-bold text-neutral-900">Text search</h1>
      <p className="text-sm text-neutral-600 mt-1">GET /search</p>
      <div className="mt-2">
        <ApiBaseBanner />
      </div>
      <div className="mt-6 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[220px]">
          <label className="block text-xs font-medium text-neutral-500 mb-1">q</label>
          <input className="input-field" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-500 mb-1">limit</label>
          <input className="input-field w-24" value={limit} onChange={(e) => setLimit(e.target.value)} />
        </div>
        <button type="button" className="btn-primary" onClick={run} disabled={loading}>
          Search
        </button>
      </div>
      <div className="mt-6">
        <JsonPanel title="Response" data={data} error={error} loading={loading} />
      </div>
    </div>
  )
}
