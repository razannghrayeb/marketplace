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
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts'
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

type AnyObj = Record<string, unknown>
const CHART_COLORS = ['#7c3aed', '#4f46e5', '#0891b2', '#059669', '#ea580c', '#db2777']

function unwrapPayload(input: unknown): AnyObj {
  if (!input || typeof input !== 'object') return {}
  const obj = input as AnyObj
  if (obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data)) return obj.data as AnyObj
  return obj
}

function toRow(input: unknown): ProductRow | null {
  if (!input || typeof input !== 'object') return null
  const row = input as AnyObj
  const nested = (row.product && typeof row.product === 'object' ? row.product : {}) as AnyObj
  const rawId = row.id ?? row.productId ?? row.product_id
  const id = typeof rawId === 'number' ? rawId : Number(rawId)
  if (!Number.isFinite(id) || id <= 0) return null
  return {
    id,
    title: String(row.title ?? row.name ?? row.product_title ?? nested.title ?? nested.name ?? `Product ${id}`),
    brand: row.brand
      ? String(row.brand)
      : row.brand_name
        ? String(row.brand_name)
        : nested.brand
          ? String(nested.brand)
          : nested.brand_name
            ? String(nested.brand_name)
            : null,
    category: row.category ? String(row.category) : nested.category ? String(nested.category) : null,
    is_hidden: typeof row.is_hidden === 'boolean' ? row.is_hidden : undefined,
    flag_reason: row.flag_reason ? String(row.flag_reason) : row.reason ? String(row.reason) : null,
  }
}

function normalizeModerationList(payload: unknown): { products: ProductRow[]; total: number } {
  const root = unwrapPayload(payload)
  const listRaw =
    (Array.isArray(root.products) && root.products) ||
    (Array.isArray(root.items) && root.items) ||
    (Array.isArray(root.rows) && root.rows) ||
    []
  const products = (listRaw as unknown[]).map(toRow).filter((r): r is ProductRow => !!r)
  const totalRaw = root.total ?? root.count ?? root.totalItems
  const total = typeof totalRaw === 'number' ? totalRaw : Number(totalRaw)
  return {
    products,
    total: Number.isFinite(total) ? total : products.length,
  }
}

export default function AdminModerationPage() {
  const qc = useQueryClient()
  const [productId, setProductId] = useState('')
  const [batchIds, setBatchIds] = useState('1,2,3')
  const [reason, setReason] = useState('')

  const flagged = useQuery({
    queryKey: ['admin-flagged'],
    queryFn: async () => {
      const res = await api.get<unknown>(endpoints.admin.flagged, { page: 1, limit: 50 })
      if (res.success === false) throw new Error(res.error?.message ?? 'Failed')
      return normalizeModerationList(res)
    },
  })

  const hidden = useQuery({
    queryKey: ['admin-hidden'],
    queryFn: async () => {
      const res = await api.get<unknown>(endpoints.admin.hidden, { page: 1, limit: 50 })
      if (res.success === false) throw new Error(res.error?.message ?? 'Failed')
      return normalizeModerationList(res)
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

  const flaggedRows = flagged.data?.products ?? []
  const hiddenRows = hidden.data?.products ?? []
  const flaggedTotal = flagged.data?.total ?? 0
  const hiddenTotal = hidden.data?.total ?? 0

  const totalsHistogram = useMemo(
    () => [
      { name: 'Flagged', value: flaggedTotal },
      { name: 'Hidden', value: hiddenTotal },
    ],
    [flaggedTotal, hiddenTotal],
  )
  const topBrandHistogram = useMemo(() => {
    const map = new Map<string, { flagged: number; hidden: number }>()
    for (const row of flaggedRows) {
      const brand = (row.brand || 'Unknown').trim() || 'Unknown'
      const curr = map.get(brand) ?? { flagged: 0, hidden: 0 }
      curr.flagged += 1
      map.set(brand, curr)
    }
    for (const row of hiddenRows) {
      const brand = (row.brand || 'Unknown').trim() || 'Unknown'
      const curr = map.get(brand) ?? { flagged: 0, hidden: 0 }
      curr.hidden += 1
      map.set(brand, curr)
    }
    const rows = Array.from(map.entries())
      .map(([brand, v]) => ({ brand, flagged: v.flagged, hidden: v.hidden, total: v.flagged + v.hidden }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8)
    if (rows.length > 0) return rows
    return [{ brand: 'No data', flagged: 0, hidden: 0, total: 0 }]
  }, [flaggedRows, hiddenRows])
  const flaggedReasonPie = useMemo(() => {
    const map = new Map<string, number>()
    for (const row of flaggedRows) {
      const key = (row.flag_reason || 'unspecified').trim() || 'unspecified'
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    const rows = Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6)
    if (rows.length > 0) return rows
    return [{ name: 'no reasons yet', value: 1 }]
  }, [flaggedRows])

  return (
    <div className="space-y-10">
      <div>
        <h1 className="font-display text-3xl font-bold text-neutral-800">Moderation</h1>
        <p className="text-sm text-neutral-600 mt-1">Flagged and hidden catalog items.</p>
        <p className="text-xs text-neutral-500 mt-2">
          Use this page to hide/unhide products, flag/unflag suspicious items, batch hide by IDs, and review current flagged/hidden lists.
        </p>
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

      <section className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-neutral-200 bg-white p-5">
          <h2 className="font-semibold text-neutral-800 mb-3">Histogram · Moderation totals</h2>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={totalsHistogram}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="value" fill="#7c3aed" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="rounded-2xl border border-neutral-200 bg-white p-5">
          <h2 className="font-semibold text-neutral-800 mb-3">Distribution · Flag reasons</h2>
          <ResponsiveContainer width="100%" height={230}>
            <PieChart>
              <Pie data={flaggedReasonPie} dataKey="value" nameKey="name" innerRadius={46} outerRadius={82} paddingAngle={2}>
                {flaggedReasonPie.map((_, idx) => (
                  <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="rounded-2xl border border-neutral-200 bg-white p-5">
        <h2 className="font-semibold text-neutral-800 mb-3">Histogram · Top brands impacted</h2>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={topBrandHistogram}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="brand" tick={{ fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={45} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="flagged" stackId="a" fill="#7c3aed" radius={[4, 4, 0, 0]} />
            <Bar dataKey="hidden" stackId="a" fill="#4f46e5" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
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
                {(flagged.data?.products ?? []).length === 0 ? (
                  <tr className="border-t border-neutral-100">
                    <td colSpan={4} className="p-3 text-neutral-500 text-sm">
                      No flagged products right now.
                    </td>
                  </tr>
                ) : (
                  (flagged.data?.products ?? []).map((p) => (
                    <tr key={p.id} className="border-t border-neutral-100">
                      <td className="p-3 font-mono">{p.id}</td>
                      <td className="p-3 max-w-xs truncate">{p.title}</td>
                      <td className="p-3">{p.brand ?? '—'}</td>
                      <td className="p-3 text-xs">{p.flag_reason ?? '—'}</td>
                    </tr>
                  ))
                )}
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
                {(hidden.data?.products ?? []).length === 0 ? (
                  <tr className="border-t border-neutral-100">
                    <td colSpan={3} className="p-3 text-neutral-500 text-sm">
                      No hidden products right now.
                    </td>
                  </tr>
                ) : (
                  (hidden.data?.products ?? []).map((p) => (
                    <tr key={p.id} className="border-t border-neutral-100">
                      <td className="p-3 font-mono">{p.id}</td>
                      <td className="p-3 max-w-xs truncate">{p.title}</td>
                      <td className="p-3">{p.brand ?? '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
