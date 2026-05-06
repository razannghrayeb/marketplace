'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { ExternalLink } from 'lucide-react'
import { PageHeader, Section, Badge, HealthBar } from '@/components/catalog-admin/ui'
import { formatRelativeTime } from '@/lib/utils/catalog-quality'
import type { VendorStats } from '@/types/catalog-admin'

function VendorsSkeleton() {
  return (
    <div className="p-6">
      <div className="rounded-2xl border border-neutral-100 overflow-hidden">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex gap-4 px-4 py-3 border-b border-gray-50 animate-pulse">
            <div className="h-4 bg-gray-100 rounded w-32" />
            <div className="h-4 bg-gray-100 rounded w-16 ml-auto" />
            <div className="h-4 bg-gray-100 rounded w-16" />
            <div className="h-4 bg-gray-100 rounded w-16" />
          </div>
        ))}
      </div>
    </div>
  )
}

export default function VendorsPage() {
  const { data, isLoading } = useQuery<VendorStats[]>({
    queryKey: ['admin-vendors'],
    queryFn: () => fetch('/api/admin/vendors').then(r => r.json()).then(r => r.data ?? []),
    staleTime: 5 * 60 * 1000,
    retry: false,
  })

  const vendors = data ?? []

  return (
    <div>
      <PageHeader
        title="Vendors"
        sub={isLoading ? 'Loading…' : `${vendors.length} active vendors`}
        actions={
          <span className="text-xs text-[#2a2623] bg-[#f7f0eb] px-2.5 py-1 rounded-full border border-[#d8c6bb] font-medium">
            {isLoading ? '…' : vendors.length} vendors
          </span>
        }
      />

      {isLoading ? (
        <VendorsSkeleton />
      ) : (
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
                            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isStale ? 'bg-red-400' : 'bg-orange-500'}`} />
                            <div>
                              <Link href={`/admin/catalog/vendors/${v.id}`} className="font-medium text-gray-900 hover:text-[#2a2623] transition-colors">
                                {v.name}
                              </Link>
                              <div className="flex items-center gap-1 mt-0.5">
                                <span className="text-[11px] text-gray-400 font-mono">{v.url}</span>
                                <a href={v.url} target="_blank" rel="noreferrer" aria-label={`Open ${v.name} website`} className="opacity-0 group-hover:opacity-100 transition-opacity">
                                  <ExternalLink className="w-3 h-3 text-gray-400" />
                                </a>
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 font-medium tabular-nums">{v.total_products.toLocaleString()}</td>
                        <td className="px-4 py-3 text-[#7d4b3a] font-medium tabular-nums">{v.available_products.toLocaleString()}</td>
                        <td className="px-4 py-3 text-red-500 tabular-nums">{v.unavailable_products.toLocaleString()}</td>
                        <td className="px-4 py-3">
                          {v.missing_category > 0 ? (
                            <Badge severity={v.missing_category > 500 ? 'warning' : 'info'}>{v.missing_category.toLocaleString()}</Badge>
                          ) : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          {v.missing_image_url > 0 ? (
                            <Badge severity={v.missing_image_url > 200 ? 'warning' : 'info'}>{v.missing_image_url.toLocaleString()}</Badge>
                          ) : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                          {v.latest_last_seen ? formatRelativeTime(v.latest_last_seen) : <span className="text-red-400">Never</span>}
                        </td>
                        <td className="px-4 py-3 w-36"><HealthBar score={v.health_score} /></td>
                        <td className="px-4 py-3">
                          <Badge color={v.ship_to_lebanon ? 'teal' : 'gray'}>{v.ship_to_lebanon ? 'Yes' : 'No'}</Badge>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Section>
        </div>
      )}
    </div>
  )
}
