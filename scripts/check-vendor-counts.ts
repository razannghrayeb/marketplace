import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function main() {
  const { data: vendors, error: ve } = await sb.from('vendors').select('id, name, url')
  if (ve) { console.error('vendors error:', ve.message); process.exit(1) }

  console.log('\n=== VENDORS TABLE ===')
  for (const v of (vendors as any[])) {
    console.log(`  id=${v.id}  name="${v.name}"  url=${v.url}`)
  }

  console.log('\n=== PRODUCT COUNT PER vendor_id (direct COUNT query) ===')
  for (const v of (vendors as any[])) {
    const { count } = await sb
      .from('products')
      .select('*', { count: 'exact', head: true })
      .eq('vendor_id', v.id)
    console.log(`  vendor_id=${v.id}  name="${v.name}"  products=${count}`)
  }

  // Also check if there are products with vendor_ids not in vendors table
  const { data: orphans } = await sb
    .from('products')
    .select('vendor_id')
    .is('vendor_id', null)
  console.log(`\n  Products with NULL vendor_id: ${(orphans ?? []).length}`)
}

main().catch(console.error)
