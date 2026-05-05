'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
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

type Obj = Record<string, unknown>

function unwrapPayload(value: unknown): Obj {
  if (!value || typeof value !== 'object') return {}
  const obj = value as Obj
  const data = obj.data
  if (data && typeof data === 'object' && !Array.isArray(data)) return data as Obj
  return obj
}

function tone(value: unknown): 'good' | 'warn' | 'bad' | 'unknown' {
  const s = String(value ?? '').toLowerCase()
  if (!s) return 'unknown'
  if (['ok', 'green', 'healthy', 'up', 'true', 'closed'].includes(s)) return 'good'
  if (['degraded', 'yellow', 'warning', 'open'].includes(s)) return 'warn'
  if (['down', 'red', 'failed', 'false'].includes(s)) return 'bad'
  return 'unknown'
}

function toneClass(t: 'good' | 'warn' | 'bad' | 'unknown'): string {
  if (t === 'good') return 'bg-emerald-50 border-emerald-200 text-emerald-700'
  if (t === 'warn') return 'bg-amber-50 border-amber-200 text-amber-700'
  if (t === 'bad') return 'bg-[#f7f0eb] border-[#d8c6bb] text-[#2a2623]'
  return 'bg-slate-50 border-slate-200 text-slate-600'
}

function parsePromSummary(text: string): {
  metricFamilies: number
  uniqueMetrics: number
  up: number | null
  scrapeDuration: number | null
  rows: Array<{ name: string; value: number }>
} {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const metricLines = lines.filter((l) => !l.startsWith('#'))
  const rx = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^}]*\})?\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)$/
  const firstSeen = new Set<string>()
  const rows: Array<{ name: string; value: number }> = []
  let up: number | null = null
  let scrapeDuration: number | null = null

  for (const line of metricLines) {
    const m = line.match(rx)
    if (!m) continue
    const name = m[1]
    const value = Number(m[3])
    if (!Number.isFinite(value)) continue
    if (!firstSeen.has(name)) {
      rows.push({ name, value })
      firstSeen.add(name)
    }
    if (name === 'up' && up == null) up = value
    if (name === 'scrape_duration_seconds' && scrapeDuration == null) scrapeDuration = value
  }

  return {
    metricFamilies: metricLines.length,
    uniqueMetrics: rows.length,
    up,
    scrapeDuration,
    rows: rows.slice(0, 12),
  }
}

function StatusPill({ label, value }: { label: string; value: unknown }) {
  const t = tone(value)
  return (
    <div className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium ${toneClass(t)}`}>
      <span className="text-slate-500">{label}: </span>
      <span>{String(value ?? 'n/a')}</span>
    </div>
  )
}

export default function AdminSystemPage() {
  const live = useQuery({
    queryKey: ['health-live'],
    queryFn: () => api.get<unknown>(endpoints.health.live),
  })
  const ready = useQuery({
    queryKey: ['health-ready'],
    queryFn: () => api.get<unknown>(endpoints.health.ready),
  })
  const detailed = useQuery({
    queryKey: ['health-detailed'],
    queryFn: () => api.get<unknown>(endpoints.health.detailed),
  })
  const prom = useQuery({
    queryKey: ['metrics-prometheus'],
    queryFn: () => api.getRaw(endpoints.metrics),
  })

  const liveData = unwrapPayload(live.data)
  const readyData = unwrapPayload(ready.data)
  const detailedData = unwrapPayload(detailed.data)
  const circuits =
    detailedData.circuits && typeof detailedData.circuits === 'object'
      ? (detailedData.circuits as Record<string, unknown>)
      : {}

  const liveOk = Boolean(liveData.ok)
  const promText = typeof prom.data?.body === 'string' ? prom.data.body : ''
  const promSummary = promText ? parsePromSummary(promText) : null

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold text-neutral-800">System</h1>
        <p className="text-sm text-neutral-600 mt-1">Operational dashboard for health and metrics.</p>
      </div>

      <section className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-neutral-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-neutral-500">Live</p>
          <p className={`text-2xl font-semibold mt-1 ${liveOk ? 'text-emerald-700' : 'text-[#2a2623]'}`}>
            {live.isLoading ? '…' : liveOk ? 'Up' : 'Down'}
          </p>
        </div>
        <div className="rounded-2xl border border-neutral-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-neutral-500">Search</p>
          <p className="text-2xl font-semibold mt-1 text-neutral-900">
            {ready.isLoading ? '…' : String(readyData.search ?? 'n/a')}
          </p>
        </div>
        <div className="rounded-2xl border border-neutral-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-neutral-500">Database</p>
          <p className="text-2xl font-semibold mt-1 text-neutral-900">
            {ready.isLoading ? '…' : String(readyData.db ?? 'n/a')}
          </p>
        </div>
        <div className="rounded-2xl border border-neutral-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-neutral-500">Circuits</p>
          <p className="text-2xl font-semibold mt-1 text-neutral-900">{detailed.isLoading ? '…' : Object.keys(circuits).length}</p>
        </div>
      </section>

      <section className="rounded-2xl border border-neutral-200 bg-white p-4 sm:p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold text-neutral-900">Service checks</h2>
          <button
            type="button"
            onClick={() => {
              void live.refetch()
              void ready.refetch()
              void detailed.refetch()
              void prom.refetch()
            }}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-700 hover:bg-white"
          >
            Refresh
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusPill label="Live" value={liveData.ok} />
          <StatusPill label="Search" value={readyData.search} />
          <StatusPill label="DB" value={readyData.db} />
          {Object.entries(circuits).slice(0, 8).map(([name, value]) => {
            const state =
              value && typeof value === 'object'
                ? (value as Record<string, unknown>).state ?? (value as Record<string, unknown>).status
                : value
            return <StatusPill key={name} label={name} value={state} />
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-neutral-200 bg-white p-4 sm:p-5 space-y-4">
        <h2 className="font-semibold text-neutral-900">Metrics overview</h2>
        {prom.isLoading ? (
          <p className="text-sm text-neutral-500">Loading metrics…</p>
        ) : !promSummary ? (
          <p className="text-sm text-neutral-600">Metrics unavailable.</p>
        ) : (
          <>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                <p className="text-[11px] uppercase tracking-wide text-neutral-500">Metric families</p>
                <p className="text-xl font-semibold text-neutral-900 mt-0.5">{promSummary.metricFamilies}</p>
              </div>
              <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                <p className="text-[11px] uppercase tracking-wide text-neutral-500">Unique metrics</p>
                <p className="text-xl font-semibold text-neutral-900 mt-0.5">{promSummary.uniqueMetrics}</p>
              </div>
              <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                <p className="text-[11px] uppercase tracking-wide text-neutral-500">Up</p>
                <p className={`text-xl font-semibold mt-0.5 ${promSummary.up === 1 ? 'text-emerald-700' : 'text-[#2a2623]'}`}>
                  {promSummary.up == null ? 'n/a' : promSummary.up}
                </p>
              </div>
              <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                <p className="text-[11px] uppercase tracking-wide text-neutral-500">Scrape duration</p>
                <p className="text-xl font-semibold text-neutral-900 mt-0.5">
                  {promSummary.scrapeDuration == null ? 'n/a' : `${promSummary.scrapeDuration.toFixed(3)}s`}
                </p>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-neutral-200">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-neutral-600">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Metric</th>
                    <th className="text-right px-3 py-2 font-medium">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {promSummary.rows.map((row) => (
                    <tr key={row.name} className="border-t border-neutral-100">
                      <td className="px-3 py-2 font-mono text-xs text-neutral-700">{row.name}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-neutral-900">{row.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="rounded-xl border border-neutral-200 p-3">
              <p className="text-sm font-semibold text-neutral-900 mb-2">Histogram · key metric values</p>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={promSummary.rows.slice(0, 8)}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-18} textAnchor="end" height={48} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="value" fill="#7d4b3a" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </section>

      <p className="text-xs text-neutral-500">
        Need raw payload for debugging? Use{' '}
        <Link href="/admin/console?group=System" className="text-[#2a2623] hover:underline">
          API console
        </Link>
        .
      </p>

      {(live.isError || ready.isError || detailed.isError || prom.isError) && (
        <section className="rounded-xl border border-[#d8c6bb] bg-[#f7f0eb] px-4 py-3 text-sm text-[#2a2623]">
          Some system checks failed to load. Verify backend connectivity and admin permissions.
        </section>
      )}
    </div>
  )
}
