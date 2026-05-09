export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { fetchOverviewKPIs, fetchVendorProductCounts, fetchCategoryCounts } from '@/lib/catalog-queries'

export async function GET() {
  const [kpis, vendorCounts, catCounts] = await Promise.allSettled([
    fetchOverviewKPIs(),
    fetchVendorProductCounts(),
    fetchCategoryCounts(),
  ])
  return NextResponse.json({
    kpis: kpis.status === 'fulfilled' ? kpis.value : null,
    vendorCounts: vendorCounts.status === 'fulfilled' ? vendorCounts.value : [],
    catCounts: catCounts.status === 'fulfilled' ? catCounts.value : [],
  })
}
