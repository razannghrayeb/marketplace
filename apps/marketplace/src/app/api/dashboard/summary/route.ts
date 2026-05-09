export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { supabaseAdmin as sb } from '@/lib/supabase/client'

const DAY_MS = 86_400_000
const STALE_DAYS = 14

export async function GET() {
  const staleCut = new Date(Date.now() - STALE_DAYS * DAY_MS).toISOString()

  const [unavailRes, missCatRes, missImgRes, staleRes] = await Promise.all([
    sb.from('products').select('*', { count: 'exact', head: true }).eq('availability', false),
    sb.from('products').select('*', { count: 'exact', head: true }).is('category', null).eq('availability', true),
    sb.from('products').select('*', { count: 'exact', head: true }).is('image_url', null).eq('availability', true),
    sb.from('products').select('*', { count: 'exact', head: true }).lt('last_seen', staleCut).eq('availability', true),
  ])

  const totalCritical = unavailRes.count ?? 0
  const totalAtRisk = totalCritical + (missCatRes.count ?? 0) + (missImgRes.count ?? 0) + (staleRes.count ?? 0)

  return NextResponse.json({
    success: true,
    data: {
      total_at_risk: totalAtRisk,
      total_critical: totalCritical,
      value_at_risk_cents: 0,
      alerts_resolved_this_week: 0,
    },
  })
}
