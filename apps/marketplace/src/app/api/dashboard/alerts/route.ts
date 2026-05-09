export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { supabaseAdmin as sb } from '@/lib/supabase/client'

const DAY_MS = 86_400_000
const STALE_DAYS = 14

export async function GET() {
  const staleCut = new Date(Date.now() - STALE_DAYS * DAY_MS).toISOString()

  const [unavailData, missCatData, staleData] = await Promise.all([
    sb.from('products').select('id, title, availability, last_seen').eq('availability', false).limit(20),
    sb.from('products').select('id, title, availability, last_seen').is('category', null).eq('availability', true).limit(15),
    sb.from('products').select('id, title, availability, last_seen').lt('last_seen', staleCut).eq('availability', true).limit(15),
  ])

  type Row = { id: number; title: string | null; availability: boolean | null; last_seen: string | null }

  const seen = new Set<number>()
  const alerts: object[] = []
  let alertId = 1

  for (const p of (unavailData.data ?? []) as Row[]) {
    if (seen.has(p.id)) continue
    seen.add(p.id)
    alerts.push({ id: alertId++, product_id: p.id, product_title: p.title ?? 'Untitled', alert_type: 'critical', message: 'Product is marked as unavailable', dismissed: false, created_at: new Date().toISOString() })
  }

  for (const p of (missCatData.data ?? []) as Row[]) {
    if (seen.has(p.id)) continue
    seen.add(p.id)
    alerts.push({ id: alertId++, product_id: p.id, product_title: p.title ?? 'Untitled', alert_type: 'early_risk', message: 'Missing category — reduces search visibility', dismissed: false, created_at: new Date().toISOString() })
  }

  for (const p of (staleData.data ?? []) as Row[]) {
    if (seen.has(p.id)) continue
    seen.add(p.id)
    const days = p.last_seen ? Math.floor((Date.now() - new Date(p.last_seen).getTime()) / DAY_MS) : 0
    alerts.push({ id: alertId++, product_id: p.id, product_title: p.title ?? 'Untitled', alert_type: 'critical', message: `Not seen in ${days} days — may be delisted`, dismissed: false, created_at: new Date().toISOString() })
  }

  return NextResponse.json({ success: true, data: alerts })
}
