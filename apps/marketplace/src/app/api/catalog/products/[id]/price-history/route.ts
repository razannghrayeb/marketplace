import { NextRequest, NextResponse } from 'next/server'
import { fetchPriceHistory } from '@/lib/catalog-queries'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const history = await fetchPriceHistory(params.id)
    return NextResponse.json(history)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
