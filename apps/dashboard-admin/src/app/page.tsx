import { Suspense } from 'react'
import { fetchOverviewKPIs, fetchVendorProductCounts, fetchCategoryCounts } from '@/lib/queries'
import { PageHeader, KpiCard, Section, Skeleton } from '@/components/ui'
import { OverviewCharts } from './OverviewCharts'

const EMPTY = '—'

export default async function OverviewPage() {
  const [kpis, vendorCounts, catCounts] = await Promise.all([
    fetchOverviewKPIs().catch(() => null),
    fetchVendorProductCounts().catch(() => []),
    fetchCategoryCounts().catch(() => []),
  ])

  const hasAnyData =
    (kpis?.total_products ?? 0) > 0 || vendorCounts.length > 0 || catCounts.length > 0

  return (
    <div>
      <PageHeader
        title="Overview"
        sub="Real-time scraper output summary"
        actions={
          <span className="inline-flex items-center gap-1.5 text-xs text-teal-600 bg-teal-50 px-2.5 py-1 rounded-full border border-teal-200">
            <span className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse" />
            Live
          </span>
        }
      />

      <div className="p-6 flex flex-col gap-6">
        {!hasAnyData && (
          <Section>
            <div className="flex flex-col gap-1 text-sm text-amber-700">
              <p className="font-medium">The layout is loading correctly, but overview data is still empty.</p>
              <p className="text-xs text-amber-600">
                Usually this means Supabase is not reachable from the app, or the dashboard SQL functions have not been created yet.
              </p>
            </div>
          </Section>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
          <KpiCard label="Total products" value={kpis?.total_products ?? EMPTY} />
          <KpiCard label="Available" value={kpis?.available_products ?? EMPTY} tone="good" />
          <KpiCard label="Unavailable" value={kpis?.unavailable_products ?? EMPTY} tone="danger" />
          <KpiCard label="Seen today" value={kpis?.products_seen_today ?? EMPTY} />
          <KpiCard label="Updated 24h" value={kpis?.updated_last_24h ?? EMPTY} tone="good" />
          <KpiCard label="With sale price" value={kpis?.with_sale_price ?? EMPTY} tone="purple" />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
          <KpiCard label="Missing category" value={kpis?.missing_category ?? EMPTY} tone="warn" sub="needs category" />
          <KpiCard label="Missing color" value={kpis?.missing_color ?? EMPTY} tone="warn" />
          <KpiCard label="Missing size" value={kpis?.missing_size ?? EMPTY} tone="warn" />
          <KpiCard label="No image_url" value={kpis?.missing_image_url ?? EMPTY} tone="warn" />
          <KpiCard label="No image_urls" value={kpis?.missing_image_urls ?? EMPTY} tone="warn" />
          <KpiCard label="No variant_id" value={kpis?.missing_variant_id ?? EMPTY} />
        </div>

        <Suspense
          fallback={
            <div className="grid grid-cols-2 gap-4">
              <Skeleton className="h-64" />
              <Skeleton className="h-64" />
            </div>
          }
        >
          <OverviewCharts vendorCounts={vendorCounts} catCounts={catCounts} />
        </Suspense>
      </div>
    </div>
  )
}
