'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import clsx from 'clsx'
import type { LucideIcon } from 'lucide-react'
import {
  LayoutDashboard,
  Shield,
  Terminal,
  GitMerge,
  Timer,
  Brain,
  Activity,
  ChevronRight,
} from 'lucide-react'
import { useAdminBasePath } from '@/components/admin/AdminBasePathContext'

type NavItem = {
  segment: '' | 'moderation' | 'canonicals' | 'jobs' | 'reco' | 'system' | 'console'
  label: string
  icon: LucideIcon
  color: string
  exact?: boolean
}

const SECTIONS: { section: string; items: NavItem[] }[] = [
  {
    section: 'Operations',
    items: [
      { segment: '', label: 'Overview', icon: LayoutDashboard, color: 'bg-violet-600', exact: true },
      { segment: 'moderation', label: 'Moderation', icon: Shield, color: 'bg-fuchsia-500' },
      { segment: 'canonicals', label: 'Canonicals', icon: GitMerge, color: 'bg-rose-500' },
      { segment: 'jobs', label: 'Jobs', icon: Timer, color: 'bg-violet-500' },
    ],
  },
  {
    section: 'Intelligence & system',
    items: [
      { segment: 'reco', label: 'Reco labeling', icon: Brain, color: 'bg-fuchsia-600' },
      { segment: 'system', label: 'System', icon: Activity, color: 'bg-violet-700' },
      { segment: 'console', label: 'API console', icon: Terminal, color: 'bg-neutral-700' },
    ],
  },
]

export function AdminSidebar({ brandLabel = 'Admin' }: { brandLabel?: string }) {
  const pathname = usePathname()
  const base = useAdminBasePath()

  return (
    <aside className="w-[220px] min-w-[220px] h-full shrink-0 flex flex-col overflow-y-auto border-r border-neutral-200 bg-white/95 backdrop-blur-sm">
      <div className="px-4 py-5 border-b border-neutral-100">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-600 via-fuchsia-500 to-rose-500 flex items-center justify-center shadow-md shadow-violet-500/25">
            <span className="text-white text-xs font-display font-bold tracking-tight">S</span>
          </div>
          <div>
            <p className="text-sm font-display font-semibold text-neutral-900 leading-none">StyleAI</p>
            <p className="text-[10px] text-neutral-500 mt-1 font-medium">
              {brandLabel === 'Business' ? 'Business · internal' : 'Admin · internal'}
            </p>
          </div>
        </div>
      </div>

      <nav className="flex-1 py-3">
        {SECTIONS.map(({ section, items }) => (
          <div key={section} className="mb-4">
            <p className="px-4 py-1 text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">
              {section}
            </p>
            {items.map(({ segment, label, icon: Icon, color, exact }) => {
              const href = segment === '' ? base : `${base}/${segment}`
              const active = exact
                ? pathname === href || pathname === `${href}/`
                : pathname === href || pathname.startsWith(`${href}/`)
              return (
                <Link
                  key={href}
                  href={href}
                  className={clsx(
                    'flex items-center gap-2.5 px-4 py-2 mx-2 rounded-lg text-sm transition-colors',
                    active
                      ? 'bg-violet-100 text-violet-950 font-medium shadow-sm'
                      : 'text-neutral-600 hover:bg-violet-50/80 hover:text-violet-950'
                  )}
                >
                  <span
                    className={clsx(
                      'w-5 h-5 rounded-md flex items-center justify-center shrink-0 shadow-sm',
                      color
                    )}
                  >
                    <Icon className="w-3 h-3 text-white" />
                  </span>
                  <span className="flex-1">{label}</span>
                  {active && <ChevronRight className="w-3 h-3 text-violet-400 shrink-0" />}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      <div className="px-4 py-3 border-t border-neutral-100 mt-auto">
        <p className="text-[11px] text-neutral-500 leading-relaxed">
          Marketplace tools · same palette as storefront
        </p>
      </div>
    </aside>
  )
}
