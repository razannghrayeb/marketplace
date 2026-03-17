import { fetchFreshnessStats, fetchVendorFreshness } from '@/lib/queries'
import { PageHeader, KpiCard, Section } from '@/components/ui'
import { formatRelativeTime } from '@/lib/utils/quality'

function FreshnessBar({ fresh, recent, aging, stale }: {
  fresh: number; recent: number; aging: number; stale: number
}) {
  return (
    <div className="h-2 rounded-full overflow-hidden flex w-full">
      <div className="bg-teal-400 transition-all" style={{ width: `${fresh}%` }} title={`Fresh: ${fresh}%`} />
      <div className="bg-blue-400 transition-all" style={{ width: `${recent}%` }} title={`Recent: ${recent}%`} />
      <div className="bg-amber-400 transition-all" style={{ width: `${aging}%` }} title={`Aging: ${aging}%`} />
      <div className="bg-red-400 transition-all" style={{ width: `${stale}%` }} title={`Stale: ${stale}%`} />
    </div>
  )
}

export default async function FreshnessPage() {
  const [stats, vendorFresh] = await Promise.all([
    fetchFreshnessStats().catch(() => null),
    fetchVendorFreshness().catch(() => []),
  ])

  const total = stats
    ? stats.fresh_count + stats.recent_count + stats.aging_count + stats.stale_count
    : 0

  return (
    <div>
      <PageHeader
        title="Coverage & Freshness"
        sub="Scrape staleness analysis by vendor"
        actions={
          <div className="flex items-center gap-3 text-[11px] text-gray-500">
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-teal-400 inline-block" /> Fresh &lt;1d</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-blue-400 inline-block" /> Recent 1–7d</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-400 inline-block" /> Aging 7–14d</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-400 inline-block" /> Stale &gt;14d</span>
          </div>
        }
      />

      <div className="p-6 flex flex-col gap-6">
        {/* KPI row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KpiCard label="Fresh (<1d)"    value={stats?.fresh_count ?? '—'}   tone="good" sub="scraped today" />
          <KpiCard label="Recent (1–7d)"  value={stats?.recent_count ?? '—'}  sub="last week" />
          <KpiCard label="Aging (7–14d)"  value={stats?.aging_count ?? '—'}   tone="warn" />
          <KpiCard label="Stale (>14d)"   value={stats?.stale_count ?? '—'}   tone="danger" />
        </div>

        {/* Global freshness bar */}
        {stats && total > 0 && (
          <Section title="Overall freshness distribution">
            <div className="space-y-3">
              <FreshnessBar
                fresh={Math.round((stats.fresh_count  / total) * 100)}
                recent={Math.round((stats.recent_count / total) * 100)}
                aging={Math.round((stats.aging_count  / total) * 100)}
                stale={Math.round((stats.stale_count  / total) * 100)}
              />
              <div className="grid grid-cols-4 gap-2 text-xs text-center text-gray-500">
                <span>{Math.round((stats.fresh_count  / total) * 100)}% fresh</span>
                <span>{Math.round((stats.recent_count / total) * 100)}% recent</span>
                <span>{Math.round((stats.aging_count  / total) * 100)}% aging</span>
                <span>{Math.round((stats.stale_count  / total) * 100)}% stale</span>
              </div>
            </div>
          </Section>
        )}

        {/* Per-vendor breakdown */}
        <Section title="Freshness by vendor" noPad>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  {['Vendor', 'Freshness distribution', 'Fresh', 'Recent', 'Aging', 'Stale', 'Last scrape'].map(h => (
                    <th key={h} className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wide px-4 py-2.5 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {vendorFresh.map(v => (
                  <tr key={v.vendor_id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900">{v.vendor_name}</td>
                    <td className="px-4 py-3 w-48">
                      <FreshnessBar
                        fresh={v.fresh_pct}
                        recent={v.recent_pct}
                        aging={v.aging_pct}
                        stale={v.stale_pct}
                      />
                    </td>
                    <td className="px-4 py-3 text-xs text-teal-600 tabular-nums font-medium">{v.fresh_pct}%</td>
                    <td className="px-4 py-3 text-xs text-blue-600 tabular-nums">{v.recent_pct}%</td>
                    <td className="px-4 py-3 text-xs text-amber-600 tabular-nums">{v.aging_pct}%</td>
                    <td className="px-4 py-3 text-xs text-red-500 tabular-nums">{v.stale_pct}%</td>
                    <td className="px-4 py-3 text-[11px] text-gray-400 whitespace-nowrap">
                      {v.last_scrape ? formatRelativeTime(v.last_scrape) : (
                        <span className="text-red-400">Never</span>
                      )}
                    </td>
                  </tr>
                ))}
                {vendorFresh.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-xs text-gray-400">No data</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    </div>
  )
}
