'use client'

import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'

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

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold text-neutral-800">System</h1>
        <p className="text-sm text-neutral-600 mt-1">Health checks and Prometheus metrics (text).</p>
      </div>

      <section className="grid md:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-neutral-200 bg-white p-4">
          <h2 className="font-semibold text-sm mb-2">GET {endpoints.health.live}</h2>
          <pre className="text-xs font-mono bg-neutral-50 p-3 rounded-xl overflow-auto max-h-40">
            {live.isLoading ? '…' : JSON.stringify(live.data, null, 2)}
          </pre>
        </div>
        <div className="rounded-2xl border border-neutral-200 bg-white p-4">
          <h2 className="font-semibold text-sm mb-2">GET {endpoints.health.ready}</h2>
          <pre className="text-xs font-mono bg-neutral-50 p-3 rounded-xl overflow-auto max-h-40">
            {ready.isLoading ? '…' : JSON.stringify(ready.data, null, 2)}
          </pre>
        </div>
      </section>

      <section className="rounded-2xl border border-neutral-200 bg-white p-4">
        <h2 className="font-semibold text-sm mb-2">GET {endpoints.health.detailed}</h2>
        <pre className="text-xs font-mono bg-neutral-50 p-3 rounded-xl overflow-auto max-h-64">
          {detailed.isLoading ? '…' : JSON.stringify(detailed.data, null, 2)}
        </pre>
      </section>

      <section className="rounded-2xl border border-neutral-200 bg-white p-4">
        <h2 className="font-semibold text-sm mb-2">GET {endpoints.metrics}</h2>
        {prom.isLoading ? (
          <p className="text-sm text-neutral-500">Loading…</p>
        ) : (
          <pre className="text-xs font-mono bg-neutral-900 text-neutral-50 p-4 rounded-xl overflow-auto max-h-[480px] whitespace-pre-wrap">
            {typeof prom.data?.body === 'string' ? prom.data.body : JSON.stringify(prom.data, null, 2)}
          </pre>
        )}
      </section>
    </div>
  )
}
