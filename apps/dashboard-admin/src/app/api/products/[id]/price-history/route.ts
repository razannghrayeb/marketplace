import { NextRequest, NextResponse } from 'next/server'
import { fetchPriceHistory } from '@/lib/queries'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const history = await fetchPriceHistory(params.id)
    return NextResponse.json(history)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
