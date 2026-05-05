'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from 'recharts'
import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'

type RecoLabel = 'good' | 'ok' | 'bad'

type BatchRow = {
  baseProductId: number
  candidateProductId: number
  label: RecoLabel
  labelerId?: string
}

type SeriesRow = { name: string; value: number }
type CandidateRow = { id: number; title: string; score: number | null; label: string | null }
type LabelRow = { baseProductId: number; candidateProductId: number; label: string; labelerId: string; createdAt: string }
type ProductHint = { id: number; title: string }

const CHART_COLORS = ['#2a2623', '#7d4b3a', '#3d3030', '#c9ae9f', '#b99e90', '#a56f5a']

function parseNum(v: string): number | null {
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : null
}

function unwrapData(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value
  const obj = value as Record<string, unknown>
  if ('data' in obj && obj.data != null) return obj.data
  return value
}

function toSeries(input: unknown): SeriesRow[] {
  if (!input || typeof input !== 'object') return []
  const obj = input as Record<string, unknown>
  return Object.entries(obj)
    .map(([name, raw]) => ({
      name,
      value: typeof raw === 'number' && Number.isFinite(raw) ? raw : parseNum(String(raw ?? '')) ?? 0,
    }))
}

function numberFrom(input: unknown, fallback = 0): number {
  if (typeof input === 'number' && Number.isFinite(input)) return input
  if (typeof input === 'string') {
    const n = parseNum(input)
    if (n != null) return n
  }
  return fallback
}

function normalizeCandidates(payload: unknown): CandidateRow[] {
  const unwrapped = unwrapData(payload)
  const obj = (unwrapped && typeof unwrapped === 'object' ? unwrapped : {}) as Record<string, unknown>
  const arr =
    (Array.isArray(obj.candidates) && obj.candidates) ||
    (Array.isArray(obj.results) && obj.results) ||
    (Array.isArray(obj.items) && obj.items) ||
    (Array.isArray(unwrapped) ? unwrapped : []) ||
    []

  return (arr as unknown[])
    .map((item) => {
      const row = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
      const id = numberFrom(row.candidateProductId ?? row.productId ?? row.id, 0)
      if (id <= 0) return null
      const scoreRaw = row.score ?? row.similarity ?? row.rankScore
      return {
        id,
        title: String(row.title ?? row.productTitle ?? `Product ${id}`),
        score:
          typeof scoreRaw === 'number' && Number.isFinite(scoreRaw)
            ? scoreRaw
            : typeof scoreRaw === 'string' && scoreRaw.trim()
              ? Number(scoreRaw)
              : null,
        label: row.label ? String(row.label) : null,
      } as CandidateRow
    })
    .filter((row): row is CandidateRow => !!row)
}

function normalizeLabels(payload: unknown): LabelRow[] {
  const unwrapped = unwrapData(payload)
  const obj = (unwrapped && typeof unwrapped === 'object' ? unwrapped : {}) as Record<string, unknown>
  const arr =
    (Array.isArray(obj.labels) && obj.labels) ||
    (Array.isArray(obj.rows) && obj.rows) ||
    (Array.isArray(obj.results) && obj.results) ||
    (Array.isArray(unwrapped) ? unwrapped : []) ||
    []

  return (arr as unknown[])
    .map((item) => {
      const row = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
      const baseProductId = numberFrom(row.baseProductId ?? row.base_id, 0)
      const candidateProductId = numberFrom(row.candidateProductId ?? row.candidate_id ?? row.productId, 0)
      if (baseProductId <= 0 || candidateProductId <= 0) return null
      return {
        baseProductId,
        candidateProductId,
        label: String(row.label ?? 'unknown'),
        labelerId: String(row.labelerId ?? row.labeler_id ?? 'n/a'),
        createdAt: String(row.createdAt ?? row.created_at ?? ''),
      } as LabelRow
    })
    .filter((row): row is LabelRow => !!row)
}

function normalizeRows(raw: string): BatchRow[] {
  const parsed = JSON.parse(raw) as unknown
  if (!Array.isArray(parsed)) throw new Error('Batch must be a JSON array')
  const out: BatchRow[] = []
  for (const row of parsed) {
    if (!row || typeof row !== 'object') throw new Error('Each batch item must be an object')
    const obj = row as Record<string, unknown>
    const base = typeof obj.baseProductId === 'number' ? obj.baseProductId : parseInt(String(obj.baseProductId ?? ''), 10)
    const cand =
      typeof obj.candidateProductId === 'number'
        ? obj.candidateProductId
        : parseInt(String(obj.candidateProductId ?? ''), 10)
    const label = String(obj.label ?? '') as RecoLabel
    if (!Number.isFinite(base) || !Number.isFinite(cand)) {
      throw new Error('Each row needs numeric baseProductId and candidateProductId')
    }
    if (!['good', 'ok', 'bad'].includes(label)) {
      throw new Error('Each row label must be one of: good, ok, bad')
    }
    out.push({
      baseProductId: base,
      candidateProductId: cand,
      label,
      ...(obj.labelerId ? { labelerId: String(obj.labelerId) } : {}),
    })
  }
  return out
}

function StatCard({ label, value, tone = 'neutral' }: { label: string; value: string | number; tone?: 'neutral' | 'violet' }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <p className="text-xs uppercase tracking-wider text-neutral-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone === 'violet' ? 'text-[#2a2623]' : 'text-neutral-900'}`}>{value}</p>
    </div>
  )
}

export default function AdminRecoPage() {
  const qc = useQueryClient()
  const [baseId, setBaseId] = useState('')
  const [candidateId, setCandidateId] = useState('')
  const [label, setLabel] = useState<RecoLabel>('good')
  const [batchText, setBatchText] = useState(
    JSON.stringify(
      [{ baseProductId: 1, candidateProductId: 2, label: 'good', labelerId: 'admin-ui' }],
      null,
      2,
    ),
  )
  const [labelsQueryBaseId, setLabelsQueryBaseId] = useState('')
  const [labelsQueryLabel, setLabelsQueryLabel] = useState<'' | RecoLabel>('')
  const [labelsQueryLimit, setLabelsQueryLimit] = useState('50')

  const stats = useQuery({
    queryKey: ['admin-reco-stats'],
    queryFn: () => api.get<unknown>(endpoints.admin.recoStats),
  })

  const baseSuggestions = useQuery({
    queryKey: ['admin-reco-base-suggestions'],
    queryFn: async () => {
      const res = await api.get<unknown>(endpoints.products.list, { page: 1, limit: 20 })
      const raw = (res as { data?: unknown[] })?.data
      const list = Array.isArray(raw) ? raw : []
      return list
        .map((item) => {
          const row = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
          const id = numberFrom(row.id ?? row.product_id, 0)
          if (id <= 0) return null
          return {
            id,
            title: String(row.title ?? row.name ?? `Product ${id}`),
          } as ProductHint
        })
        .filter((v): v is ProductHint => !!v)
        .slice(0, 8)
    },
    staleTime: 60_000,
    retry: false,
  })

  useEffect(() => {
    if (baseId.trim()) return
    const first = baseSuggestions.data?.[0]
    if (first) {
      setBaseId(String(first.id))
      return
    }
    if (baseSuggestions.isSuccess) {
      setBaseId('1')
    }
  }, [baseId, baseSuggestions.data, baseSuggestions.isSuccess])

  const labeling = useQuery({
    queryKey: ['admin-reco-label', baseId],
    queryFn: async () => {
      const id = parseInt(baseId, 10)
      if (!Number.isFinite(id)) throw new Error('Invalid base product id')
      return api.get<unknown>(endpoints.admin.recoLabel, { baseProductId: id, limit: 20 })
    },
    enabled: Number.isFinite(parseInt(baseId, 10)),
  })

  const save = useMutation({
    mutationFn: () =>
      api.post(endpoints.admin.recoLabelPost, {
        baseProductId: parseInt(baseId, 10),
        candidateProductId: parseInt(candidateId, 10),
        label,
        labelerId: 'admin-ui',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-reco-label', baseId] })
      void qc.invalidateQueries({ queryKey: ['admin-reco-stats'] })
    },
  })

  const saveBatch = useMutation({
    mutationFn: async () => {
      const labels = normalizeRows(batchText)
      return api.post(endpoints.admin.recoLabelBatch, { labels })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-reco-stats'] })
      const base = parseNum(baseId)
      if (base != null) void qc.invalidateQueries({ queryKey: ['admin-reco-label', String(base)] })
    },
  })

  const labelsList = useQuery({
    queryKey: ['admin-reco-labels', labelsQueryBaseId, labelsQueryLabel, labelsQueryLimit],
    queryFn: async () => {
      const base = parseNum(labelsQueryBaseId)
      const limit = parseNum(labelsQueryLimit)
      return api.get<unknown>(endpoints.admin.recoLabels, {
        ...(base != null ? { baseProductId: base } : {}),
        ...(labelsQueryLabel ? { label: labelsQueryLabel } : {}),
        ...(limit != null ? { limit } : {}),
      })
    },
    retry: false,
  })

  const exportLabelsCsv = useMutation({
    mutationFn: async () => {
      const base = parseNum(labelsQueryBaseId)
      const limit = parseNum(labelsQueryLimit)
      return api.getRaw(endpoints.admin.recoLabels, {
        ...(base != null ? { baseProductId: base } : {}),
        ...(labelsQueryLabel ? { label: labelsQueryLabel } : {}),
        ...(limit != null ? { limit } : {}),
        format: 'csv',
      })
    },
    onSuccess: (raw) => {
      const text = typeof raw.body === 'string' ? raw.body : JSON.stringify(raw.body, null, 2)
      const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'reco-labels-export.csv'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    },
  })

  const statsError = (stats.data as { success?: boolean; error?: { message?: string } } | undefined)?.success === false
    ? ((stats.data as { error?: { message?: string } }).error?.message ?? 'Failed to load stats')
    : null
  const labelingError = (labeling.data as { success?: boolean; error?: { message?: string } } | undefined)?.success === false
    ? ((labeling.data as { error?: { message?: string } }).error?.message ?? 'Failed to load candidates')
    : null
  const labelsError = (labelsList.data as { success?: boolean; error?: { message?: string } } | undefined)?.success === false
    ? ((labelsList.data as { error?: { message?: string } }).error?.message ?? 'Failed to load labels')
    : null

  const statsData = useMemo(() => {
    const root = unwrapData(stats.data)
    const obj = (root && typeof root === 'object' ? root : {}) as Record<string, unknown>
    const labels = (obj.labels && typeof obj.labels === 'object' ? obj.labels : {}) as Record<string, unknown>
    const impressions =
      (obj.impressions && typeof obj.impressions === 'object' ? obj.impressions : {}) as Record<string, unknown>

    return {
      labelsTotal: numberFrom(labels.total),
      recentLabels: numberFrom(labels.recentLabels),
      impressionsTotal: numberFrom(impressions.total),
      uniqueRequests: numberFrom(impressions.uniqueRequests),
      uniqueBaseProducts: numberFrom(impressions.uniqueBaseProducts),
      byLabel: toSeries(labels.byLabel),
      byLabeler: toSeries(labels.byLabeler).slice(0, 8),
      bySource: toSeries(impressions.bySource),
    }
  }, [stats.data])

  const candidates = useMemo(() => normalizeCandidates(labeling.data), [labeling.data])
  useEffect(() => {
    const suggestions = baseSuggestions.data
    if (!suggestions || suggestions.length === 0 || !baseId.trim() || labeling.isLoading) return
    if (candidates.length > 0) return
    if (!labelingError || !/not found/i.test(labelingError)) return
    const currentIndex = suggestions.findIndex((item) => String(item.id) === baseId)
    if (currentIndex < 0) return
    const next = suggestions[currentIndex + 1]
    if (!next) return
    const nextId = String(next.id)
    if (nextId !== baseId) setBaseId(nextId)
  }, [baseSuggestions.data, baseId, labeling.isLoading, candidates.length, labelingError])
  const labelsRows = useMemo(() => normalizeLabels(labelsList.data), [labelsList.data])
  const labelsDistributionData = useMemo<SeriesRow[]>(
    () =>
      statsData.byLabel.length > 0
        ? statsData.byLabel
        : [
            { name: 'good', value: 0 },
            { name: 'ok', value: 0 },
            { name: 'bad', value: 0 },
          ],
    [statsData.byLabel],
  )
  const impressionsSourceData = useMemo<SeriesRow[]>(
    () =>
      statsData.bySource.length > 0
        ? statsData.bySource
        : [{ name: 'No data yet', value: 1 }],
    [statsData.bySource],
  )
  const topLabelersData = useMemo<SeriesRow[]>(
    () =>
      statsData.byLabeler.length > 0
        ? statsData.byLabeler
        : [{ name: 'No labelers yet', value: 0 }],
    [statsData.byLabeler],
  )
  const isStatsEmpty =
    statsData.labelsTotal === 0 &&
    statsData.recentLabels === 0 &&
    statsData.impressionsTotal === 0 &&
    statsData.uniqueRequests === 0 &&
    statsData.uniqueBaseProducts === 0

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold text-neutral-800">Recommendation labeling</h1>
        <p className="text-sm text-neutral-600 mt-1">
          Operations dashboard for recommendation labels, candidate review, batch actions, and export.
        </p>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3 text-xs text-neutral-600">
        These charts are based on <span className="font-semibold">reco labels and impressions tables</span>, not all products.
        If labels/impressions are empty, charts will stay near zero until you save labels.
      </div>

      <section className="space-y-4">
        <h2 className="font-semibold text-neutral-900">Overview</h2>
        {statsError ? (
          <div className="rounded-xl border border-[#d8c6bb] bg-[#f7f0eb] px-4 py-3 text-sm text-[#2a2623]">{statsError}</div>
        ) : null}
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <StatCard label="Total labels" value={statsData.labelsTotal.toLocaleString()} tone="violet" />
          <StatCard label="Recent labels" value={statsData.recentLabels.toLocaleString()} />
          <StatCard label="Impressions" value={statsData.impressionsTotal.toLocaleString()} />
          <StatCard label="Unique requests" value={statsData.uniqueRequests.toLocaleString()} />
          <StatCard label="Unique base products" value={statsData.uniqueBaseProducts.toLocaleString()} />
        </div>
        {isStatsEmpty ? (
          <p className="text-xs text-neutral-600 bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2">
            Reco stats are currently empty in backend tables. Charts are shown with placeholders until first labels/impressions are saved.
          </p>
        ) : null}
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-neutral-200 bg-white p-4 sm:p-5">
          <h3 className="text-sm font-semibold text-neutral-900 mb-3">Labels distribution</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={labelsDistributionData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="value" fill="#7d4b3a" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          {statsData.byLabel.length === 0 ? <p className="text-xs text-neutral-500 mt-2">No label rows yet.</p> : null}
        </div>

        <div className="rounded-2xl border border-neutral-200 bg-white p-4 sm:p-5">
          <h3 className="text-sm font-semibold text-neutral-900 mb-3">Impressions by source</h3>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={impressionsSourceData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={85} paddingAngle={2}>
                {impressionsSourceData.map((_, idx) => (
                  <Cell
                    key={`source-${idx}`}
                    fill={statsData.bySource.length === 0 ? '#cbd5e1' : CHART_COLORS[idx % CHART_COLORS.length]}
                  />
                ))}
              </Pie>
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
          {statsData.bySource.length === 0 ? <p className="text-xs text-neutral-500 mt-2">No source rows yet.</p> : null}
        </div>
      </section>

      <section className="rounded-2xl border border-neutral-200 bg-white p-5 space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-neutral-600 mb-1">Base product id</label>
            <input className="input-field text-sm w-40" value={baseId} onChange={(e) => setBaseId(e.target.value)} />
          </div>
          <p className="text-xs text-neutral-500 pb-1">Candidates refresh automatically when base id changes.</p>
        </div>
        {baseSuggestions.data && baseSuggestions.data.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {baseSuggestions.data.map((item) => {
              const active = String(item.id) === baseId
              return (
                <button
                  key={`base-hint-${item.id}`}
                  type="button"
                  onClick={() => setBaseId(String(item.id))}
                  className={`text-xs rounded-full border px-2.5 py-1 transition-colors ${
                    active
                      ? 'border-[#d8c6bb] bg-[#f7f0eb] text-[#2a2623]'
                      : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50'
                  }`}
                >
                  {item.id}
                </button>
              )
            })}
          </div>
        ) : null}

        {!baseId.trim() ? (
          <p className="text-sm text-neutral-500">Enter a base product id to load recommendation candidates.</p>
        ) : labelingError ? (
          <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">{labelingError}</div>
        ) : candidates.length === 0 ? (
          <p className="text-sm text-neutral-500">{labeling.isLoading ? 'Loading candidates…' : 'No candidates found for this base product.'}</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-neutral-200">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-neutral-600">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Candidate</th>
                  <th className="text-left px-3 py-2 font-medium">Title</th>
                  <th className="text-left px-3 py-2 font-medium">Score</th>
                  <th className="text-left px-3 py-2 font-medium">Label</th>
                </tr>
              </thead>
              <tbody>
                {candidates.slice(0, 20).map((row) => (
                  <tr key={row.id} className="border-t border-neutral-100">
                    <td className="px-3 py-2 font-medium text-neutral-800">{row.id}</td>
                    <td className="px-3 py-2 text-neutral-700">{row.title}</td>
                    <td className="px-3 py-2 text-neutral-700">{row.score == null ? '—' : row.score.toFixed(3)}</td>
                    <td className="px-3 py-2">
                      {row.label ? (
                        <span className="inline-flex rounded-full bg-[#f4ece6] text-[#2a2623] px-2 py-0.5 text-xs font-medium">{row.label}</span>
                      ) : (
                        <span className="text-neutral-400">unlabeled</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-neutral-200 bg-white p-5 space-y-4">
          <h2 className="font-semibold">Save single label</h2>
          <div className="flex flex-wrap gap-2 items-center">
            <input
              className="input-field text-sm w-36"
              placeholder="candidate id"
              value={candidateId}
              onChange={(e) => setCandidateId(e.target.value)}
            />
            <select className="input-field text-sm" value={label} onChange={(e) => setLabel(e.target.value as typeof label)}>
              <option value="good">good</option>
              <option value="ok">ok</option>
              <option value="bad">bad</option>
            </select>
            <button
              type="button"
              className="btn-primary text-sm"
              disabled={save.isPending || !candidateId}
              onClick={() => save.mutate()}
            >
              {save.isPending ? 'Saving…' : 'Save label'}
            </button>
          </div>
          {save.isSuccess ? (
            <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">Label saved successfully.</p>
          ) : null}
          {save.isError && <p className="text-sm text-red-600">{(save.error as Error).message}</p>}
        </div>

        <div className="rounded-2xl border border-neutral-200 bg-white p-5 space-y-4">
          <h2 className="font-semibold">Save labels in batch</h2>
          <textarea
            className="input-field font-mono text-xs min-h-[180px]"
            value={batchText}
            onChange={(e) => setBatchText(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-primary text-sm"
              disabled={saveBatch.isPending}
              onClick={() => saveBatch.mutate()}
            >
              {saveBatch.isPending ? 'Saving batch…' : 'Save batch'}
            </button>
          </div>
          {saveBatch.isSuccess ? (
            <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">Batch saved successfully.</p>
          ) : null}
          {saveBatch.isError ? (
            <p className="text-sm text-red-600">{(saveBatch.error as Error).message}</p>
          ) : null}
        </div>
      </section>

      <section className="rounded-2xl border border-neutral-200 bg-white p-5 space-y-4">
        <h2 className="font-semibold">Query and export labels</h2>
        <div className="flex flex-wrap gap-2 items-end">
          <div>
            <label className="block text-xs text-neutral-600 mb-1">Base product id</label>
            <input
              className="input-field text-sm w-36"
              placeholder="optional"
              value={labelsQueryBaseId}
              onChange={(e) => setLabelsQueryBaseId(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-neutral-600 mb-1">Label</label>
            <select
              className="input-field text-sm w-28"
              value={labelsQueryLabel}
              onChange={(e) => setLabelsQueryLabel(e.target.value as '' | RecoLabel)}
            >
              <option value="">all</option>
              <option value="good">good</option>
              <option value="ok">ok</option>
              <option value="bad">bad</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-neutral-600 mb-1">Limit</label>
            <input
              className="input-field text-sm w-28"
              value={labelsQueryLimit}
              onChange={(e) => setLabelsQueryLimit(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn-secondary text-sm"
            disabled={labelsList.isFetching}
            onClick={() => void labelsList.refetch()}
          >
            {labelsList.isFetching ? 'Loading…' : 'Load labels'}
          </button>
          <button
            type="button"
            className="btn-primary text-sm"
            disabled={exportLabelsCsv.isPending}
            onClick={() => exportLabelsCsv.mutate()}
          >
            {exportLabelsCsv.isPending ? 'Exporting…' : 'Export CSV'}
          </button>
        </div>

        {labelsList.isError ? (
          <p className="text-sm text-red-600">{(labelsList.error as Error).message}</p>
        ) : null}
        {labelsError ? <p className="text-sm text-neutral-700">{labelsError}</p> : null}

        {labelsRows.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border border-neutral-200">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-neutral-600">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Base</th>
                  <th className="text-left px-3 py-2 font-medium">Candidate</th>
                  <th className="text-left px-3 py-2 font-medium">Label</th>
                  <th className="text-left px-3 py-2 font-medium">Labeler</th>
                  <th className="text-left px-3 py-2 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {labelsRows.slice(0, 100).map((row, idx) => (
                  <tr key={`${row.baseProductId}-${row.candidateProductId}-${idx}`} className="border-t border-neutral-100">
                    <td className="px-3 py-2">{row.baseProductId}</td>
                    <td className="px-3 py-2">{row.candidateProductId}</td>
                    <td className="px-3 py-2">
                      <span className="inline-flex rounded-full bg-[#f4ece6] text-[#2a2623] px-2 py-0.5 text-xs font-medium">
                        {row.label}
                      </span>
                    </td>
                    <td className="px-3 py-2">{row.labelerId}</td>
                    <td className="px-3 py-2 text-neutral-500">{row.createdAt || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : labelsList.isSuccess && !labelsError ? (
          <p className="text-sm text-neutral-500">No labels matched your filters.</p>
        ) : null}
      </section>

      <section className="rounded-2xl border border-neutral-200 bg-white p-4 sm:p-5">
        <h3 className="text-sm font-semibold text-neutral-900 mb-3">Top labelers</h3>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={topLabelersData}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip />
            <Bar dataKey="value" fill="#3d3030" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
        {statsData.byLabeler.length === 0 ? <p className="text-xs text-neutral-500 mt-2">No labeler activity yet.</p> : null}
      </section>
    </div>
  )
}
