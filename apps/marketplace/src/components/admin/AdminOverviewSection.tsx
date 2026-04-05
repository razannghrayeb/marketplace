'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'
import { useAdminBasePath } from '@/components/admin/AdminBasePathContext'

type Stats = {
  totalProducts: number
  hiddenProducts: number
  flaggedProducts: number
  totalCanonicals: number
  productsWithoutCanonical: number
  priceRecordsToday: number
}

export function AdminOverviewSection() {
  const base = useAdminBasePath()
  const isBusinessShell = base === '/dashboard'

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-stats', base],
    queryFn: async () => {
      const res = (await api.get<unknown>(endpoints.admin.stats)) as Record<string, unknown>
      if (res?.success === false) {
        const err = res.error as { message?: string } | undefined
        throw new Error(err?.message ?? 'Failed to load stats')
      }
      if (typeof res?.totalProducts === 'number') return res as unknown as Stats
      const inner = res?.data as Stats | undefined
      if (inner && typeof inner.totalProducts === 'number') return inner
      throw new Error('Unexpected stats response')
    },
  })

  const s = data
  const title = isBusinessShell ? 'Business overview' : 'Admin overview'
  const hint = isBusinessShell
    ? 'Same tools and API calls as admin. Backend /admin/* routes require admin rights.'
    : 'Moderation, canonicals, jobs, and API console.'

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold text-neutral-800">{title}</h1>
        <p className="text-neutral-600 mt-1 text-sm">{hint}</p>
      </div>

      {isLoading && <p className="text-neutral-500">Loading stats…</p>}
      {error && <p className="text-neutral-800">{(error as Error).message}</p>}

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
            <div key={String(label)} className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-neutral-500">{label}</p>
              <p className="text-2xl font-semibold text-neutral-900 mt-1">{val}</p>
            </div>
          ))}
        </div>
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
