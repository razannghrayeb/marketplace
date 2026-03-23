'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'

export default function AdminCanonicalsPage() {
  const qc = useQueryClient()
  const [canonicalId, setCanonicalId] = useState('')
  const [mergeSource, setMergeSource] = useState('')
  const [mergeTarget, setMergeTarget] = useState('')
  const [detachCanon, setDetachCanon] = useState('')
  const [detachProduct, setDetachProduct] = useState('')

  const list = useQuery({
    queryKey: ['admin-canonicals'],
    queryFn: async () => {
      const res = (await api.get<unknown>(endpoints.admin.canonicals)) as {
        canonicals?: unknown[]
        success?: boolean
        error?: { message?: string }
      }
      if (res.success === false) throw new Error(res.error?.message ?? 'Failed')
      return res
    },
  })

  const detail = useQuery({
    queryKey: ['admin-canonical', canonicalId],
    queryFn: async () => {
      if (!canonicalId.trim()) return null
      const res = (await api.get<unknown>(endpoints.admin.canonical(canonicalId.trim()))) as Record<string, unknown>
      if (res?.success === false) throw new Error((res.error as { message?: string })?.message ?? 'Failed')
      return res
    },
    enabled: !!canonicalId.trim(),
  })

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['admin-canonicals'] })

  const mergeM = useMutation({
    mutationFn: () =>
      api.post(endpoints.admin.canonicalMerge, {
        sourceId: parseInt(mergeSource, 10),
        targetId: parseInt(mergeTarget, 10),
      }),
    onSuccess: invalidate,
  })

  const detachM = useMutation({
    mutationFn: () =>
      api.post(endpoints.admin.canonicalDetach(detachCanon.trim(), detachProduct.trim()), {}),
    onSuccess: invalidate,
  })

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold text-neutral-800">Canonicals</h1>
        <p className="text-sm text-neutral-600 mt-1">Duplicate groups and merge tools.</p>
      </div>

      <section className="rounded-2xl border border-neutral-200 bg-white p-5 space-y-4">
        <h2 className="font-semibold">Merge groups</h2>
        <div className="flex flex-wrap gap-2 items-center">
          <input className="input-field text-sm w-32" placeholder="sourceId" value={mergeSource} onChange={(e) => setMergeSource(e.target.value)} />
          <input className="input-field text-sm w-32" placeholder="targetId" value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)} />
          <button
            type="button"
            className="btn-primary text-sm"
            disabled={mergeM.isPending || !mergeSource || !mergeTarget}
            onClick={() => mergeM.mutate()}
          >
            Merge
          </button>
        </div>
        {mergeM.isError && <p className="text-sm text-neutral-800">{(mergeM.error as Error).message}</p>}
      </section>

      <section className="rounded-2xl border border-neutral-200 bg-white p-5 space-y-4">
        <h2 className="font-semibold">Detach product</h2>
        <div className="flex flex-wrap gap-2">
          <input className="input-field text-sm w-32" placeholder="canonical id" value={detachCanon} onChange={(e) => setDetachCanon(e.target.value)} />
          <input className="input-field text-sm w-32" placeholder="product id" value={detachProduct} onChange={(e) => setDetachProduct(e.target.value)} />
          <button
            type="button"
            className="btn-secondary text-sm"
            disabled={detachM.isPending || !detachCanon || !detachProduct}
            onClick={() => detachM.mutate()}
          >
            Detach
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-neutral-200 bg-white p-5 space-y-4">
        <h2 className="font-semibold">Canonical detail</h2>
        <input
          className="input-field text-sm w-40"
          placeholder="Canonical ID"
          value={canonicalId}
          onChange={(e) => setCanonicalId(e.target.value)}
        />
        <pre className="text-xs font-mono bg-neutral-900 text-neutral-50 p-4 rounded-xl overflow-auto max-h-64">
          {detail.isFetching ? 'Loading…' : JSON.stringify(detail.data, null, 2)}
        </pre>
      </section>

      <section>
        <h2 className="font-semibold mb-3">List</h2>
        {list.isLoading ? (
          <p className="text-sm text-neutral-500">Loading…</p>
        ) : (
          <pre className="text-xs font-mono bg-neutral-50 p-4 rounded-xl overflow-auto max-h-[400px]">
            {JSON.stringify(list.data, null, 2)}
          </pre>
        )}
      </section>
    </div>
  )
}
