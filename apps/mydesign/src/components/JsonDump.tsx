'use client'

export function JsonDump({ data, title }: { data: unknown; title?: string }) {
  const text =
    data === undefined
      ? 'No data yet.'
      : typeof data === 'string'
        ? data
        : JSON.stringify(data, null, 2)

  return (
    <div className="surface-card">
      {title ? <h3 className="text-sm font-semibold text-neutral-800 mb-2">{title}</h3> : null}
      <pre className="text-xs font-mono text-neutral-700 overflow-auto max-h-[480px] whitespace-pre-wrap break-all">
        {text}
      </pre>
    </div>
  )
}
