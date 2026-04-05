'use client'

import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { Section } from '@/components/catalog-admin/ui'

interface Props {
  volume: { date: string; count: number }[]
}

export function CatalogPriceCharts({ volume }: Props) {
  const data = volume.map((v) => ({
    date: v.date.slice(5),
    count: v.count,
  }))

  return (
    <Section title="Actual price changes - last 30 days">
      {data.length === 0 ? (
        <p className="text-xs text-gray-400 py-6 text-center">No data</p>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="catalogPriceGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.15} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
            <Tooltip
              contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e5e7eb' }}
              formatter={(v: number) => [v.toLocaleString(), 'Actual changes']}
            />
            <Area type="monotone" dataKey="count" stroke="#10b981" strokeWidth={1.5} fill="url(#catalogPriceGrad)" />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </Section>
  )
}
