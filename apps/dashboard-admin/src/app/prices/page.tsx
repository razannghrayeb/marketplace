import { fetchRecentPriceChanges, fetchDailyPriceVolume, fetchCurrentSaleProducts } from '@/lib/queries'
import { PageHeader, KpiCard, Section } from '@/components/ui'
import { PriceCharts } from './PriceCharts'
import { formatCents, formatRelativeTime } from '@/lib/utils/quality'

const EMPTY = '--'

export default async function PricesPage() {
  const [changes, volume, currentSales] = await Promise.all([
    fetchRecentPriceChanges(5000).catch(() => []),
    fetchDailyPriceVolume().catch(() => []),
    fetchCurrentSaleProducts(20).catch(() => []),
  ])

  const changesTyped = changes as any[]
  const discounts = changesTyped.filter((change) => change.is_discount).slice(0, 20)
  const increases = changesTyped.filter((change) => !change.is_discount).slice(0, 10)
  const activeSales = currentSales as any[]
  const todayCount = changesTyped.filter((change) => {
    const changedAt = new Date(change.recorded_at)
    const now = new Date()
    return changedAt.toDateString() === now.toDateString()
  }).length
  const biggestDisc = discounts[0]
    ? Math.abs(Math.round(discounts[0].change_pct))
    : activeSales[0]
      ? Math.abs(Math.round(activeSales[0].discount_pct))
      : 0
  const hasPriceData = changesTyped.length > 0 || volume.length > 0 || activeSales.length > 0
  const tableRows = discounts.length > 0 ? discounts : activeSales
  const showingCurrentSales = discounts.length === 0 && activeSales.length > 0

  return (
    <div>
      <PageHeader
        title="Price History"
        sub="Price change events across all products"
        actions={
          <span className="text-xs bg-green-50 text-green-700 border border-green-200 px-2.5 py-1 rounded-full font-medium">
            Live tracking
          </span>
        }
      />

      <div className="p-6 flex flex-col gap-6">
        {!hasPriceData && (
          <Section>
            <div className="flex flex-col gap-1 text-sm text-amber-700">
              <p className="font-medium">The page layout is working, but there are no price-change events to render yet.</p>
              <p className="text-xs text-amber-600">
                Usually this means the `price_history` table only has snapshots with no actual price changes yet, or the dashboard SQL functions were not added in Supabase.
              </p>
            </div>
          </Section>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KpiCard label="Changes today" value={todayCount} />
          <KpiCard label="Biggest discount" value={biggestDisc > 0 ? `-${biggestDisc}%` : EMPTY} tone="good" />
          <KpiCard label="New discounts" value={discounts.length} tone="good" />
          <KpiCard label="Price increases" value={increases.length} tone="warn" />
        </div>

        <PriceCharts volume={volume as any[]} />

        <Section title={showingCurrentSales ? 'Current active sales' : 'Biggest discounts'} noPad>
          <div className="overflow-x-auto">
            {showingCurrentSales && (
              <div className="px-4 py-3 text-xs text-amber-700 bg-amber-50 border-b border-amber-100">
                No recorded discount events were found in `price_history`, so this table is showing products that are currently on sale from the `products` table.
              </div>
            )}
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  {['', 'Product', 'Vendor', 'Before', 'After', 'Discount', 'When'].map((heading) => (
                    <th key={heading} className="text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wide px-4 py-2.5 whitespace-nowrap">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableRows.map((change: any) => (
                  <tr key={`${change.product_id}-${change.recorded_at ?? change.last_seen ?? change.product_title}`} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-2">
                      {change.image_url ? (
                        <img src={change.image_url} alt="" className="w-8 h-8 rounded-lg object-cover border border-gray-200" />
                      ) : (
                        <div className="w-8 h-8 rounded-lg bg-gray-100" />
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <p className="font-medium text-gray-900 text-xs max-w-[200px] truncate">{change.product_title}</p>
                    </td>
                    <td className="px-4 py-2">
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded font-medium">
                        {change.vendor_name}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-500 line-through tabular-nums">
                      {formatCents(change.old_price)}
                    </td>
                    <td className="px-4 py-2 text-xs text-teal-600 font-medium tabular-nums">
                      {formatCents(change.new_price)}
                    </td>
                    <td className="px-4 py-2">
                      <span className="text-xs font-semibold text-teal-700 bg-teal-50 border border-teal-200 px-2 py-0.5 rounded-full">
                        -{Math.abs(Math.round(change.change_pct ?? change.discount_pct ?? 0))}%
                      </span>
                    </td>
                    <td className="px-4 py-2 text-[11px] text-gray-400 whitespace-nowrap">
                      {formatRelativeTime(change.recorded_at ?? change.last_seen)}
                    </td>
                  </tr>
                ))}
                {tableRows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-xs text-gray-400">
                      No discount or active sale rows found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    </div>
  )
}
