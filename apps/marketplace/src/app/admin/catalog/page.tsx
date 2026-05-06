'use client'

import { useQuery } from '@tanstack/react-query'
import { Suspense } from 'react'
import { PageHeader, KpiCard, Section, Skeleton } from '@/components/catalog-admin/ui'
import { CatalogOverviewCharts } from '@/components/catalog-admin/CatalogOverviewCharts'
import type { OverviewKPIs, VendorProductCount, CategoryCount } from '@/types/catalog-admin'

const EMPTY = '—'

type OverviewData = {
  kpis: OverviewKPIs | null
  vendorCounts: VendorProductCount[]
  catCounts: CategoryCount[]
}

export default function OverviewPage() {
  const { data, isLoading } = useQuery<OverviewData>({
    queryKey: ['admin-overview'],
    queryFn: () => fetch('/api/admin/overview').then(r => r.json()),
    staleTime: 5 * 60 * 1000,
    retry: false,
  })

  const kpis = data?.kpis ?? null
  const vendorCounts = data?.vendorCounts ?? []
  const catCounts = data?.catCounts ?? []

  return (
    <div>
      <PageHeader
        title="Overview"
        sub="Real-time scraper output summary"
        actions={
          <span className="inline-flex items-center gap-1.5 text-xs text-[#2a2623] bg-[#f7f0eb] px-2.5 py-1 rounded-full border border-[#d8c6bb] font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Live
          </span>
        }
      />

      <div className="p-6 flex flex-col gap-6">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
          <KpiCard label="Total products"  value={isLoading ? EMPTY : (kpis?.total_products ?? EMPTY)} />
          <KpiCard label="Available"       value={isLoading ? EMPTY : (kpis?.available_products ?? EMPTY)}   tone="good" />
          <KpiCard label="Unavailable"     value={isLoading ? EMPTY : (kpis?.unavailable_products ?? EMPTY)} tone="danger" />
          <KpiCard label="Seen today"      value={isLoading ? EMPTY : (kpis?.products_seen_today ?? EMPTY)} />
          <KpiCard label="Updated 24h"     value={isLoading ? EMPTY : (kpis?.updated_last_24h ?? EMPTY)}     tone="good" />
          <KpiCard label="With sale price" value={isLoading ? EMPTY : (kpis?.with_sale_price ?? EMPTY)}      tone="purple" />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
          <KpiCard label="Missing category" value={isLoading ? EMPTY : (kpis?.missing_category ?? EMPTY)} tone="warn" sub="needs category" />
          <KpiCard label="Missing color"    value={isLoading ? EMPTY : (kpis?.missing_color ?? EMPTY)}    tone="warn" />
          <KpiCard label="Missing size"     value={isLoading ? EMPTY : (kpis?.missing_size ?? EMPTY)}     tone="warn" />
          <KpiCard label="No image_url"     value={isLoading ? EMPTY : (kpis?.missing_image_url ?? EMPTY)} tone="warn" />
          <KpiCard label="No image_urls"    value={isLoading ? EMPTY : (kpis?.missing_image_urls ?? EMPTY)} tone="warn" />
          <KpiCard label="No variant_id"    value={isLoading ? EMPTY : (kpis?.missing_variant_id ?? EMPTY)} />
        </div>

        {isLoading ? (
          <div className="grid grid-cols-2 gap-4">
            <Skeleton className="h-64" />
            <Skeleton className="h-64" />
          </div>
        ) : (
          <Suspense fallback={<div className="grid grid-cols-2 gap-4"><Skeleton className="h-64" /><Skeleton className="h-64" /></div>}>
            <CatalogOverviewCharts vendorCounts={vendorCounts} catCounts={catCounts} />
          </Suspense>
        )}
      </div>
    </div>
  )
}
