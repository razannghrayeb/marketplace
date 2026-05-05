'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
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
import { useAdminBasePath } from '@/components/admin/AdminBasePathContext'

type Stats = {
  totalProducts: number | null
  hiddenProducts: number | null
  flaggedProducts: number | null
  totalCanonicals: number | null
  productsWithoutCanonical: number | null
  priceRecordsToday: number | null
  warning?: string
}

export function AdminOverviewSection() {
  const base = useAdminBasePath()
  const isBusinessShell = base === '/dashboard'

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-stats', base],
    queryFn: async () => {
      const fallbackFromListEndpoints = async (warning?: string): Promise<Stats> => {
        let flaggedProducts: number | null = null
        let hiddenProducts: number | null = null
        let totalCanonicals: number | null = null

        try {
          const flagged = (await api.get<unknown>(endpoints.admin.flagged, { page: 1, limit: 1 })) as Record<string, unknown>
          const n = flagged.total
          if (typeof n === 'number' && Number.isFinite(n)) flaggedProducts = n
        } catch {
          // ignore
        }
        try {
          const hidden = (await api.get<unknown>(endpoints.admin.hidden, { page: 1, limit: 1 })) as Record<string, unknown>
          const n = hidden.total
          if (typeof n === 'number' && Number.isFinite(n)) hiddenProducts = n
        } catch {
          // ignore
        }
        try {
          const canon = (await api.get<unknown>(endpoints.admin.canonicals)) as Record<string, unknown>
          const list = canon.canonicals
          if (Array.isArray(list)) totalCanonicals = list.length
        } catch {
          // ignore
        }

        return {
          totalProducts: null,
          hiddenProducts,
          flaggedProducts,
          totalCanonicals,
          productsWithoutCanonical: null,
          priceRecordsToday: null,
          warning,
        }
      }

      try {
        const res = (await api.get<unknown>(endpoints.admin.stats)) as Record<string, unknown>
        if (res?.success === false) {
          const err = res.error as { message?: string } | undefined
          return fallbackFromListEndpoints(err?.message ?? 'Stats endpoint unavailable')
        }
        if (typeof res?.totalProducts === 'number') {
          return {
            totalProducts: res.totalProducts as number,
            hiddenProducts: (res.hiddenProducts as number) ?? null,
            flaggedProducts: (res.flaggedProducts as number) ?? null,
            totalCanonicals: (res.totalCanonicals as number) ?? null,
            productsWithoutCanonical: (res.productsWithoutCanonical as number) ?? null,
            priceRecordsToday: (res.priceRecordsToday as number) ?? null,
          }
        }
        const inner = res?.data as Record<string, unknown> | undefined
        if (inner && typeof inner.totalProducts === 'number') {
          return {
            totalProducts: inner.totalProducts as number,
            hiddenProducts: (inner.hiddenProducts as number) ?? null,
            flaggedProducts: (inner.flaggedProducts as number) ?? null,
            totalCanonicals: (inner.totalCanonicals as number) ?? null,
            productsWithoutCanonical: (inner.productsWithoutCanonical as number) ?? null,
            priceRecordsToday: (inner.priceRecordsToday as number) ?? null,
          }
        }
        return fallbackFromListEndpoints('Stats endpoint unavailable')
      } catch {
        return fallbackFromListEndpoints('Stats endpoint unavailable')
      }
    },
    retry: false,
  })

  const s = data
  const title = isBusinessShell ? 'Business overview' : 'Admin overview'
  const hint = isBusinessShell
    ? 'Same tools and API calls as admin. Backend /admin/* routes require admin rights.'
    : 'Moderation, canonicals, jobs, and API console.'

  const histogramData = s
    ? [
        { name: 'Products', value: s.totalProducts ?? 0 },
        { name: 'Flagged', value: s.flaggedProducts ?? 0 },
        { name: 'Hidden', value: s.hiddenProducts ?? 0 },
        { name: 'Canonicals', value: s.totalCanonicals ?? 0 },
        { name: 'No canonical', value: s.productsWithoutCanonical ?? 0 },
        { name: 'Price today', value: s.priceRecordsToday ?? 0 },
      ]
    : []

  const moderationBreakdown = s
    ? [
        { name: 'Flagged', value: s.flaggedProducts ?? 0 },
        { name: 'Hidden', value: s.hiddenProducts ?? 0 },
        {
          name: 'Other',
          value: Math.max(
            0,
            (s.totalProducts ?? 0) - (s.flaggedProducts ?? 0) - (s.hiddenProducts ?? 0),
          ),
        },
      ]
    : []
  const quickHistogram = s
    ? [
        { name: 'Products', value: s.totalProducts ?? 0 },
        { name: 'Flagged', value: s.flaggedProducts ?? 0 },
        { name: 'Hidden', value: s.hiddenProducts ?? 0 },
        { name: 'Canonicals', value: s.totalCanonicals ?? 0 },
        { name: 'No canonical', value: s.productsWithoutCanonical ?? 0 },
        { name: 'Price today', value: s.priceRecordsToday ?? 0 },
      ]
    : []
  const quickHistogramMax = Math.max(1, ...quickHistogram.map((item) => item.value))

  return (
    <div className="space-y-8">
      <div className="rounded-3xl border border-[#0a0a0a]/10 bg-white/90 p-6 shadow-sm">
        <h1 className="font-display text-3xl font-bold tz-burgundy">{title}</h1>
        <p className="text-[#161616]/65 mt-1 text-sm">{hint}</p>
      </div>

      {isLoading && <p className="text-[#0a0a0a]/65">Loading stats…</p>}
      {error && <p className="text-[#161616]">{(error as Error).message}</p>}
      {s?.warning && (
        <p className="text-xs text-[#0a0a0a]/85 bg-[#ffffff] border border-[#0a0a0a]/12 rounded-lg px-3 py-2">
          {s.warning}. Showing available fallback counters.
        </p>
      )}

      {s && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            ['Total products', s.totalProducts],
            ['Flagged', s.flaggedProducts],
            ['Hidden', s.hiddenProducts],
            ['Canonicals', s.totalCanonicals],
            ['Without canonical', s.productsWithoutCanonical],
            ['Price records today', s.priceRecordsToday],
          ].map(([label, val]) => (
            <div key={String(label)} className="rounded-2xl border border-[#0a0a0a]/12 bg-[#ffffff] p-5 shadow-sm ring-1 ring-black/5">
              <p className="text-xs uppercase tracking-wide text-[#0a0a0a]/70">{label}</p>
              <p className="text-2xl font-semibold tz-burgundy mt-1 tabular-nums">
                {typeof val === 'number' && Number.isFinite(val) ? val.toLocaleString() : '—'}
              </p>
            </div>
          ))}
        </div>
      )}

      {s && (
        <section className="rounded-2xl border border-[#0a0a0a]/12 bg-[#ffffff] p-5 shadow-sm ring-1 ring-black/5">
          <h2 className="font-semibold tz-burgundy mb-3">Histogram · Quick overview</h2>
          <div className="space-y-2.5">
            {quickHistogram.map((item) => {
              const widthPct = Math.max(8, Math.round((item.value / quickHistogramMax) * 100))
              return (
                <div
                  key={`quick-hist-${item.name}`}
                  className="grid grid-cols-[minmax(100px,170px)_1fr_auto] items-center gap-2.5"
                >
                  <span className="text-xs text-[#161616]/70">{item.name}</span>
                  <div className="h-2.5 rounded-full bg-[#f2e9e2] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-brand"
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                  <span className="text-xs font-semibold tabular-nums tz-burgundy">{item.value}</span>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {s && (
        <section className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-[#0a0a0a]/12 bg-[#ffffff] p-5 shadow-sm ring-1 ring-black/5">
            <h2 className="font-semibold tz-burgundy mb-3">Histogram · Overview counts</h2>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={histogramData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="value" fill="#2a2623" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="rounded-2xl border border-[#0a0a0a]/12 bg-[#ffffff] p-5 shadow-sm ring-1 ring-black/5">
            <h2 className="font-semibold tz-burgundy mb-3">Moderation mix</h2>
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={moderationBreakdown}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={56}
                  outerRadius={92}
                  paddingAngle={2}
                >
                  <Cell fill="#3d3030" />
                  <Cell fill="#2a2623" />
                  <Cell fill="#e8dbd2" />
                </Pie>
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      <div className="flex flex-wrap gap-3">
        <Link href={`${base}/moderation`} className="btn-primary text-sm">
          Moderation
        </Link>
        <Link href={`${base}/console`} className="btn-secondary text-sm">
          API console
        </Link>
        <Link href={`${base}/system`} className="btn-secondary text-sm">
          System health
        </Link>
      </div>
    </div>
  )
}
