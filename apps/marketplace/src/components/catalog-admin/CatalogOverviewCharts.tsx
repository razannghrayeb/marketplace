'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts'
import type { VendorProductCount, CategoryCount } from '@/types/catalog-admin'
import { EmptyState, Section } from '@/components/catalog-admin/ui'

const COLORS = ['#7c3aed', '#c026d3', '#db2777', '#4f46e5', '#059669', '#ea580c', '#0891b2']

interface Props {
  vendorCounts: VendorProductCount[]
  catCounts: CategoryCount[]
}

export function CatalogOverviewCharts({ vendorCounts, catCounts }: Props) {
  const availData = vendorCounts.map((vendor) => ({
    name: vendor.vendor_name,
    available: vendor.available,
    unavailable: vendor.unavailable,
  }))

  const catData = catCounts.slice(0, 8).map((category) => ({
    name: category.category ?? '(none)',
    value: category.count,
  }))

  const hasVendorData = vendorCounts.length > 0
  const hasCategoryData = catData.length > 0

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Section title="Products by vendor">
        {hasVendorData ? (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={vendorCounts} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
              <XAxis dataKey="vendor_name" tick={{ fontSize: 11 }} tickLine={false} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
                formatter={(value: number) => value.toLocaleString()}
              />
              <Bar dataKey="total" name="Total" fill="#3b82f6" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState message="No vendor totals available yet" />
        )}
      </Section>

      <Section title="Availability by vendor">
        {hasVendorData ? (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={availData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} tickLine={false} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
                formatter={(value: number) => value.toLocaleString()}
              />
              <Bar dataKey="available" name="Available" fill="#059669" radius={[3, 3, 0, 0]} stackId="a" />
              <Bar dataKey="unavailable" name="Unavailable" fill="#fda4af" radius={[0, 0, 0, 0]} stackId="a" />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState message="No availability data available yet" />
        )}
      </Section>

      <Section title="Products by category">
        {hasCategoryData ? (
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={catData}
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={85}
                paddingAngle={2}
                dataKey="value"
              >
                {catData.map((_, index) => (
                  <Cell key={index} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
                formatter={(value: number) => value.toLocaleString()}
              />
              <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState message="The pie chart is wired up, but category data is empty right now" />
        )}
      </Section>

      <Section title="Vendor product counts">
        {hasVendorData ? (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart
              data={vendorCounts}
              layout="vertical"
              margin={{ top: 4, right: 20, bottom: 4, left: 60 }}
            >
              <XAxis type="number" tick={{ fontSize: 11 }} tickLine={false} />
              <YAxis
                dataKey="vendor_name"
                type="category"
                tick={{ fontSize: 11 }}
                width={60}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
                formatter={(value: number) => value.toLocaleString()}
              />
              <Bar dataKey="total" name="Total" fill="#c026d3" radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState message="No vendor chart data available yet" />
        )}
      </Section>
    </div>
  )
}
