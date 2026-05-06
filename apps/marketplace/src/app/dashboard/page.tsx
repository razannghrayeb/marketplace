'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'
import { AlertTriangle, TrendingDown, DollarSign, CheckCircle } from 'lucide-react'
import Link from 'next/link'

type DashboardSummary = {
  total_at_risk: number
  total_critical: number
  value_at_risk_cents: number
  alerts_resolved_this_week: number
}

type DashboardProduct = {
  id: number
  title: string
  category: string | null
  image_url: string | null
  price_cents: number
  currency: string
  vendor_name: string
  days_listed: number
  dsr_score: number
  risk_level: 'green' | 'yellow' | 'red'
  top_reason: string
}

function RiskBadge({ level, score }: { level: 'green' | 'yellow' | 'red'; score: number }) {
  const styles = {
    green: 'bg-green-100 text-green-800',
    yellow: 'bg-yellow-100 text-yellow-800',
    red: 'bg-red-100 text-red-800',
  }
  const labels = { green: 'Low', yellow: 'At Risk', red: 'Critical' }
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${styles[level]}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {labels[level]} · {score}
    </span>
  )
}

function unwrap<T>(res: unknown): T {
  const r = res as Record<string, unknown>
  if (r?.data !== undefined) return r.data as T
  return res as T
}

export default function BusinessDashboardPage() {
  const [riskFilter, setRiskFilter] = useState('all')
  const [sort, setSort] = useState('highest_risk')

  const { data: productsRaw, isLoading } = useQuery({
    queryKey: ['dsr-products', riskFilter, sort],
    queryFn: () =>
      fetch(`/api/dashboard/products?risk_level=${riskFilter}&sort=${sort}`).then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
    retry: false,
  })

  const products: DashboardProduct[] = Array.isArray(unwrap(productsRaw))
    ? (unwrap(productsRaw) as DashboardProduct[])
    : []

  // Derive summary from the product list — avoids slow full-table COUNT queries
  const summary: DashboardSummary = {
    total_at_risk: products.filter((p) => p.risk_level === 'yellow').length,
    total_critical: products.filter((p) => p.risk_level === 'red').length,
    value_at_risk_cents: products.filter((p) => p.risk_level !== 'green').reduce((s, p) => s + p.price_cents, 0),
    alerts_resolved_this_week: 0,
  }
  const summaryLoading = isLoading

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold text-neutral-800">DSR Dashboard</h1>
          <p className="text-neutral-500 mt-1 text-sm">Dead Stock Risk scoring across your product catalog</p>
        </div>
        <Link
          href="/dashboard/alerts"
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-medium hover:bg-red-100 transition-colors"
        >
          <AlertTriangle className="w-4 h-4" />
          View Alerts
        </Link>
      </div>

      {/* KPI Cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-7 h-7 rounded-lg bg-yellow-100 flex items-center justify-center">
              <AlertTriangle className="w-3.5 h-3.5 text-yellow-600" />
            </span>
            <p className="text-xs uppercase tracking-wide text-neutral-500 font-medium">At Risk</p>
          </div>
          <p className="text-3xl font-bold text-yellow-600">
            {summaryLoading ? '—' : (summary as DashboardSummary)?.total_at_risk ?? '—'}
          </p>
          <p className="text-xs text-neutral-400 mt-1">DSR score 34–66</p>
        </div>

        <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-7 h-7 rounded-lg bg-red-100 flex items-center justify-center">
              <TrendingDown className="w-3.5 h-3.5 text-red-600" />
            </span>
            <p className="text-xs uppercase tracking-wide text-neutral-500 font-medium">Critical</p>
          </div>
          <p className="text-3xl font-bold text-red-600">
            {summaryLoading ? '—' : (summary as DashboardSummary)?.total_critical ?? '—'}
          </p>
          <p className="text-xs text-neutral-400 mt-1">DSR score 67–100</p>
        </div>

        <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-7 h-7 rounded-lg bg-orange-100 flex items-center justify-center">
              <DollarSign className="w-3.5 h-3.5 text-orange-600" />
            </span>
            <p className="text-xs uppercase tracking-wide text-neutral-500 font-medium">Value at Risk</p>
          </div>
          <p className="text-3xl font-bold text-orange-600">
            {summaryLoading
              ? '—'
              : `$${(((summary as DashboardSummary)?.value_at_risk_cents ?? 0) / 100).toLocaleString()}`}
          </p>
          <p className="text-xs text-neutral-400 mt-1">Sum of at-risk + critical</p>
        </div>

        <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-7 h-7 rounded-lg bg-green-100 flex items-center justify-center">
              <CheckCircle className="w-3.5 h-3.5 text-green-600" />
            </span>
            <p className="text-xs uppercase tracking-wide text-neutral-500 font-medium">Resolved This Week</p>
          </div>
          <p className="text-3xl font-bold text-green-600">
            {summaryLoading ? '—' : (summary as DashboardSummary)?.alerts_resolved_this_week ?? '—'}
          </p>
          <p className="text-xs text-neutral-400 mt-1">Alerts dismissed</p>
        </div>
      </div>

      {/* Product Table */}
      <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-neutral-100 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-neutral-800">Products by Risk</h2>
            <p className="text-xs text-neutral-400 mt-0.5">Showing up to 200 available products</p>
          </div>
          <div className="flex gap-2">
            <select
              aria-label="Filter by risk level"
              value={riskFilter}
              onChange={(e) => setRiskFilter(e.target.value)}
              className="text-sm border border-neutral-200 rounded-lg px-3 py-1.5 bg-white text-neutral-700 focus:outline-none focus:ring-2 focus:ring-violet-300"
            >
              <option value="all">All risk levels</option>
              <option value="red">Critical only</option>
              <option value="yellow">At risk only</option>
              <option value="green">Low risk only</option>
            </select>
            <select
              aria-label="Sort order"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="text-sm border border-neutral-200 rounded-lg px-3 py-1.5 bg-white text-neutral-700 focus:outline-none focus:ring-2 focus:ring-violet-300"
            >
              <option value="highest_risk">Highest risk first</option>
              <option value="lowest_risk">Lowest risk first</option>
              <option value="newest">Newest first</option>
            </select>
          </div>
        </div>

        {isLoading && (
          <div className="px-6 py-16 text-center text-neutral-400 text-sm">Loading products…</div>
        )}

        {!isLoading && products.length === 0 && (
          <div className="px-6 py-16 text-center text-neutral-400 text-sm">
            No products found for the selected filter.
          </div>
        )}

        {products.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-100 bg-neutral-50/50">
                  <th className="text-left px-6 py-3 text-xs font-semibold text-neutral-400 uppercase tracking-wide">Product</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-neutral-400 uppercase tracking-wide">Vendor</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-neutral-400 uppercase tracking-wide">Category</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-neutral-400 uppercase tracking-wide">Days Listed</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-neutral-400 uppercase tracking-wide">Price</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-neutral-400 uppercase tracking-wide">DSR Risk</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-neutral-400 uppercase tracking-wide">Top Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-50">
                {products.map((p) => (
                  <tr key={p.id} className="hover:bg-neutral-50/80 transition-colors">
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-3">
                        {p.image_url ? (
                          <img
                            src={p.image_url}
                            alt=""
                            className="w-9 h-9 rounded-lg object-cover bg-neutral-100 shrink-0"
                          />
                        ) : (
                          <div className="w-9 h-9 rounded-lg bg-neutral-100 shrink-0" />
                        )}
                        <span className="font-medium text-neutral-800 line-clamp-1 max-w-[220px]">
                          {p.title}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-neutral-600 whitespace-nowrap">{p.vendor_name}</td>
                    <td className="px-4 py-3 text-neutral-500">{p.category ?? '—'}</td>
                    <td className="px-4 py-3 text-neutral-600 whitespace-nowrap">{p.days_listed}d</td>
                    <td className="px-4 py-3 text-neutral-800 font-medium whitespace-nowrap">
                      ${(p.price_cents / 100).toFixed(2)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <RiskBadge level={p.risk_level} score={p.dsr_score} />
                    </td>
                    <td className="px-4 py-3 text-neutral-400 text-xs max-w-[180px] line-clamp-2">
                      {p.top_reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
