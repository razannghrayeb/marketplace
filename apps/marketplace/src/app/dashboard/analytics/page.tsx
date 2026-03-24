'use client'

import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell } from 'recharts'
import { BarChart3, Package, Tag } from 'lucide-react'
import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'

type FacetData = {
  categories?: Array<{ value: string; count: number }>
  brands?: Array<{ value: string; count: number }>
}

const CHART_COLORS = ['#6d28d9', '#7c3aed', '#8b5cf6', '#a78bfa', '#525252', '#737373', '#a3a3a3', '#d4d4d4']

function CategoryChart() {
  const { data } = useQuery({
    queryKey: ['dashboard-analytics-facets'],
    queryFn: () => api.get<FacetData>(endpoints.products.facets),
  })
  const categories = (data?.data as FacetData)?.categories?.slice(0, 10) ?? []
  const chartData = categories.map((c) => ({ name: c.value || 'Other', count: c.count }))
  const totalProducts = chartData.reduce((acc, c) => acc + c.count, 0)

  if (chartData.length === 0) return null

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-6">
      <h3 className="font-display font-semibold text-neutral-800 mb-4 flex items-center gap-2">
        <Tag className="w-5 h-5 text-violet-600" />
        Products by category
      </h3>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 12 }} />
            <Bar dataKey="count" radius={[0, 4, 4, 0]}>
              {chartData.map((_, i) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="text-sm text-neutral-500 mt-2">{totalProducts} products across {chartData.length} categories</p>
    </div>
  )
}

function BrandChart() {
  const { data } = useQuery({
    queryKey: ['dashboard-analytics-facets'],
    queryFn: () => api.get<FacetData>(endpoints.products.facets),
  })
  const brands = (data?.data as FacetData)?.brands?.slice(0, 10) ?? []
  const chartData = brands.map((b) => ({ name: b.value || 'Other', count: b.count }))

  if (chartData.length === 0) return null

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-6">
      <h3 className="font-display font-semibold text-neutral-800 mb-4 flex items-center gap-2">
        <BarChart3 className="w-5 h-5 text-violet-600" />
        Top brands
      </h3>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 12 }} />
            <Bar dataKey="count" radius={[0, 4, 4, 0]}>
              {chartData.map((_, i) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export default function DashboardAnalyticsPage() {
  const { data } = useQuery({
    queryKey: ['dashboard-analytics-facets'],
    queryFn: () => api.get<FacetData>(endpoints.products.facets),
  })
  const facets = (data?.data ?? {}) as FacetData
  const totalProducts = facets.categories?.reduce((acc, c) => acc + c.count, 0) ?? 0
  const categoryCount = facets.categories?.length ?? 0
  const brandCount = facets.brands?.length ?? 0

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h1 className="font-display text-3xl font-bold text-neutral-800 mb-2">
          Analytics
        </h1>
        <p className="text-neutral-500 mb-8">
          Catalog insights and marketplace distribution
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-12">
          {[
            { label: 'Total products', value: totalProducts, icon: Package },
            { label: 'Categories', value: categoryCount, icon: Tag },
            { label: 'Brands', value: brandCount, icon: BarChart3 },
          ].map((stat) => (
            <div
              key={stat.label}
              className="p-6 rounded-2xl border border-neutral-200 bg-white"
            >
              <div className="flex items-center gap-2 text-neutral-500 text-sm mb-2">
                <stat.icon className="w-4 h-4" />
                {stat.label}
              </div>
              <p className="text-2xl font-bold text-neutral-800">{stat.value}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <CategoryChart />
          <BrandChart />
        </div>
      </motion.div>
    </div>
  )
}
