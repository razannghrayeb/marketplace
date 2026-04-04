'use client'

import { useState } from 'react'
import { apiFetch } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'
import { JsonPanel } from '@/components/JsonPanel'
import { ApiBaseBanner } from '@/components/ApiBaseBanner'

async function parseJsonRes(res: Response) {
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

export default function VisualSearchPage() {
  const [similarFile, setSimilarFile] = useState<File | null>(null)
  const [shopFile, setShopFile] = useState<File | null>(null)
  const [similarOut, setSimilarOut] = useState<unknown>(null)
  const [shopOut, setShopOut] = useState<unknown>(null)
  const [errSimilar, setErrSimilar] = useState<string | null>(null)
  const [errShop, setErrShop] = useState<string | null>(null)
  const [busyS, setBusyS] = useState(false)
  const [busyY, setBusyY] = useState(false)

  async function runSimilar() {
    if (!similarFile) return
    setBusyS(true)
    setErrSimilar(null)
    try {
      const fd = new FormData()
      fd.append('image', similarFile)
      const res = await apiFetch(endpoints.search.image, { method: 'POST', body: fd })
      const j = await parseJsonRes(res)
      setSimilarOut(j)
      if (!res.ok) setErrSimilar('HTTP ' + res.status)
    } catch (e) {
      setErrSimilar(String(e))
      setSimilarOut(null)
    } finally {
      setBusyS(false)
    }
  }

  async function runShopLook() {
    if (!shopFile) return
    setBusyY(true)
    setErrShop(null)
    try {
      const fd = new FormData()
      fd.append('image', shopFile)
      const res = await apiFetch(endpoints.images.search, { method: 'POST', body: fd })
      const j = await parseJsonRes(res)
      setShopOut(j)
      if (!res.ok) setErrShop('HTTP ' + res.status)
    } catch (e) {
      setErrShop(String(e))
      setShopOut(null)
    } finally {
      setBusyY(false)
    }
  }

  return (
    <div className="p-8 max-w-6xl">
      <h1 className="font-display text-2xl font-bold text-neutral-900">Image search</h1>
      <p className="text-sm text-neutral-600 mt-1">
        Visual similarity and shop-the-look (YOLO pipeline).
      </p>
      <div className="mt-2">
        <ApiBaseBanner />
      </div>
      <div className="mt-8 grid md:grid-cols-2 gap-6">
        <div className="surface-card">
          <h2 className="text-sm font-semibold text-neutral-800 mb-2">CLIP similarity</h2>
          <p className="text-xs text-neutral-500 mb-2">POST /search/image</p>
          <input type="file" accept="image/*" onChange={(e) => setSimilarFile(e.target.files?.[0] ?? null)} />
          <button type="button" className="btn-primary mt-3" onClick={runSimilar} disabled={busyS}>
            Submit
          </button>
          <div className="mt-4">
            <JsonPanel
              title="Result"
              data={similarOut ?? { hint: 'Upload and submit' }}
              error={errSimilar}
              loading={busyS}
            />
          </div>
        </div>
        <div className="surface-card">
          <h2 className="text-sm font-semibold text-neutral-800 mb-2">Shop the look</h2>
          <p className="text-xs text-neutral-500 mb-2">POST /api/images/search</p>
          <input type="file" accept="image/*" onChange={(e) => setShopFile(e.target.files?.[0] ?? null)} />
          <button type="button" className="btn-primary mt-3" onClick={runShopLook} disabled={busyY}>
            Submit
          </button>
          <div className="mt-4">
            <JsonPanel
              title="Result"
              data={shopOut ?? { hint: 'Upload and submit' }}
              error={errShop}
              loading={busyY}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
