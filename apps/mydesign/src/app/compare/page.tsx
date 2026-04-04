'use client'

import { useState } from 'react'
import { apiJson } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'
import { JsonPanel } from '@/components/JsonPanel'
import { ApiBaseBanner } from '@/components/ApiBaseBanner'

export default function ComparePage() {
  const [ids, setIds] = useState('1,2,3')
  const [data, setData] = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function run() {
    setLoading(true)
    setError(null)
    try {
      const product_ids = ids
        .split(/[,\s]+/)
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !Number.isNaN(n))
      const json = await apiJson<unknown>(endpoints.compare.root, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_ids }),
      })
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
      <h1 className="font-display text-2xl font-bold text-neutral-900">Compare products</h1>
      <p className="text-sm text-neutral-600 mt-1">POST /api/compare</p>
      <div className="mt-2">
        <ApiBaseBanner />
      </div>
      <div className="mt-6 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[240px]">
          <label className="block text-xs font-medium text-neutral-500 mb-1">product_ids</label>
          <input
            className="input-field font-mono text-sm"
            value={ids}
            onChange={(e) => setIds(e.target.value)}
          />
        </div>
        <button type="button" className="btn-primary" onClick={run} disabled={loading}>
          Compare
        </button>
      </div>
      <div className="mt-6">
        <JsonPanel title="Verdict" data={data} error={error} loading={loading} />
      </div>
    </div>
  )
}
