import { Suspense } from 'react'
import { fetchOverviewKPIs, fetchVendorProductCounts, fetchCategoryCounts } from '@/lib/catalog-queries'
import { PageHeader, KpiCard, Section, Skeleton } from '@/components/catalog-admin/ui'
import { CatalogOverviewCharts } from '@/components/catalog-admin/CatalogOverviewCharts'

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
          <span className="inline-flex items-center gap-1.5 text-xs text-violet-800 bg-violet-50 px-2.5 py-1 rounded-full border border-violet-200 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Live
          </span>
        }
      />

      <div className="p-6 flex flex-col gap-6">
        {!hasAnyData && (
          <Section>
            <div className="flex flex-col gap-2 text-sm text-neutral-800 border border-violet-100 rounded-xl bg-gradient-to-r from-violet-50/80 to-fuchsia-50/50 px-4 py-3">
              <p className="font-medium font-display">No catalog data loaded yet</p>
              <p className="text-xs text-neutral-600 leading-relaxed">
                This page reads your scraper database through Supabase. The app now picks up{' '}
                <code className="text-violet-900 bg-white/80 px-1 rounded">SUPABASE_URL</code>,{' '}
                <code className="text-violet-900 bg-white/80 px-1 rounded">SUPABASE_ANON_KEY</code>, and{' '}
                <code className="text-violet-900 bg-white/80 px-1 rounded">SUPABASE_SERVICE_ROLE_KEY</code> from the
                repo root <code className="text-violet-900 bg-white/80 px-1 rounded">.env</code> automatically (same as
                before). If it&apos;s still empty, confirm those values exist, restart{' '}
                <code className="text-violet-900 bg-white/80 px-1 rounded">pnpm dev</code>, and ensure SQL functions
                like <code className="text-violet-900 bg-white/80 px-1 rounded">get_overview_kpis</code> exist in
                Supabase.
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
          <CatalogOverviewCharts vendorCounts={vendorCounts} catCounts={catCounts} />
        </Suspense>
      </div>
    </div>
  )
}
