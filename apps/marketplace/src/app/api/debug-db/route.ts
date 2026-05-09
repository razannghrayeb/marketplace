import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/client'

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'MISSING'
  const hasKey = !!(process.env.SUPABASE_SERVICE_ROLE_KEY)

  const { count, error } = await supabaseAdmin
    .from('products')
    .select('*', { count: 'exact', head: true })

  return NextResponse.json({
    supabase_url: url,
    has_service_key: hasKey,
    product_count: count,
    error: error?.message ?? null,
  })
}
