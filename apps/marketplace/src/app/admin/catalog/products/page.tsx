'use client'

import { useState, useCallback, useEffect, useTransition } from 'react'
import { Search, SlidersHorizontal, ChevronUp, ChevronDown } from 'lucide-react'
import { useDebounce } from '@/hooks/useDebounce'
import { ProductDrawer } from '@/components/catalog-admin/ProductDrawer'
import {
  PageHeader,
  Badge,
  Input,
  Select,
  FilterBtn,
  EmptyState,
  AvailBadge,
} from '@/components/catalog-admin/ui'
import { formatCents, formatRelativeTime, getProductFlags, getActiveFlags } from '@/lib/utils/catalog-quality'
import type { Product, ProductFilters, SortConfig, ProductSortField } from '@/types/catalog-admin'

const PAGE_SIZE = 50

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [total, setTotal]       = useState(0)
  const [vendorOptions, setVendorOptions] = useState<Array<{ value: string; label: string }>>([
    { value: '', label: 'All vendors' },
  ])
  const [categoryOptions, setCategoryOptions] = useState<Array<{ value: string; label: string }>>([
    { value: '', label: 'All categories' },
  ])
  const [page, setPage]         = useState(1)
  const [loading, startTransition] = useTransition()
  const [selected, setSelected] = useState<Product | null>(null)

  const [filters, setFilters] = useState<ProductFilters>({})
  const [sort, setSort]       = useState<SortConfig>({ field: 'last_seen', direction: 'desc' })

  // Filter state UI
  const [search, setSearch]           = useState('')
  const [vendorId, setVendorId]       = useState('')
  const [category, setCategory]       = useState('')
  const [availability, setAvailability] = useState('')
  const [hasSale, setHasSale]         = useState(false)
  const [hasIssues, setHasIssues]     = useState(false)

  const debouncedSearch = useDebounce(search, 350)

  const load = useCallback((f: ProductFilters, s: SortConfig, p: number) => {
    startTransition(async () => {
      try {
        const params = new URLSearchParams()
        if (f.search)        params.set('search', f.search)
        if (f.vendor_id)     params.set('vendor_id', String(f.vendor_id))
        if (f.category)      params.set('category', f.category)
        if (f.availability !== undefined) params.set('availability', String(f.availability))
        if (f.has_sale)      params.set('has_sale', '1')
        if (f.has_issues)    params.set('has_issues', '1')
        params.set('sort_field', s.field)
        params.set('sort_dir', s.direction)
        params.set('page', String(p))
        params.set('page_size', String(PAGE_SIZE))

        const res = await fetch(`/api/catalog/products?${params}`)
        const json = await res.json()
        setProducts(json.data ?? [])
        setTotal(json.total ?? 0)
      } catch (e) {
        console.error(e)
      }
    })
  }, [])

  useEffect(() => {
    const f: ProductFilters = {
      search: debouncedSearch || undefined,
      vendor_id: vendorId || undefined,
      category: category || undefined,
      availability: availability === '' ? undefined : availability === 'true',
      has_sale: hasSale || undefined,
      has_issues: hasIssues || undefined,
    }
    setPage(1)
    load(f, sort, 1)
  }, [debouncedSearch, vendorId, category, availability, hasSale, hasIssues, sort, load])

  useEffect(() => {
    let alive = true

    ;(async () => {
      try {
        const res = await fetch('/api/catalog/filters')
        const json = await res.json()
        if (!alive) return

        setVendorOptions([
          { value: '', label: 'All vendors' },
          ...((json.vendors ?? []).map((vendor: { id: number; name: string }) => ({
            value: String(vendor.id),
            label: vendor.name,
          }))),
        ])

        setCategoryOptions([
          { value: '', label: 'All categories' },
          ...((json.categories ?? []).map((value: string) => ({ value, label: value }))),
        ])
      } catch (e) {
        console.error(e)
      }
    })()

    return () => { alive = false }
  }, [])

  function toggleSort(field: ProductSortField) {
    setSort(prev =>
      prev.field === field
        ? { field, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { field, direction: 'desc' }
    )
  }

  function SortIcon({ field }: { field: ProductSortField }) {
    if (sort.field !== field) return <span className="w-3 h-3" />
    return sort.direction === 'asc'
      ? <ChevronUp className="w-3 h-3" />
      : <ChevronDown className="w-3 h-3" />
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <PageHeader
        title="Products"
        sub={`${total.toLocaleString()} rows`}
        actions={
          <span className="text-xs bg-purple-50 text-purple-700 border border-purple-200 px-2.5 py-1 rounded-full font-medium">
            {total.toLocaleString()} total
          </span>
        }
      />

      {/* Filters bar */}
      <div className="bg-white border-b border-gray-200 px-4 py-2.5 flex flex-wrap gap-2 items-center shrink-0">
        <Input
          icon={<Search className="w-3.5 h-3.5" />}
          placeholder="Search title, brand…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-52"
        />
        <Select
          options={vendorOptions}
          value={vendorId}
          onChange={e => setVendorId(e.target.value)}
          className="w-36"
        />
        <Select
          options={categoryOptions}
          value={category}
          onChange={e => setCategory(e.target.value)}
          className="w-40"
        />
        <Select
          options={[
            { value: '',     label: 'Availability' },
            { value: 'true', label: 'In stock' },
            { value: 'false',label: 'Out of stock' },
          ]}
          value={availability}
          onChange={e => setAvailability(e.target.value)}
          className="w-36"
        />
        <div className="h-5 w-px bg-gray-200" />
        <FilterBtn active={hasSale}   onClick={() => setHasSale(v => !v)}>On sale</FilterBtn>
        <FilterBtn active={hasIssues} onClick={() => setHasIssues(v => !v)}>Has issues</FilterBtn>
        {(search || vendorId || category || availability || hasSale || hasIssues) && (
          <button
            onClick={() => {
              setSearch(''); setVendorId(''); setCategory('')
              setAvailability(''); setHasSale(false); setHasIssues(false)
            }}
            className="text-xs text-gray-400 hover:text-gray-700"
          >
            Clear
          </button>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead className="sticky top-0 bg-white z-10">
            <tr className="border-b border-gray-200">
              <th className="w-10 px-3 py-2.5" />
              {([
                { label: 'Title',     field: 'title'     as ProductSortField },
                { label: 'Vendor',    field: null },
                { label: 'Brand',     field: 'brand'     as ProductSortField },
                { label: 'Category',  field: 'category'  as ProductSortField },
                { label: 'Color',     field: null },
                { label: 'Size',      field: null },
                { label: 'Price',     field: 'price_cents' as ProductSortField },
                { label: 'Sale',      field: null },
                { label: 'Avail',     field: null },
                { label: 'Last seen', field: 'last_seen' as ProductSortField },
                { label: 'Flags',     field: null },
              ]).map(({ label, field }) => (
                <th
                  key={label}
                  onClick={() => field && toggleSort(field)}
                  className={`text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wide px-3 py-2.5 whitespace-nowrap select-none ${field ? 'cursor-pointer hover:text-gray-600' : ''}`}
                >
                  <span className="inline-flex items-center gap-1">
                    {label}
                    {field && <SortIcon field={field} />}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className={loading ? 'opacity-60' : ''}>
            {products.length === 0 && !loading && (
              <tr><td colSpan={12}><EmptyState message="No products match your filters" /></td></tr>
            )}
            {products.map(p => {
              const flags    = getProductFlags(p)
              const active   = getActiveFlags(flags)
              const critical = active.some(f => f.severity === 'critical')
              const warn     = active.some(f => f.severity === 'warning')
              const disc     = p.price_cents && p.sales_price_cents
                ? Math.round(((p.price_cents - p.sales_price_cents) / p.price_cents) * 100)
                : null

              return (
                <tr
                  key={p.id}
                  onClick={() => setSelected(p)}
                  className="border-b border-gray-50 hover:bg-gray-50 transition-colors cursor-pointer"
                >
                  <td className="px-3 py-2">
                    {p.image_url
                      ? <img src={p.image_url} alt="" className="w-8 h-8 rounded-lg object-cover border border-gray-100" />
                      : <div className="w-8 h-8 rounded-lg bg-gray-100 border border-gray-100 flex items-center justify-center">
                          <span className="text-gray-300 text-[9px]">—</span>
                        </div>
                    }
                  </td>
                  <td className="px-3 py-2 max-w-[200px]">
                    <p className="font-medium text-gray-900 text-xs truncate">{p.title}</p>
                    {p.variant_id && (
                      <p className="text-[10px] font-mono text-gray-400 truncate">{p.variant_id}</p>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Badge color="gray">{(p.vendor as any)?.name ?? p.vendor_id}</Badge>
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500">{p.brand ?? <span className="text-gray-300">—</span>}</td>
                  <td className="px-3 py-2">
                    {p.category
                      ? <span className="text-xs text-gray-600">{p.category}</span>
                      : <Badge severity="warning">missing</Badge>
                    }
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500">{p.color ?? <span className="text-gray-300">—</span>}</td>
                  <td className="px-3 py-2 text-xs text-gray-500">{p.size ?? <span className="text-gray-300">—</span>}</td>
                  <td className="px-3 py-2 text-xs font-medium tabular-nums">{formatCents(p.price_cents, p.currency ?? undefined)}</td>
                  <td className="px-3 py-2">
                    {p.sales_price_cents ? (
                      <span className="text-teal-600 text-xs font-medium tabular-nums">
                        {formatCents(p.sales_price_cents, p.currency ?? undefined)}
                        {disc && <span className="ml-1 text-[10px] text-teal-500">−{disc}%</span>}
                      </span>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-2"><AvailBadge avail={p.availability} /></td>
                  <td className="px-3 py-2 text-[11px] text-gray-400 whitespace-nowrap">
                    {p.last_seen ? formatRelativeTime(p.last_seen) : '—'}
                  </td>
                  <td className="px-3 py-2">
                    {active.length > 0 ? (
                      <Badge severity={critical ? 'critical' : warn ? 'warning' : 'info'}>
                        {active.length}
                      </Badge>
                    ) : <span className="text-gray-200 text-xs">—</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="bg-white border-t border-gray-200 px-4 py-2.5 flex items-center justify-between shrink-0">
        <span className="text-xs text-gray-400">
          Page {page} of {totalPages} · {total.toLocaleString()} results
        </span>
        <div className="flex gap-2">
          <button
            disabled={page <= 1}
            onClick={() => { const p = page - 1; setPage(p); load(filters, sort, p) }}
            className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50"
          >
            ← Prev
          </button>
          <button
            disabled={page >= totalPages}
            onClick={() => { const p = page + 1; setPage(p); load(filters, sort, p) }}
            className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50"
          >
            Next →
          </button>
        </div>
      </div>

      {/* Product drawer */}
      {selected && (
        <ProductDrawer product={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}
