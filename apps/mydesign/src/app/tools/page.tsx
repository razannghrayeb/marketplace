'use client'

import { useState } from 'react'
import { apiJson } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'
import { JsonPanel } from '@/components/JsonPanel'
import { ApiBaseBanner } from '@/components/ApiBaseBanner'

export default function ToolsPage() {
  const [productId, setProductId] = useState('1')
  const [category, setCategory] = useState('dresses')
  const [title, setTitle] = useState('Sample title')
  const [description, setDescription] = useState('')
  const [policy, setPolicy] = useState('')

  const [quality, setQuality] = useState<unknown>(null)
  const [price, setPrice] = useState<unknown>(null)
  const [baseline, setBaseline] = useState<unknown>(null)
  const [tooltips, setTooltips] = useState<unknown>(null)
  const [textAnalysis, setTextAnalysis] = useState<unknown>(null)
  const [priceDrops, setPriceDrops] = useState<unknown>(null)
  const [baselineCompute, setBaselineCompute] = useState<unknown>(null)

  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState<string | null>(null)

  async function wrap(label: string, fn: () => Promise<void>) {
    setLoading(label)
    setErr(null)
    try {
      await fn()
    } catch (e) {
      setErr(String(e))
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="p-8 max-w-6xl">
      <h1 className="font-display text-2xl font-bold text-neutral-900">Quality and pricing</h1>
      <p className="text-sm text-neutral-600 mt-1">Compare service helpers and price drops.</p>
      <div className="mt-2">
        <ApiBaseBanner />
      </div>

      <div className="mt-6 grid sm:grid-cols-3 gap-3">
        <div>
          <label className="text-xs text-neutral-500">Product id</label>
          <input className="input-field" value={productId} onChange={(e) => setProductId(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-neutral-500">Category baseline key</label>
          <input className="input-field" value={category} onChange={(e) => setCategory(e.target.value)} />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-secondary text-xs"
          disabled={!!loading}
          onClick={() =>
            wrap('quality', async () => {
              setQuality(await apiJson(endpoints.compare.quality(productId)))
            })
          }
        >
          Quality
        </button>
        <button
          type="button"
          className="btn-secondary text-xs"
          disabled={!!loading}
          onClick={() =>
            wrap('price', async () => {
              setPrice(await apiJson(endpoints.compare.price(productId)))
            })
          }
        >
          Price analysis
        </button>
        <button
          type="button"
          className="btn-secondary text-xs"
          disabled={!!loading}
          onClick={() =>
            wrap('baseline', async () => {
              setBaseline(await apiJson(endpoints.compare.baseline(category)))
            })
          }
        >
          Baseline
        </button>
        <button
          type="button"
          className="btn-secondary text-xs"
          disabled={!!loading}
          onClick={() =>
            wrap('tooltips', async () => {
              setTooltips(await apiJson(endpoints.compare.tooltips))
            })
          }
        >
          Tooltips
        </button>
        <button
          type="button"
          className="btn-secondary text-xs"
          disabled={!!loading}
          onClick={() =>
            wrap('drops', async () => {
              setPriceDrops(await apiJson(endpoints.products.priceDrops))
            })
          }
        >
          Price drops
        </button>
        <button
          type="button"
          className="btn-primary text-xs"
          disabled={!!loading}
          onClick={() =>
            wrap('compute', async () => {
              setBaselineCompute(await apiJson(endpoints.compare.computeBaselines, { method: 'POST' }))
            })
          }
        >
          Compute baselines
        </button>
      </div>

      <div className="mt-8 surface-card space-y-3">
        <h2 className="text-sm font-semibold">Analyze text</h2>
        <input className="input-field" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea className="input-field min-h-[80px]" value={description} onChange={(e) => setDescription(e.target.value)} />
        <input className="input-field" value={policy} onChange={(e) => setPolicy(e.target.value)} placeholder="return_policy" />
        <button
          type="button"
          className="btn-primary text-xs"
          disabled={!!loading}
          onClick={() =>
            wrap('text', async () => {
              setTextAnalysis(
                await apiJson(endpoints.compare.analyzeText, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ title, description, return_policy: policy }),
                })
              )
            })
          }
        >
          POST analyze-text
        </button>
      </div>

      {err ? <p className="mt-4 text-sm text-red-600">{err}</p> : null}
      {loading ? <p className="mt-2 text-sm text-violet-600">Running {loading}</p> : null}

      <div className="mt-6 grid lg:grid-cols-2 gap-4">
        <JsonPanel title="Quality" data={quality ?? {}} />
        <JsonPanel title="Price analysis" data={price ?? {}} />
        <JsonPanel title="Baseline" data={baseline ?? {}} />
        <JsonPanel title="Tooltips" data={tooltips ?? {}} />
        <JsonPanel title="Price drops" data={priceDrops ?? {}} />
        <JsonPanel title="Compute baselines" data={baselineCompute ?? {}} />
        <JsonPanel title="Text analysis" data={textAnalysis ?? {}} />
      </div>
    </div>
  )
}
