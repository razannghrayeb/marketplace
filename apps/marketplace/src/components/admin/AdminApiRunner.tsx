'use client'

import { useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api/client'
import { ADMIN_API_CATALOG, catalogGroups, type CatalogOp } from '@/lib/admin-api-catalog'
import { useAuthStore } from '@/store/auth'

function pathParamNames(template: string): string[] {
  const re = /:([a-zA-Z_][a-zA-Z0-9_]*)/g
  const found: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(template)) !== null) found.push(m[1])
  return Array.from(new Set(found))
}

function resolvePath(template: string, pathParams: Record<string, string>): string {
  return template.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, key: string) => {
    const v = pathParams[key]
    if (v == null || v === '') throw new Error(`Missing path param: ${key}`)
    return encodeURIComponent(v)
  })
}

function parseJsonObject(raw: string, label: string): Record<string, string | number> {
  const t = raw.trim()
  if (!t) return {}
  try {
    const o = JSON.parse(t) as unknown
    if (typeof o !== 'object' || o === null || Array.isArray(o)) throw new Error('must be a JSON object')
    const out: Record<string, string | number> = {}
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (typeof v === 'string' || typeof v === 'number') out[k] = v
      else if (typeof v === 'boolean') out[k] = v ? 1 : 0
      else throw new Error(`invalid value for ${k}`)
    }
    return out
  } catch (e) {
    throw new Error(`${label}: ${e instanceof Error ? e.message : 'invalid JSON'}`)
  }
}

export function AdminApiRunner() {
  const user = useAuthStore((s) => s.user)
  const groups = useMemo(() => catalogGroups(), [])
  const [group, setGroup] = useState(groups[0] ?? 'Auth')
  const opsInGroup = useMemo(() => ADMIN_API_CATALOG.filter((o) => o.group === group), [group])
  const [opId, setOpId] = useState(opsInGroup[0]?.id ?? '')
  const selected: CatalogOp | undefined = useMemo(
    () => ADMIN_API_CATALOG.find((o) => o.id === opId),
    [opId]
  )

  const params = useMemo(() => (selected ? pathParamNames(selected.pathTemplate) : []), [selected])
  const [pathValues, setPathValues] = useState<Record<string, string>>({})
  const [queryJson, setQueryJson] = useState('{}')
  const [bodyJson, setBodyJson] = useState('{}')
  const [multipartExtra, setMultipartExtra] = useState('{}')
  const [fileLists, setFileLists] = useState<Record<string, File[]>>({})
  const [result, setResult] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!selected) return
    setBodyJson(selected.defaultBody ?? '{}')
    setQueryJson(selected.queryHint ?? '{}')
    setMultipartExtra('{}')
    setFileLists({})
    setPathValues({})
    setError('')
  }, [selected?.id])

  const run = async () => {
    if (!selected) return
    setError('')
    setLoading(true)
    setResult('')
    try {
      const path = resolvePath(selected.pathTemplate, pathValues)
      let query: Record<string, string | number | undefined> = {}
      try {
        query = parseJsonObject(queryJson, 'Query') as Record<string, string | number | undefined>
      } catch (e) {
        throw e
      }

      if (selected.multipartFields?.length) {
        const fd = new FormData()
        for (const field of selected.multipartFields) {
          const list = fileLists[field] ?? []
          for (const f of list) fd.append(field, f)
        }
        let extra: Record<string, unknown> = {}
        try {
          const t = multipartExtra.trim()
          if (t) extra = JSON.parse(t) as Record<string, unknown>
        } catch {
          throw new Error('Multipart extra fields: invalid JSON object')
        }
        for (const [k, v] of Object.entries(extra)) {
          if (v != null) fd.append(k, String(v))
        }
        const res = await api.postForm(path, fd)
        setResult(JSON.stringify(res, null, 2))
        return
      }

      if (selected.rawText && selected.method === 'GET') {
        const raw = await api.getRaw(path, query)
        setResult(
          JSON.stringify(
            {
              ok: raw.ok,
              status: raw.status,
              contentType: raw.contentType,
              body: raw.body,
            },
            null,
            2
          )
        )
        return
      }

      if (selected.method === 'GET') {
        const res = await api.get(path, query)
        setResult(JSON.stringify(res, null, 2))
        return
      }

      let body: unknown = undefined
      const b = bodyJson.trim()
      if (b) {
        try {
          body = JSON.parse(b)
        } catch {
          throw new Error('Body: invalid JSON')
        }
      }

      if (selected.method === 'POST') {
        const res = await api.post(path, body)
        setResult(JSON.stringify(res, null, 2))
        return
      }
      if (selected.method === 'PATCH') {
        const res = await api.patch(path, body)
        setResult(JSON.stringify(res, null, 2))
        return
      }
      if (selected.method === 'PUT') {
        const res = await api.put(path, body)
        setResult(JSON.stringify(res, null, 2))
        return
      }
      if (selected.method === 'DELETE') {
        const res = await api.delete(path)
        setResult(JSON.stringify(res, null, 2))
        return
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-neutral-600 mb-1">Group</label>
          <select
            className="input-field text-sm min-w-[160px]"
            value={group}
            onChange={(e) => {
              setGroup(e.target.value)
              const next = ADMIN_API_CATALOG.find((o) => o.group === e.target.value)
              if (next) setOpId(next.id)
            }}
          >
            {groups.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1 min-w-[240px]">
          <label className="block text-xs font-medium text-neutral-600 mb-1">Operation</label>
          <select className="input-field text-sm w-full" value={opId} onChange={(e) => setOpId(e.target.value)}>
            {opsInGroup.map((o) => (
              <option key={o.id} value={o.id}>
                {o.method} {o.pathTemplate} — {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {selected && (
        <div className="rounded-2xl border border-neutral-200 bg-white p-4 space-y-3 text-sm">
          <p className="text-neutral-500">
            <span className="font-mono text-neutral-800">{selected.method}</span> {selected.pathTemplate}
            {selected.auth !== 'none' && (
              <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-700">
                {selected.auth} {selected.auth === 'admin' && !user?.is_admin && '(sign in as admin)'}
              </span>
            )}
          </p>
          {selected.note && <p className="text-xs text-neutral-500">{selected.note}</p>}

          {params.length > 0 && (
            <div className="grid sm:grid-cols-2 gap-2">
              {params.map((p) => (
                <div key={p}>
                  <label className="block text-xs text-neutral-600 mb-1">:{p}</label>
                  <input
                    className="input-field text-sm"
                    value={pathValues[p] ?? ''}
                    onChange={(e) => setPathValues((prev) => ({ ...prev, [p]: e.target.value }))}
                    placeholder={p}
                  />
                </div>
              ))}
            </div>
          )}

          {selected.method === 'GET' && !selected.multipartFields?.length && (
            <div>
              <label className="block text-xs text-neutral-600 mb-1">Query (JSON object)</label>
              <textarea className="input-field font-mono text-xs min-h-[72px]" value={queryJson} onChange={(e) => setQueryJson(e.target.value)} />
            </div>
          )}

          {selected.multipartFields && selected.multipartFields.length > 0 && (
            <>
              {selected.multipartFields.map((field) => {
                const multi = field === 'garment_images' || field === 'images'
                return (
                  <div key={field}>
                    <label className="block text-xs text-neutral-600 mb-1">
                      File: {field}
                      {multi && ' (multiple)'}
                    </label>
                    <input
                      type="file"
                      accept="image/*"
                      multiple={multi}
                      className="text-xs"
                      onChange={(e) => {
                        const arr = Array.from(e.target.files || [])
                        setFileLists((prev) => ({ ...prev, [field]: arr }))
                      }}
                    />
                  </div>
                )
              })}
              <div>
                <label className="block text-xs text-neutral-600 mb-1">Extra form fields (JSON)</label>
                <textarea
                  className="input-field font-mono text-xs min-h-[64px]"
                  value={multipartExtra}
                  onChange={(e) => setMultipartExtra(e.target.value)}
                  placeholder='{"product_id":1,"garment_id":2}'
                />
              </div>
            </>
          )}

          {['POST', 'PATCH', 'PUT'].includes(selected.method) && !selected.multipartFields?.length && (
            <div>
              <label className="block text-xs text-neutral-600 mb-1">Body (JSON)</label>
              <textarea className="input-field font-mono text-xs min-h-[120px]" value={bodyJson} onChange={(e) => setBodyJson(e.target.value)} />
            </div>
          )}

          <button type="button" className="btn-primary text-sm" disabled={loading} onClick={() => void run()}>
            {loading ? 'Running…' : 'Run request'}
          </button>

          {error && <p className="text-sm text-neutral-800 bg-neutral-100 px-3 py-2 rounded-xl">{error}</p>}

          {result && (
            <pre className="text-xs font-mono bg-neutral-900 text-neutral-50 p-4 rounded-xl overflow-auto max-h-[480px]">{result}</pre>
          )}
        </div>
      )}
    </div>
  )
}
