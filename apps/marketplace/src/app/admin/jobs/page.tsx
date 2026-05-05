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

const JOB_TYPES = ['nightly-crawl', 'price-snapshot', 'canonical-recompute', 'cleanup-old-data'] as const

type AnyObj = Record<string, unknown>

function unwrap(input: unknown): AnyObj {
  if (!input || typeof input !== 'object') return {}
  const obj = input as AnyObj
  if (obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data)) return obj.data as AnyObj
  return obj
}

function pickArray(input: unknown, keys: string[]): AnyObj[] {
  if (Array.isArray(input)) return input.filter((x): x is AnyObj => !!x && typeof x === 'object')
  const obj = unwrap(input)
  for (const k of keys) {
    if (Array.isArray(obj[k])) return (obj[k] as unknown[]).filter((x): x is AnyObj => !!x && typeof x === 'object')
  }
  return []
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

export default function AdminJobsPage() {
  const qc = useQueryClient()
  const [jobType, setJobType] = useState<(typeof JOB_TYPES)[number]>('price-snapshot')

  const schedules = useQuery({
    queryKey: ['admin-job-schedules'],
    queryFn: () => api.get<unknown>(endpoints.admin.jobSchedules),
  })
  const metrics = useQuery({
    queryKey: ['admin-job-metrics'],
    queryFn: () => api.get<unknown>(endpoints.admin.jobMetrics),
  })
  const history = useQuery({
    queryKey: ['admin-job-history'],
    queryFn: () => api.get<unknown>(endpoints.admin.jobHistory),
  })

  const run = useMutation({
    mutationFn: () => api.post(endpoints.admin.jobRun(jobType), {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-job-history'] })
      void qc.invalidateQueries({ queryKey: ['admin-job-metrics'] })
      void qc.invalidateQueries({ queryKey: ['admin-job-schedules'] })
    },
  })

  const schedulesRows = useMemo(
    () => pickArray(schedules.data, ['schedules', 'items', 'jobs', 'rows']),
    [schedules.data],
  )
  const historyRows = useMemo(
    () => pickArray(history.data, ['history', 'items', 'runs', 'jobs', 'rows']),
    [history.data],
  )
  const metricsObj = useMemo(() => unwrap(metrics.data), [metrics.data])
  const metricCards = useMemo(
    () =>
      Object.entries(metricsObj)
        .map(([k, v]) => ({ key: k, value: toNumber(v) ?? (typeof v === 'boolean' ? (v ? 1 : 0) : null) }))
        .filter((x) => x.value != null)
        .slice(0, 8),
    [metricsObj],
  )
  const historyStatusChart = useMemo(() => {
    const map = new Map<string, number>()
    for (const row of historyRows) {
      const key = String(row.status ?? 'unknown').toLowerCase()
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    const baseOrder = ['queued', 'running', 'completed', 'failed']
    const merged = baseOrder.map((status) => ({ status, count: map.get(status) ?? 0 }))
    for (const [status, count] of map.entries()) {
      if (!baseOrder.includes(status)) merged.push({ status, count })
    }
    return merged
  }, [historyRows])
  const historyJobTypeChart = useMemo(() => {
    const map = new Map<string, number>()
    for (const row of historyRows) {
      const key = String(row.jobType ?? row.type ?? row.name ?? 'unknown')
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    const rows = Array.from(map.entries())
      .map(([jobType, runs]) => ({ jobType, runs }))
      .sort((a, b) => b.runs - a.runs)
      .slice(0, 8)
    if (rows.length > 0) return rows
    return JOB_TYPES.map((t) => ({ jobType: t, runs: 0 }))
  }, [historyRows])

  const runError =
    run.isError ? (run.error as Error).message : ((run.data as AnyObj | undefined)?.success === false ? String((run.data as AnyObj)?.error ?? 'Run failed') : null)
  const runSuccess = run.isSuccess && !runError

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold text-neutral-800">Jobs</h1>
        <p className="text-sm text-neutral-600 mt-1">Schedules, queue metrics, history, manual runs.</p>
      </div>

      <section className="rounded-2xl border border-neutral-200 bg-white p-5 space-y-3">
        <h2 className="font-semibold">Run job</h2>
        <div className="flex flex-wrap gap-2 items-center">
          <select className="input-field text-sm" value={jobType} onChange={(e) => setJobType(e.target.value as (typeof JOB_TYPES)[number])}>
            {JOB_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <button type="button" className="btn-primary text-sm" disabled={run.isPending} onClick={() => run.mutate()}>
            {run.isPending ? 'Queueing…' : 'Run now'}
          </button>
        </div>
        {runSuccess ? (
          <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            Job queued successfully.
          </p>
        ) : null}
        {runError ? <p className="text-sm text-[#2a2623]">{runError}</p> : null}
      </section>

      <section className="rounded-2xl border border-neutral-200 bg-white p-5 space-y-3">
        <h2 className="font-semibold">Schedules</h2>
        {schedules.isLoading ? (
          <p className="text-sm text-neutral-500">Loading schedules…</p>
        ) : schedulesRows.length === 0 ? (
          <p className="text-sm text-neutral-500">No schedule rows available.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-neutral-200">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-neutral-600">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Job</th>
                  <th className="text-left px-3 py-2 font-medium">Schedule</th>
                  <th className="text-left px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {schedulesRows.slice(0, 20).map((r, idx) => (
                  <tr key={idx} className="border-t border-neutral-100">
                    <td className="px-3 py-2">{String(r.jobType ?? r.type ?? r.name ?? '—')}</td>
                    <td className="px-3 py-2">{String(r.cron ?? r.schedule ?? r.interval ?? '—')}</td>
                    <td className="px-3 py-2">{String(r.status ?? r.enabled ?? '—')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-neutral-200 bg-white p-5 space-y-3">
        <h2 className="font-semibold">Metrics</h2>
        {metrics.isLoading ? (
          <p className="text-sm text-neutral-500">Loading metrics…</p>
        ) : metricCards.length === 0 ? (
          <p className="text-sm text-neutral-500">No numeric metrics available.</p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {metricCards.map((m) => (
              <div key={m.key} className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                <p className="text-[11px] uppercase tracking-wide text-neutral-500 truncate">{m.key}</p>
                <p className="text-xl font-semibold text-neutral-900 mt-0.5 tabular-nums">{m.value}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-neutral-200 bg-white p-5 space-y-3">
        <h2 className="font-semibold">History</h2>
        {history.isLoading ? (
          <p className="text-sm text-neutral-500">Loading history…</p>
        ) : historyRows.length === 0 ? (
          <p className="text-sm text-neutral-500">No history rows available.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-neutral-200">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-neutral-600">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Job</th>
                  <th className="text-left px-3 py-2 font-medium">Status</th>
                  <th className="text-left px-3 py-2 font-medium">Started</th>
                  <th className="text-left px-3 py-2 font-medium">Duration</th>
                </tr>
              </thead>
              <tbody>
                {historyRows.slice(0, 40).map((r, idx) => (
                  <tr key={idx} className="border-t border-neutral-100">
                    <td className="px-3 py-2">{String(r.jobType ?? r.type ?? r.name ?? '—')}</td>
                    <td className="px-3 py-2">{String(r.status ?? '—')}</td>
                    <td className="px-3 py-2">{String(r.startedAt ?? r.started_at ?? r.createdAt ?? '—')}</td>
                    <td className="px-3 py-2">{String(r.durationMs ?? r.duration_ms ?? r.duration ?? '—')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-neutral-200 bg-white p-5">
          <h2 className="font-semibold mb-3">Histogram · Job status</h2>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={historyStatusChart}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="status" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="count" fill="#7d4b3a" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="rounded-2xl border border-neutral-200 bg-white p-5">
          <h2 className="font-semibold mb-3">Histogram · Runs by job type</h2>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={historyJobTypeChart}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="jobType" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="runs" fill="#3d3030" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  )
}
