'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'
import { AlertTriangle, TrendingDown, TrendingUp, X } from 'lucide-react'

type Alert = {
  id: number
  product_id: number
  product_title: string
  alert_type: 'early_risk' | 'critical' | 'recovery'
  message: string
  dismissed: boolean
  created_at: string
}

const ALERT_CONFIG = {
  critical: {
    label: 'Critical',
    Icon: TrendingDown,
    card: 'border-red-200 bg-red-50',
    badge: 'bg-red-100 text-red-800',
    iconColor: 'text-red-500',
  },
  early_risk: {
    label: 'Early Risk',
    Icon: AlertTriangle,
    card: 'border-yellow-200 bg-yellow-50',
    badge: 'bg-yellow-100 text-yellow-800',
    iconColor: 'text-yellow-500',
  },
  recovery: {
    label: 'Recovery',
    Icon: TrendingUp,
    card: 'border-green-200 bg-green-50',
    badge: 'bg-green-100 text-green-800',
    iconColor: 'text-green-500',
  },
}

function unwrap<T>(res: unknown): T {
  const r = res as Record<string, unknown>
  if (r?.data !== undefined) return r.data as T
  return res as T
}

export default function AlertsPage() {
  const qc = useQueryClient()

  const { data: raw, isLoading } = useQuery({
    queryKey: ['dsr-alerts'],
    queryFn: () => fetch('/api/dashboard/alerts').then((r) => r.json()),
    retry: 1,
  })

  const dismiss = useMutation({
    mutationFn: async (alertId: number) => {
      return { success: true }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dsr-alerts'] }),
  })

  const alerts: Alert[] = Array.isArray(unwrap(raw)) ? (unwrap(raw) as Alert[]) : []

  const counts = {
    critical: alerts.filter((a) => a.alert_type === 'critical').length,
    early_risk: alerts.filter((a) => a.alert_type === 'early_risk').length,
    recovery: alerts.filter((a) => a.alert_type === 'recovery').length,
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold text-neutral-800">DSR Alerts</h1>
        <p className="text-neutral-500 mt-1 text-sm">
          Active alerts ordered by severity — dismiss once reviewed
        </p>
      </div>

      {/* Summary chips */}
      {!isLoading && alerts.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {counts.critical > 0 && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium bg-red-100 text-red-800">
              <TrendingDown className="w-3.5 h-3.5" />
              {counts.critical} critical
            </span>
          )}
          {counts.early_risk > 0 && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium bg-yellow-100 text-yellow-800">
              <AlertTriangle className="w-3.5 h-3.5" />
              {counts.early_risk} at risk
            </span>
          )}
          {counts.recovery > 0 && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium bg-green-100 text-green-800">
              <TrendingUp className="w-3.5 h-3.5" />
              {counts.recovery} recovering
            </span>
          )}
        </div>
      )}

      {isLoading && (
        <p className="text-neutral-400 text-sm">Loading alerts…</p>
      )}

      {!isLoading && alerts.length === 0 && (
        <div className="rounded-2xl border border-neutral-200 bg-white p-16 text-center shadow-sm">
          <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
            <TrendingUp className="w-6 h-6 text-green-600" />
          </div>
          <p className="text-neutral-700 font-medium">All clear</p>
          <p className="text-neutral-400 text-sm mt-1">No active alerts. All products look healthy.</p>
        </div>
      )}

      <div className="space-y-3">
        {alerts.map((alert) => {
          const cfg = ALERT_CONFIG[alert.alert_type]
          const { Icon } = cfg
          const date = new Date(alert.created_at).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })

          return (
            <div
              key={alert.id}
              className={`rounded-2xl border p-4 flex items-start gap-4 ${cfg.card}`}
            >
              <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${cfg.iconColor}`} />

              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cfg.badge}`}>
                    {cfg.label}
                  </span>
                  <span className="text-xs text-neutral-400">{date}</span>
                </div>
                <p className="text-sm font-medium text-neutral-800 line-clamp-1">
                  {alert.product_title}
                </p>
                <p className="text-sm text-neutral-600 mt-0.5">{alert.message}</p>
              </div>

              <button
                onClick={() => dismiss.mutate(alert.id)}
                disabled={dismiss.isPending}
                className="shrink-0 p-1.5 rounded-lg hover:bg-black/10 transition-colors text-neutral-400 hover:text-neutral-700 disabled:opacity-50"
                aria-label="Dismiss alert"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
