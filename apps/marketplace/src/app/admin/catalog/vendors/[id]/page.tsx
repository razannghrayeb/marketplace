import { notFound } from 'next/navigation'
import Link from 'next/link'
import { supabaseAdmin as sb } from '@/lib/supabase/client'
import { fetchVendorStats } from '@/lib/catalog-queries'
import { PageHeader, KpiCard, Section, Badge, HealthBar } from '@/components/catalog-admin/ui'
import { formatRelativeTime, formatCents } from '@/lib/utils/catalog-quality'
import { ArrowLeft, ExternalLink } from 'lucide-react'

interface Props {
  params: { id: string }
}

async function fetchVendorProducts(vendorId: number) {
  const { data } = await sb
    .from('products')
    .select(
      'id,title,category,brand,color,size,price_cents,sales_price_cents,availability,last_seen,image_url,variant_id,parent_product_url'
    )
    .eq('vendor_id', vendorId)
    .order('last_seen', { ascending: false })
    .limit(100)
  return data ?? []
}

export default async function VendorDetailPage({ params }: Props) {
  const allVendors = await fetchVendorStats().catch(() => [])
  const vendorId = Number(params.id)
  const vendor = allVendors.find((v) => v.id === vendorId)
  if (!vendor) notFound()

  const products = await fetchVendorProducts(vendorId)

  const catMap = new Map<string, number>()
  for (const p of products as { category?: string | null }[]) {
    const cat = p.category ?? '(none)'
    catMap.set(cat, (catMap.get(cat) ?? 0) + 1)
  }
  const catBreakdown = Array.from(catMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)

  return (
    <div>
      <PageHeader
        title={vendor.name}
        sub={vendor.url}
        actions={
          <>
            <Link
              href="/admin/catalog/vendors"
              className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
            >
              <ArrowLeft className="w-3 h-3" /> Back
            </Link>
            <a
              href={vendor.url}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-blue-600 flex items-center gap-1 border border-blue-200 rounded-lg px-2.5 py-1 hover:bg-blue-50"
            >
              Open site <ExternalLink className="w-3 h-3" />
            </a>
          </>
        }
      />

      <div className="p-6 flex flex-col gap-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          <KpiCard label="Total" value={vendor.total_products} />
          <KpiCard label="Available" value={vendor.available_products} tone="good" />
          <KpiCard label="Unavailable" value={vendor.unavailable_products} tone="danger" />
          <KpiCard
            label="Health"
            value={`${vendor.health_score}%`}
            tone={
              vendor.health_score >= 80 ? 'good' : vendor.health_score >= 60 ? 'warn' : 'danger'
            }
          />
          <KpiCard
            label="Miss. Category"
            value={vendor.missing_category}
            tone={vendor.missing_category > 0 ? 'warn' : 'default'}
          />
          <KpiCard
            label="Miss. Image"
            value={vendor.missing_image_url}
            tone={vendor.missing_image_url > 0 ? 'warn' : 'default'}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Section title="Category distribution">
            <div className="space-y-2">
              {catBreakdown.map(([cat, count]) => (
                <div key={cat} className="flex items-center gap-2">
                  <span className="text-xs text-gray-600 w-28 truncate">{cat}</span>
                  <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-400 rounded-full"
                      style={{ width: `${Math.round((count / vendor.total_products) * 100)}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-400 tabular-nums w-10 text-right">{count}</span>
                </div>
              ))}
              {catBreakdown.length === 0 && <p className="text-xs text-gray-400">No category data</p>}
            </div>
          </Section>

          <Section title="Vendor info">
            <div className="space-y-3 text-sm">
              {[
                { label: 'ID', value: vendor.id },
                { label: 'URL', value: vendor.url },
                { label: 'Ships to LB', value: vendor.ship_to_lebanon ? 'Yes' : 'No' },
                {
                  label: 'Last seen',
                  value: vendor.latest_last_seen
                    ? formatRelativeTime(vendor.latest_last_seen)
                    : 'Never',
                },
                { label: 'Miss. variant', value: vendor.missing_variant_id.toLocaleString() },
                { label: 'Miss. parent', value: vendor.missing_parent_url.toLocaleString() },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between items-start gap-4">
                  <span className="text-xs text-gray-400 shrink-0">{label}</span>
                  <span className="text-xs font-mono text-gray-700 text-right break-all">{value}</span>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Data health">
            <div className="space-y-3">
              {[
                {
                  label: 'Has image_url',
                  pct: Math.round(
                    ((vendor.total_products - vendor.missing_image_url) /
                      Math.max(vendor.total_products, 1)) *
                      100
                  ),
                },
                {
                  label: 'Has category',
                  pct: Math.round(
                    ((vendor.total_products - vendor.missing_category) /
                      Math.max(vendor.total_products, 1)) *
                      100
                  ),
                },
                {
                  label: 'Has color',
                  pct: Math.round(
                    ((vendor.total_products - vendor.missing_color) / Math.max(vendor.total_products, 1)) *
                      100
                  ),
                },
                {
                  label: 'Has size',
                  pct: Math.round(
                    ((vendor.total_products - vendor.missing_size) / Math.max(vendor.total_products, 1)) *
                      100
                  ),
                },
                {
                  label: 'Has variant',
                  pct: Math.round(
                    ((vendor.total_products - vendor.missing_variant_id) /
                      Math.max(vendor.total_products, 1)) *
                      100
                  ),
                },
              ].map(({ label, pct }) => (
                <div key={label} className="flex items-center gap-3">
                  <span className="text-xs text-gray-500 w-28 shrink-0">{label}</span>
                  <HealthBar score={pct} />
                </div>
              ))}
            </div>
          </Section>
        </div>

        <Section title={`Products (showing ${products.length} most recent)`} noPad>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  {['', 'Title', 'Brand', 'Category', 'Color', 'Size', 'Price', 'Avail', 'Last seen'].map(
                    (h) => (
                      <th
                        key={h}
                        className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wide px-3 py-2.5"
                      >
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {(
                  products as {
                    id: number
                    title: string
                    variant_id?: string | null
                    brand?: string | null
                    category?: string | null
                    color?: string | null
                    size?: string | null
                    price_cents?: number | null
                    sales_price_cents?: number | null
                    availability?: boolean | null
                    last_seen?: string | null
                    image_url?: string | null
                  }[]
                ).map((p) => (
                  <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="px-3 py-2">
                      {p.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.image_url}
                          alt=""
                          className="w-8 h-8 rounded object-cover border border-gray-200"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded bg-gray-100 border border-gray-200" />
                      )}
                    </td>
                    <td className="px-3 py-2 max-w-[180px]">
                      <p className="font-medium text-gray-900 truncate text-xs">{p.title}</p>
                      <p className="text-[10px] font-mono text-gray-400 truncate">{p.variant_id ?? ''}</p>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500">{p.brand ?? '—'}</td>
                    <td className="px-3 py-2">
                      {p.category ? (
                        <span className="text-xs text-gray-600">{p.category}</span>
                      ) : (
                        <Badge severity="warning">missing</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500">{p.color ?? '—'}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{p.size ?? '—'}</td>
                    <td className="px-3 py-2 text-xs font-medium tabular-nums">
                      {formatCents(p.price_cents)}
                      {p.sales_price_cents && (
                        <span className="text-teal-600 ml-1">{formatCents(p.sales_price_cents)}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {p.availability ? (
                        <span className="text-teal-600 text-xs font-medium">In</span>
                      ) : (
                        <span className="text-red-400 text-xs">Out</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-gray-400 whitespace-nowrap">
                      {p.last_seen ? formatRelativeTime(p.last_seen) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    </div>
  )
}
