export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { fetchProducts } from '@/lib/catalog-queries'
import type { ProductFilters, SortConfig, ProductSortField } from '@/types/catalog-admin'

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams

  const filters: ProductFilters = {
    search: sp.get('search') || undefined,
    vendor_id: sp.get('vendor_id') || undefined,
    category: sp.get('category') || undefined,
    brand: sp.get('brand') || undefined,
    color: sp.get('color') || undefined,
    availability: sp.has('availability') ? sp.get('availability') === 'true' : undefined,
    has_sale: sp.get('has_sale') === '1',
    has_issues: sp.get('has_issues') === '1',
    missing_category: sp.get('missing_category') === '1',
    missing_image_url: sp.get('missing_image_url') === '1',
    missing_variant_id: sp.get('missing_variant_id') === '1',
    sale_exceeds_base: sp.get('sale_exceeds_base') === '1',
    is_stale: sp.get('is_stale') === '1',
  }

  const sort: SortConfig = {
    field: (sp.get('sort_field') as ProductSortField) || 'last_seen',
    direction: (sp.get('sort_dir') as 'asc' | 'desc') || 'desc',
  }

  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10))
  const pageSize = Math.min(200, Math.max(1, parseInt(sp.get('page_size') ?? '50', 10)))

  try {
    const result = await fetchProducts(filters, sort, { page, pageSize })
    return NextResponse.json(result)
  } catch (err: unknown) {
    console.error('[/api/catalog/products]', err)
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
