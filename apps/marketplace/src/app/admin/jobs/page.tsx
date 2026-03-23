'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'

const JOB_TYPES = ['nightly-crawl', 'price-snapshot', 'canonical-recompute', 'cleanup-old-data'] as const

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
    },
  })

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
        {run.data && (
          <pre className="text-xs font-mono bg-neutral-50 p-3 rounded-xl overflow-auto">{JSON.stringify(run.data, null, 2)}</pre>
        )}
        {run.isError && <p className="text-sm text-neutral-800">{(run.error as Error).message}</p>}
      </section>

      <section>
        <h2 className="font-semibold mb-2">Schedules</h2>
        <pre className="text-xs font-mono bg-neutral-50 p-4 rounded-xl overflow-auto max-h-64">
          {schedules.isLoading ? '…' : JSON.stringify(schedules.data, null, 2)}
        </pre>
      </section>

      <section>
        <h2 className="font-semibold mb-2">Metrics</h2>
        <pre className="text-xs font-mono bg-neutral-50 p-4 rounded-xl overflow-auto max-h-64">
          {metrics.isLoading ? '…' : JSON.stringify(metrics.data, null, 2)}
        </pre>
      </section>

      <section>
        <h2 className="font-semibold mb-2">History</h2>
        <pre className="text-xs font-mono bg-neutral-50 p-4 rounded-xl overflow-auto max-h-96">
          {history.isLoading ? '…' : JSON.stringify(history.data, null, 2)}
        </pre>
      </section>
    </div>
  )
}
