'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'

export default function AdminRecoPage() {
  const qc = useQueryClient()
  const [baseId, setBaseId] = useState('1')
  const [candidateId, setCandidateId] = useState('')
  const [label, setLabel] = useState<'good' | 'ok' | 'bad'>('good')

  const stats = useQuery({
    queryKey: ['admin-reco-stats'],
    queryFn: () => api.get<unknown>(endpoints.admin.recoStats),
  })

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

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold text-neutral-800">Recommendation labeling</h1>
        <p className="text-sm text-neutral-600 mt-1">Training data for recommendation quality.</p>
      </div>

      <section className="rounded-2xl border border-neutral-200 bg-white p-5 space-y-3">
        <h2 className="font-semibold">Stats</h2>
        <pre className="text-xs font-mono bg-neutral-50 p-4 rounded-xl overflow-auto max-h-48">
          {stats.isLoading ? '…' : JSON.stringify(stats.data, null, 2)}
        </pre>
      </section>

      <section className="rounded-2xl border border-neutral-200 bg-white p-5 space-y-4">
        <h2 className="font-semibold">Label candidates for base product</h2>
        <input className="input-field text-sm w-40" value={baseId} onChange={(e) => setBaseId(e.target.value)} />
        <pre className="text-xs font-mono bg-neutral-900 text-neutral-50 p-4 rounded-xl overflow-auto max-h-80">
          {labeling.isLoading ? 'Loading…' : JSON.stringify(labeling.data, null, 2)}
        </pre>
      </section>

      <section className="rounded-2xl border border-neutral-200 bg-white p-5 space-y-3">
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
            Save
          </button>
        </div>
        {save.data && <pre className="text-xs font-mono bg-neutral-50 p-3 rounded-xl">{JSON.stringify(save.data, null, 2)}</pre>}
        {save.isError && <p className="text-sm text-neutral-800">{(save.error as Error).message}</p>}
      </section>
    </div>
  )
}
