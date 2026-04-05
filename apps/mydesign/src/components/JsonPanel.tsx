'use client'

export function JsonPanel({
  title,
  data,
  error,
  loading,
}: {
  title: string
  data: unknown
  error?: string | null
  loading?: boolean
}) {
  return (
    <div className="surface-card">
      <h3 className="text-sm font-semibold text-neutral-800 mb-2">{title}</h3>
      {loading && <p className="text-sm text-neutral-500">Loading…</p>}
      {error && <p className="text-sm text-red-600 whitespace-pre-wrap">{error}</p>}
      {!loading && !error && (
        <pre className="text-xs bg-neutral-900 text-emerald-100 rounded-xl p-4 overflow-auto max-h-[480px]">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  )
}
