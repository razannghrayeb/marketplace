'use client'

import { useEffect, useState } from 'react'
import { apiJson, apiFetch, setStoredAccessToken, getStoredAccessToken } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'
import { JsonPanel } from '@/components/JsonPanel'
import { ApiBaseBanner } from '@/components/ApiBaseBanner'

type Me = { id?: number; email?: string; is_admin?: boolean }

export default function AdminPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [tokenPreview, setTokenPreview] = useState<string | null>(null)
  const [me, setMe] = useState<Me | null>(null)

  const [stats, setStats] = useState<unknown>(null)
  const [flagged, setFlagged] = useState<unknown>(null)
  const [hidden, setHidden] = useState<unknown>(null)
  const [schedules, setSchedules] = useState<unknown>(null)
  const [metrics, setMetrics] = useState<unknown>(null)
  const [history, setHistory] = useState<unknown>(null)
  const [recoStats, setRecoStats] = useState<unknown>(null)
  const [labels, setLabels] = useState<unknown>(null)
  const [canonicals, setCanonicals] = useState<unknown>(null)
  const [jobRun, setJobRun] = useState<unknown>(null)

  const [jobType, setJobType] = useState('reindex')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    const t = getStoredAccessToken()
    setTokenPreview(t ? `${t.slice(0, 12)}…` : null)
  }, [])

  async function login() {
    setErr(null)
    setBusy('login')
    try {
      const res = await apiFetch(endpoints.auth.login, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        skipAuth: true,
      })
      const body = (await res.json()) as {
        success?: boolean
        access_token?: string
        error?: string
        user?: Me
      }
      if (!res.ok || !body.access_token) {
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      setStoredAccessToken(body.access_token)
      setTokenPreview(`${body.access_token.slice(0, 12)}…`)
      setMe(body.user ?? null)
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(null)
    }
  }

  function logout() {
    setStoredAccessToken(null)
    setTokenPreview(null)
    setMe(null)
  }

  async function authJson<T>(path: string, init?: RequestInit) {
    return apiJson<T>(path, init)
  }

  async function loadAdmin(label: string, fn: () => Promise<void>) {
    setBusy(label)
    setErr(null)
    try {
      await fn()
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="p-8 max-w-6xl">
      <h1 className="font-display text-2xl font-bold text-neutral-900">Admin and jobs</h1>
      <p className="text-sm text-neutral-600 mt-1">
        All /admin/* routes require JWT with is_admin. Token is stored in localStorage.
      </p>
      <div className="mt-2">
        <ApiBaseBanner />
      </div>

      <div className="mt-6 surface-card grid sm:grid-cols-2 gap-4">
        <div>
          <h2 className="text-sm font-semibold mb-2">Sign in</h2>
          <input
            className="input-field mb-2"
            type="email"
            placeholder="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
          />
          <input
            className="input-field mb-3"
            type="password"
            placeholder="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
          <div className="flex gap-2">
            <button type="button" className="btn-primary text-xs" disabled={!!busy} onClick={login}>
              Login
            </button>
            <button type="button" className="btn-secondary text-xs" onClick={logout}>
              Clear token
            </button>
          </div>
          <p className="text-xs text-neutral-500 mt-2">
            Token: {tokenPreview || 'none'}
            {me?.email ? ` · ${me.email} · admin=${String(me.is_admin)}` : ''}
          </p>
        </div>
        <div>
          <h2 className="text-sm font-semibold mb-2">Load session (GET /api/auth/me)</h2>
          <button
            type="button"
            className="btn-secondary text-xs"
            disabled={!!busy}
            onClick={() =>
              loadAdmin('me', async () => {
                const j = await authJson<{ user?: Me }>(endpoints.auth.me)
                setMe(j.user ?? null)
              })
            }
          >
            Refresh me
          </button>
        </div>
      </div>

      {err ? <p className="mt-4 text-sm text-red-600">{err}</p> : null}
      {busy ? <p className="mt-2 text-xs text-violet-600">{busy}…</p> : null}

      <div className="mt-6 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-secondary text-xs"
          onClick={() => loadAdmin('stats', () => authJson<unknown>(endpoints.admin.stats).then(setStats))}
        >
          GET /admin/stats
        </button>
        <button
          type="button"
          className="btn-secondary text-xs"
          onClick={() =>
            loadAdmin('flagged', () => authJson<unknown>(endpoints.admin.flagged).then(setFlagged))
          }
        >
          GET flagged
        </button>
        <button
          type="button"
          className="btn-secondary text-xs"
          onClick={() => loadAdmin('hidden', () => authJson<unknown>(endpoints.admin.hidden).then(setHidden))}
        >
          GET hidden
        </button>
        <button
          type="button"
          className="btn-secondary text-xs"
          onClick={() =>
            loadAdmin('schedules', () =>
              authJson<unknown>(endpoints.admin.jobSchedules).then(setSchedules)
            )
          }
        >
          GET jobs/schedules
        </button>
        <button
          type="button"
          className="btn-secondary text-xs"
          onClick={() =>
            loadAdmin('metrics', () => authJson<unknown>(endpoints.admin.jobMetrics).then(setMetrics))
          }
        >
          GET jobs/metrics
        </button>
        <button
          type="button"
          className="btn-secondary text-xs"
          onClick={() =>
            loadAdmin('history', () => authJson<unknown>(endpoints.admin.jobHistory).then(setHistory))
          }
        >
          GET jobs/history
        </button>
        <button
          type="button"
          className="btn-secondary text-xs"
          onClick={() => loadAdmin('reco', () => authJson<unknown>(endpoints.admin.recoStats).then(setRecoStats))}
        >
          GET reco/stats
        </button>
        <button
          type="button"
          className="btn-secondary text-xs"
          onClick={() =>
            loadAdmin('labels', () => authJson<unknown>(endpoints.admin.recoLabels).then(setLabels))
          }
        >
          GET reco/labels
        </button>
        <button
          type="button"
          className="btn-secondary text-xs"
          onClick={() =>
            loadAdmin('canonicals', () => authJson<unknown>(endpoints.admin.canonicals).then(setCanonicals))
          }
        >
          GET canonicals
        </button>
      </div>

      <div className="mt-6 surface-card flex flex-wrap gap-2 items-end">
        <div>
          <label className="text-xs text-neutral-500">POST /admin/jobs/:type/run</label>
          <input className="input-field mt-1" value={jobType} onChange={(e) => setJobType(e.target.value)} />
        </div>
        <button
          type="button"
          className="btn-primary text-xs"
          onClick={() =>
            loadAdmin('run', () =>
              apiJson<unknown>(endpoints.admin.jobRun(jobType), { method: 'POST' }).then(setJobRun)
            )
          }
        >
          Run job
        </button>
      </div>

      <div className="mt-6 grid lg:grid-cols-2 gap-4">
        <JsonPanel title="Stats" data={stats ?? {}} />
        <JsonPanel title="Flagged products" data={flagged ?? {}} />
        <JsonPanel title="Hidden products" data={hidden ?? {}} />
        <JsonPanel title="Job schedules" data={schedules ?? {}} />
        <JsonPanel title="Job metrics" data={metrics ?? {}} />
        <JsonPanel title="Job history" data={history ?? {}} />
        <JsonPanel title="Reco stats" data={recoStats ?? {}} />
        <JsonPanel title="Reco labels" data={labels ?? {}} />
        <JsonPanel title="Canonicals" data={canonicals ?? {}} />
        <JsonPanel title="Last job run" data={jobRun ?? {}} />
      </div>
    </div>
  )
}
