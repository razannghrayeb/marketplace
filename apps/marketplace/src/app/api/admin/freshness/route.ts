export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { fetchFreshnessStats, fetchVendorFreshness } from '@/lib/catalog-queries'

export async function GET() {
  const [stats, vendorFresh] = await Promise.allSettled([
    fetchFreshnessStats(),
    fetchVendorFreshness(),
  ])
  return NextResponse.json({
    stats: stats.status === 'fulfilled' ? stats.value : null,
    vendorFresh: vendorFresh.status === 'fulfilled' ? vendorFresh.value : [],
  })
}
