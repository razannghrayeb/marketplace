export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as sb } from '@/lib/supabase/client'

const DAY_MS = 86_400_000
const STALE_DAYS = 14

type RawProduct = {
  id: number
  title: string | null
  category: string | null
  image_url: string | null
  price_cents: number | null
  currency: string | null
  availability: boolean | null
  color: string | null
  size: string | null
  last_seen: string | null
  vendor: { name: string } | Array<{ name: string }> | null
}

const COLS = 'id, title, category, image_url, price_cents, currency, availability, color, size, last_seen, vendor:vendors(name)'

function vendorName(vendor: RawProduct['vendor']): string {
  if (!vendor) return 'Unknown'
  if (Array.isArray(vendor)) return vendor[0]?.name ?? 'Unknown'
  return (vendor as { name: string }).name ?? 'Unknown'
}

function computeDsr(p: RawProduct) {
  let score = 100
  const reasons: Array<{ label: string; penalty: number }> = []

  if (!p.availability) {
    score -= 40
    reasons.push({ label: 'Product unavailable', penalty: 40 })
  }

  const lastSeenMs = p.last_seen ? new Date(p.last_seen).getTime() : 0
  const days_listed = lastSeenMs ? Math.floor((Date.now() - lastSeenMs) / DAY_MS) : 0
  const staleCut = Date.now() - STALE_DAYS * DAY_MS

  if (lastSeenMs && lastSeenMs < staleCut) {
    const penalty = Math.min(30, Math.floor(days_listed - STALE_DAYS) * 2)
    score -= penalty
    reasons.push({ label: `Not seen in ${days_listed} days`, penalty })
  }

  if (!p.category) { score -= 15; reasons.push({ label: 'Missing category', penalty: 15 }) }
  if (!p.image_url) { score -= 10; reasons.push({ label: 'Missing image', penalty: 10 }) }
  if (!p.color)     { score -= 5;  reasons.push({ label: 'Missing color', penalty: 5 }) }
  if (!p.size)      { score -= 5;  reasons.push({ label: 'Missing size', penalty: 5 }) }

  score = Math.max(0, score)
  const risk_level: 'green' | 'yellow' | 'red' = score < 40 ? 'red' : score < 70 ? 'yellow' : 'green'
  const top_reason = reasons.sort((a, b) => b.penalty - a.penalty)[0]?.label ?? 'All good'
  return { score, risk_level, top_reason, days_listed }
}

function toRow(p: RawProduct) {
  const { score, risk_level, top_reason, days_listed } = computeDsr(p)
  return {
    id: p.id,
    title: p.title ?? 'Untitled',
    category: p.category,
    image_url: p.image_url,
    price_cents: p.price_cents ?? 0,
    currency: p.currency ?? 'USD',
    vendor_name: vendorName(p.vendor),
    days_listed,
    dsr_score: score,
    risk_level,
    top_reason,
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const riskFilter = searchParams.get('risk_level') ?? 'all'
  const sort = searchParams.get('sort') ?? 'highest_risk'

  // Three small, targeted queries instead of one big OR scan
  const [unavailData, missCatData, missImgData] = await Promise.all([
    sb.from('products').select(COLS).eq('availability', false).order('last_seen', { ascending: false }).limit(60),
    sb.from('products').select(COLS).is('category', null).eq('availability', true).order('last_seen', { ascending: false }).limit(40),
    sb.from('products').select(COLS).is('image_url', null).eq('availability', true).not('category', 'is', null).order('last_seen', { ascending: false }).limit(30),
  ])

  // Merge and deduplicate by id
  const seen = new Set<number>()
  const merged: RawProduct[] = []
  for (const row of [...(unavailData.data ?? []), ...(missCatData.data ?? []), ...(missImgData.data ?? [])]) {
    const p = row as RawProduct
    if (!seen.has(p.id)) { seen.add(p.id); merged.push(p) }
  }

  let products = merged.map(toRow)

  if (riskFilter !== 'all') {
    products = products.filter((p) => p.risk_level === riskFilter)
  }

  if (sort === 'highest_risk') products.sort((a, b) => a.dsr_score - b.dsr_score)
  else if (sort === 'lowest_risk') products.sort((a, b) => b.dsr_score - a.dsr_score)
  else if (sort === 'price_high') products.sort((a, b) => b.price_cents - a.price_cents)
  else if (sort === 'price_low') products.sort((a, b) => a.price_cents - b.price_cents)

  return NextResponse.json({ success: true, data: products.slice(0, 100) })
}
