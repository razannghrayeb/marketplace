'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import clsx from 'clsx'
import { LayoutDashboard, Shield, Terminal, Package, GitMerge, Timer, Brain, Activity } from 'lucide-react'
import { useAdminBasePath } from '@/components/admin/AdminBasePathContext'

const NAV = [
  { segment: '' as const, label: 'Overview', icon: LayoutDashboard, exact: true },
  { segment: 'moderation' as const, label: 'Moderation', icon: Shield },
  { segment: 'canonicals' as const, label: 'Canonicals', icon: GitMerge },
  { segment: 'jobs' as const, label: 'Jobs', icon: Timer },
  { segment: 'reco' as const, label: 'Reco labeling', icon: Brain },
  { segment: 'system' as const, label: 'System', icon: Activity },
  { segment: 'console' as const, label: 'API console', icon: Terminal },
]

export function AdminSidebar({ brandLabel = 'Admin' }: { brandLabel?: string }) {
  const pathname = usePathname()
  const base = useAdminBasePath()

  return (
    <aside className="w-56 shrink-0 border-r border-neutral-200/80 bg-white/90 backdrop-blur-sm min-h-[calc(100vh-4rem)] py-6 px-3 sticky top-16 self-start">
      <div className="flex items-center gap-2 px-3 mb-6 text-neutral-900 font-display font-semibold">
        <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-600 via-fuchsia-500 to-rose-500 flex items-center justify-center shadow-md shadow-violet-500/20">
          <Package className="w-4 h-4 text-white" />
        </span>
        {brandLabel}
      </div>
      <nav className="space-y-1">
        {NAV.map(({ segment, label, icon: Icon, exact }) => {
          const href = segment === '' ? base : `${base}/${segment}`
          const active = exact
            ? pathname === href || pathname === `${href}/`
            : pathname === href || pathname.startsWith(`${href}/`)
          return (
            <Link
              key={href}
              href={href}
              className={clsx(
                'flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-violet-100 text-violet-900 shadow-sm'
                  : 'text-neutral-700 hover:bg-violet-50 hover:text-violet-900'
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
