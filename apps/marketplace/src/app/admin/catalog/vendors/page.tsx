import Link from 'next/link'
import { fetchVendorStats } from '@/lib/catalog-queries'
import { PageHeader, Section, Badge, HealthBar } from '@/components/catalog-admin/ui'
import { formatRelativeTime } from '@/lib/utils/catalog-quality'
import { ExternalLink } from 'lucide-react'

export default async function VendorsPage() {
  const vendors = await fetchVendorStats().catch(() => [])

  return (
    <div>
      <PageHeader
        title="Vendors"
        sub={`${vendors.length} active vendors`}
        actions={
          <span className="text-xs text-blue-600 bg-blue-50 px-2.5 py-1 rounded-full border border-blue-200 font-medium">
            {vendors.length} vendors
          </span>
        }
      />

      <div className="p-6">
        <Section noPad>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  {['Vendor', 'Products', 'Available', 'Unavailable', 'Miss. Cat', 'Miss. Img', 'Last Seen', 'Health', 'Ships LB'].map(h => (
                    <th key={h} className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wide px-4 py-3 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {vendors.map(v => {
                  const isStale = v.latest_last_seen
                    ? (Date.now() - new Date(v.latest_last_seen).getTime()) > 86400000 * 3
                    : true

                  return (
                    <tr key={v.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors group">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isStale ? 'bg-red-400' : 'bg-teal-400'}`} />
                          <div>
                            <Link
                              href={`/admin/catalog/vendors/${v.id}`}
                              className="font-medium text-gray-900 hover:text-blue-600 transition-colors"
                            >
                              {v.name}
                            </Link>
                            <div className="flex items-center gap-1 mt-0.5">
                              <span className="text-[11px] text-gray-400 font-mono">{v.url}</span>
                              <a href={v.url} target="_blank" rel="noreferrer"
                                className="opacity-0 group-hover:opacity-100 transition-opacity">
                                <ExternalLink className="w-3 h-3 text-gray-400" />
                              </a>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-medium tabular-nums">{v.total_products.toLocaleString()}</td>
                      <td className="px-4 py-3 text-teal-600 font-medium tabular-nums">{v.available_products.toLocaleString()}</td>
                      <td className="px-4 py-3 text-red-500 tabular-nums">{v.unavailable_products.toLocaleString()}</td>
                      <td className="px-4 py-3">
                        {v.missing_category > 0 ? (
                          <Badge severity={v.missing_category > 500 ? 'warning' : 'info'}>
                            {v.missing_category.toLocaleString()}
                          </Badge>
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {v.missing_image_url > 0 ? (
                          <Badge severity={v.missing_image_url > 200 ? 'warning' : 'info'}>
                            {v.missing_image_url.toLocaleString()}
                          </Badge>
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                        {v.latest_last_seen ? formatRelativeTime(v.latest_last_seen) : (
                          <span className="text-red-400">Never</span>
                        )}
                      </td>
                      <td className="px-4 py-3 w-36">
                        <HealthBar score={v.health_score} />
                      </td>
                      <td className="px-4 py-3">
                        <Badge color={v.ship_to_lebanon ? 'teal' : 'gray'}>
                          {v.ship_to_lebanon ? 'Yes' : 'No'}
                        </Badge>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    </div>
  )
}
