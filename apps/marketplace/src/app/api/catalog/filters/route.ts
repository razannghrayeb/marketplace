export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { fetchDistinctCategories, fetchDistinctVendors } from '@/lib/catalog-queries'

export async function GET() {
  try {
    const [vendors, categories] = await Promise.all([fetchDistinctVendors(), fetchDistinctCategories()])

    return NextResponse.json({ vendors, categories })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
