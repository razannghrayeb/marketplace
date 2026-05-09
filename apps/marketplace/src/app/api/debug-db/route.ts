import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? 'MISSING'
  const keyRaw = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  const hasKey = keyRaw.length > 10
  const keyPreview = hasKey ? keyRaw.slice(0, 20) + '...' : 'MISSING'

  const { count, error } = await supabaseAdmin
    .from('products')
    .select('*', { count: 'exact', head: true })

  return NextResponse.json({
    supabase_url: url,
    has_service_key: hasKey,
    key_preview: keyPreview,
    product_count: count,
    error: error?.message ?? null,
  })
}
