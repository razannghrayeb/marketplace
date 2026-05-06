import { NextResponse } from 'next/server'
import { fetchRecentPriceChanges, fetchCurrentSaleProducts } from '@/lib/catalog-queries'

export async function GET() {
  const [changes, currentSales] = await Promise.allSettled([
    fetchRecentPriceChanges(800),
    fetchCurrentSaleProducts(20),
  ])
  return NextResponse.json({
    changes: changes.status === 'fulfilled' ? changes.value : [],
    currentSales: currentSales.status === 'fulfilled' ? currentSales.value : [],
  })
}
