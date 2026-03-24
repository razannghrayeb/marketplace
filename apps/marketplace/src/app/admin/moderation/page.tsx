'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'

type ProductRow = {
  id: number
  title: string
  brand: string | null
  category: string | null
  is_hidden?: boolean
  flag_reason?: string | null
}

export default function AdminModerationPage() {
  const qc = useQueryClient()
  const [productId, setProductId] = useState('')
  const [batchIds, setBatchIds] = useState('1,2,3')
  const [reason, setReason] = useState('')

  const flagged = useQuery({
    queryKey: ['admin-flagged'],
    queryFn: async () => {
      const res = (await api.get<unknown>(endpoints.admin.flagged, { page: 1, limit: 50 })) as {
        products?: ProductRow[]
        total?: number
        success?: boolean
        error?: { message?: string }
      }
      if (res.success === false) throw new Error(res.error?.message ?? 'Failed')
      return res
    },
  })

  const hidden = useQuery({
    queryKey: ['admin-hidden'],
    queryFn: async () => {
      const res = (await api.get<unknown>(endpoints.admin.hidden, { page: 1, limit: 50 })) as {
        products?: ProductRow[]
        total?: number
        success?: boolean
        error?: { message?: string }
      }
      if (res.success === false) throw new Error(res.error?.message ?? 'Failed')
      return res
    },
  })

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['admin-flagged'] })
    void qc.invalidateQueries({ queryKey: ['admin-hidden'] })
  }

  const m = useMutation({
    mutationFn: async (fn: () => Promise<unknown>) => fn(),
    onSuccess: invalidate,
  })

  const pid = productId.trim()
  const parsedIds = batchIds
    .split(/[,\s]+/)
    .map((s) => parseInt(s, 10))
    .filter((n) => Number.isFinite(n))

  return (
    <div className="space-y-10">
      <div>
        <h1 className="font-display text-3xl font-bold text-neutral-800">Moderation</h1>
        <p className="text-sm text-neutral-600 mt-1">Flagged and hidden catalog items.</p>
      </div>

      <section className="rounded-2xl border border-neutral-200 bg-white p-5 space-y-4">
        <h2 className="font-semibold text-neutral-800">Actions by product ID</h2>
        <div className="flex flex-wrap gap-2 items-center">
          <input
            className="input-field text-sm w-40"
            placeholder="Product ID"
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
          />
          <button
            type="button"
            className="btn-secondary text-xs py-2"
            disabled={!pid || m.isPending}
            onClick={() => m.mutate(() => api.post(endpoints.admin.hideProduct(pid), {}))}
          >
            Hide
          </button>
          <button
            type="button"
            className="btn-secondary text-xs py-2"
            disabled={!pid || m.isPending}
            onClick={() => m.mutate(() => api.post(endpoints.admin.unhideProduct(pid), {}))}
          >
            Unhide
          </button>
          <button
            type="button"
            className="btn-secondary text-xs py-2"
            disabled={!pid || m.isPending}
            onClick={() => m.mutate(() => api.post(endpoints.admin.flagProduct(pid), {}))}
          >
            Flag
          </button>
          <button
            type="button"
            className="btn-secondary text-xs py-2"
            disabled={!pid || m.isPending}
            onClick={() => m.mutate(() => api.post(endpoints.admin.unflagProduct(pid), {}))}
          >
            Unflag
          </button>
          <button
            type="button"
            className="btn-secondary text-xs py-2"
            disabled={!pid || m.isPending}
            onClick={() => m.mutate(() => api.get(endpoints.admin.duplicates(pid)))}
          >
            Duplicates (log)
          </button>
        </div>
        <div className="space-y-2">
          <label className="text-xs text-neutral-600">Hide batch (comma-separated IDs)</label>
          <div className="flex flex-wrap gap-2">
            <input className="input-field text-sm flex-1 min-w-[200px]" value={batchIds} onChange={(e) => setBatchIds(e.target.value)} />
            <input
              className="input-field text-sm w-48"
              placeholder="Reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <button
              type="button"
              className="btn-primary text-xs py-2"
              disabled={parsedIds.length === 0 || m.isPending}
              onClick={() =>
                m.mutate(() => api.post(endpoints.admin.hideBatch, { productIds: parsedIds, reason: reason || undefined }))
              }
            >
              Hide batch
            </button>
          </div>
        </div>
        {m.isError && <p className="text-sm text-neutral-800">{(m.error as Error).message}</p>}
        {m.isSuccess && <p className="text-xs text-neutral-500">Last action completed — refresh lists.</p>}
      </section>

      <section>
        <h2 className="font-semibold text-neutral-800 mb-3">Flagged ({flagged.data?.total ?? '—'})</h2>
        {flagged.isLoading ? (
          <p className="text-sm text-neutral-500">Loading…</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-neutral-200">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left">
                <tr>
                  <th className="p-3">ID</th>
                  <th className="p-3">Title</th>
                  <th className="p-3">Brand</th>
                  <th className="p-3">Reason</th>
                </tr>
              </thead>
              <tbody>
                {(flagged.data?.products ?? []).map((p) => (
                  <tr key={p.id} className="border-t border-neutral-100">
                    <td className="p-3 font-mono">{p.id}</td>
                    <td className="p-3 max-w-xs truncate">{p.title}</td>
                    <td className="p-3">{p.brand ?? '—'}</td>
                    <td className="p-3 text-xs">{p.flag_reason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="font-semibold text-neutral-800 mb-3">Hidden ({hidden.data?.total ?? '—'})</h2>
        {hidden.isLoading ? (
          <p className="text-sm text-neutral-500">Loading…</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-neutral-200">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left">
                <tr>
                  <th className="p-3">ID</th>
                  <th className="p-3">Title</th>
                  <th className="p-3">Brand</th>
                </tr>
              </thead>
              <tbody>
                {(hidden.data?.products ?? []).map((p) => (
                  <tr key={p.id} className="border-t border-neutral-100">
                    <td className="p-3 font-mono">{p.id}</td>
                    <td className="p-3 max-w-xs truncate">{p.title}</td>
                    <td className="p-3">{p.brand ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
