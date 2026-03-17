import { NextResponse } from 'next/server'
import { fetchDistinctCategories, fetchDistinctVendors } from '@/lib/queries'

export async function GET() {
  try {
    const [vendors, categories] = await Promise.all([
      fetchDistinctVendors(),
      fetchDistinctCategories(),
    ])

    return NextResponse.json({ vendors, categories })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
