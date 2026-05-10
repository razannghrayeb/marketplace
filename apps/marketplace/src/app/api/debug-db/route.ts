import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || ''
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

  let countResult: number | null = null
  let countError: string | null = null
  let countStatus: number | null = null

  try {
    const url = new URL(`${supabaseUrl}/rest/v1/products`)
    url.searchParams.set('select', 'count()')
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      cache: 'no-store',
    })
    countStatus = res.status
    if (res.ok) {
      const json = await res.json()
      const first = Array.isArray(json) ? json[0] : json
      const c = first?.count
      countResult = typeof c === 'number' ? c : (typeof c === 'string' ? parseInt(c, 10) : null)
    } else {
      countError = await res.text().catch(() => res.statusText)
    }
  } catch (e) {
    countError = String(e)
  }

  return NextResponse.json({
    supabase_url: supabaseUrl || 'MISSING',
    has_service_key: serviceKey.length > 10,
    count_status: countStatus,
    count_result: countResult,
    count_error: countError,
  })
}
