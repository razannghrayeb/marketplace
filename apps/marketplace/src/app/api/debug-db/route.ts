import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || ''
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

  let restCount: number | null = null
  let restError: string | null = null
  let restStatus: number | null = null
  let contentRange: string | null = null

  try {
    const url = new URL(`${supabaseUrl}/rest/v1/products`)
    url.searchParams.set('select', 'id')
    url.searchParams.set('limit', '1')
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Prefer: 'count=exact',
      },
      cache: 'no-store',
    })
    restStatus = res.status
    contentRange = res.headers.get('content-range')
    const match = contentRange?.match(/\/(\d+)$/)
    restCount = match ? parseInt(match[1], 10) : null
  } catch (e) {
    restError = String(e)
  }

  return NextResponse.json({
    supabase_url: supabaseUrl || 'MISSING',
    has_service_key: serviceKey.length > 10,
    rest_status: restStatus,
    content_range: contentRange,
    rest_count: restCount,
    rest_error: restError,
  })
}
