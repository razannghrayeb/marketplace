'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'
import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'

type AnyObj = Record<string, unknown>

function toArray(input: unknown): AnyObj[] {
  if (Array.isArray(input)) return input.filter((x): x is AnyObj => !!x && typeof x === 'object')
  return []
}

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

  const listObj = (list.data && typeof list.data === 'object' ? list.data : {}) as AnyObj
  const listRows = useMemo(
    () =>
      toArray(listObj.canonicals)
        .map((c) => {
          const products = toArray(c.products)
          return {
            id: String(c.id ?? c.canonicalId ?? '—'),
            label: String(c.label ?? c.name ?? c.canonical_label ?? '—'),
            productCount: products.length || Number(c.productCount ?? c.product_count ?? 0),
          }
        })
        .filter((r) => r.id !== '—'),
    [listObj],
  )

  const detailObj = (detail.data && typeof detail.data === 'object' ? detail.data : {}) as AnyObj
  const detailProducts = useMemo(
    () =>
      toArray(detailObj.products).map((p) => ({
        id: String(p.id ?? p.productId ?? '—'),
        title: String(p.title ?? p.name ?? '—'),
        brand: String(p.brand ?? '—'),
      })),
    [detailObj],
  )
  const canonicalSizeHistogram = useMemo(
    () => {
      const bins = {
        '1': 0,
        '2-3': 0,
        '4-7': 0,
        '8+': 0,
      }
      for (const row of listRows) {
        const n = Number(row.productCount) || 0
        if (n <= 1) bins['1'] += 1
        else if (n <= 3) bins['2-3'] += 1
        else if (n <= 7) bins['4-7'] += 1
        else bins['8+'] += 1
      }
      return Object.entries(bins).map(([bucket, groups]) => ({ bucket, groups }))
    },
    [listRows],
  )

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
        {mergeM.isSuccess && <p className="text-sm text-emerald-700">Groups merged successfully.</p>}
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
        {detachM.isError && <p className="text-sm text-red-600">{(detachM.error as Error).message}</p>}
        {detachM.isSuccess && <p className="text-sm text-emerald-700">Product detached successfully.</p>}
      </section>

      <section className="rounded-2xl border border-neutral-200 bg-white p-5 space-y-4">
        <h2 className="font-semibold">Canonical detail</h2>
        <input
          className="input-field text-sm w-40"
          placeholder="Canonical ID"
          value={canonicalId}
          onChange={(e) => setCanonicalId(e.target.value)}
        />
        {detail.isFetching ? (
          <p className="text-sm text-neutral-500">Loading canonical details…</p>
        ) : !canonicalId.trim() ? (
          <p className="text-sm text-neutral-500">Enter a canonical ID to view details.</p>
        ) : detailProducts.length === 0 ? (
          <p className="text-sm text-neutral-500">No products attached or canonical not found.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-neutral-200">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-neutral-600">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Product ID</th>
                  <th className="text-left px-3 py-2 font-medium">Title</th>
                  <th className="text-left px-3 py-2 font-medium">Brand</th>
                </tr>
              </thead>
              <tbody>
                {detailProducts.map((p) => (
                  <tr key={p.id} className="border-t border-neutral-100">
                    <td className="px-3 py-2">{p.id}</td>
                    <td className="px-3 py-2">{p.title}</td>
                    <td className="px-3 py-2">{p.brand}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-neutral-200 bg-white p-5 space-y-3">
        <h2 className="font-semibold mb-3">List</h2>
        {list.isLoading ? (
          <p className="text-sm text-neutral-500">Loading…</p>
        ) : listRows.length === 0 ? (
          <p className="text-sm text-neutral-500">No canonical groups found.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-neutral-200">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-neutral-600">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Canonical ID</th>
                  <th className="text-left px-3 py-2 font-medium">Label</th>
                  <th className="text-left px-3 py-2 font-medium">Products</th>
                </tr>
              </thead>
              <tbody>
                {listRows.slice(0, 100).map((row) => (
                  <tr key={row.id} className="border-t border-neutral-100">
                    <td className="px-3 py-2">{row.id}</td>
                    <td className="px-3 py-2">{row.label}</td>
                    <td className="px-3 py-2">{row.productCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-neutral-200 bg-white p-5">
        <h2 className="font-semibold mb-3">Histogram · Canonical group sizes</h2>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={canonicalSizeHistogram}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="bucket" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip />
            <Bar dataKey="groups" fill="#7c3aed" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </section>
    </div>
  )
}
