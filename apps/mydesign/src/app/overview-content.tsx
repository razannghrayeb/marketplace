import { getApiBase } from '@/lib/api/client'
import { ApiBaseBanner } from '@/components/ApiBaseBanner'
import { endpoints } from '@/lib/api/endpoints'

async function fetchJson(path: string) {
  const base = getApiBase()
  try {
    const r = await fetch(`${base}${path}`, { next: { revalidate: 0 } })
    const text = await r.text()
    let json: unknown = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = { raw: text }
    }
    return { ok: r.ok, status: r.status, json }
  } catch (e) {
    return { ok: false, status: 0, json: { error: String(e) } }
  }
}

function HealthCard({
  title,
  result,
}: {
  title: string
  result: { ok: boolean; status: number; json: unknown }
}) {
  return (
    <div className="surface-card">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="text-sm font-semibold text-neutral-800">{title}</h3>
        <span
          className={`text-xs font-medium px-2 py-0.5 rounded-full ${
            result.ok ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
          }`}
        >
          {result.status || 'ERR'}
        </span>
      </div>
      <pre className="text-xs bg-neutral-900 text-emerald-100 rounded-xl p-3 overflow-auto max-h-48">
        {JSON.stringify(result.json, null, 2)}
      </pre>
    </div>
  )
}

export async function OverviewContent() {
  const [live, ready, detailed, imageStatus] = await Promise.all([
    fetchJson(endpoints.health.live),
    fetchJson(endpoints.health.ready),
    fetchJson(endpoints.health.detailed),
    fetchJson(endpoints.images.status),
  ])

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-widest text-violet-600 mb-1">
          Operations
        </p>
        <h1 className="font-display text-3xl font-bold text-neutral-900 tracking-tight">
          Fashion Aggregator API
        </h1>
        <p className="text-neutral-600 mt-2 max-w-2xl text-sm">
          This app calls your Express backend directly. Admin routes need an admin user and Bearer token
          from POST /api/auth/login (save token via Admin page).
        </p>
        <div className="mt-3">
          <ApiBaseBanner />
        </div>
      </div>

      <div className="surface-card mb-6 border-amber-200 bg-amber-50/50">
        <h2 className="text-sm font-semibold text-amber-900">README vs this repo</h2>
        <p className="text-xs text-amber-800 mt-2 leading-relaxed">
          README lists GET /admin/opensearch and GET /admin/ranker. Those routes are not in
          src/routes/admin today. Use OpenSearch Dashboards or add endpoints. Ranker is configured via
          RANKER_SERVICE_URL.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <HealthCard title="GET /health/live" result={live} />
        <HealthCard title="GET /health/ready" result={ready} />
      </div>
      <div className="mt-4 grid gap-4">
        <HealthCard title="GET /health/detailed" result={detailed} />
        <HealthCard title="GET /api/images/status" result={imageStatus} />
      </div>

      <div className="mt-8 surface-card">
        <h2 className="text-sm font-semibold text-neutral-800 mb-3">Quick endpoint map</h2>
        <ul className="text-xs text-neutral-600 space-y-2 font-mono">
          <li>GET {endpoints.products.list}</li>
          <li>GET {endpoints.products.facets}</li>
          <li>GET {endpoints.search.text}?q=...</li>
          <li>POST {endpoints.search.image} (multipart image)</li>
          <li>POST {endpoints.images.search} (shop-the-look)</li>
          <li>POST {endpoints.compare.root}</li>
          <li>GET {endpoints.products.priceDrops}</li>
          <li>GET {endpoints.admin.stats} (auth)</li>
        </ul>
      </div>
    </div>
  )
}
