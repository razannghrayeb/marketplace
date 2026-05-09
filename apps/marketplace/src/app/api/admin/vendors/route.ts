export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { fetchVendorStats } from '@/lib/catalog-queries'

export async function GET() {
  const data = await fetchVendorStats().catch(() => [])
  return NextResponse.json({ data })
}
