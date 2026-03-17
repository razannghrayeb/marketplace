'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Store, Package,
  TrendingUp, Clock, ChevronRight,
} from 'lucide-react'
import clsx from 'clsx'

const NAV = [
  {
    section: 'Monitor',
    items: [
      { label: 'Overview',  href: '/',           icon: LayoutDashboard, color: 'bg-teal-500' },
      { label: 'Vendors',   href: '/vendors',     icon: Store,           color: 'bg-blue-500',   badge: null },
      { label: 'Products',  href: '/products',    icon: Package,         color: 'bg-purple-500' },
    ],
  },
  {
    section: 'Analytics',
    items: [
      { label: 'Prices',    href: '/prices',      icon: TrendingUp,      color: 'bg-green-500' },
      { label: 'Freshness', href: '/freshness',   icon: Clock,           color: 'bg-slate-400' },
    ],
  },
]

export function Sidebar() {
  const path = usePathname()

  return (
    <aside className="w-[220px] min-w-[220px] bg-white border-r border-gray-200 flex flex-col overflow-y-auto shrink-0">
      {/* Logo */}
      <div className="px-4 py-5 border-b border-gray-100">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-slate-900 flex items-center justify-center">
            <span className="text-white text-xs font-bold">DA</span>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900 leading-none">Dashboard Admin</p>
            <p className="text-[10px] text-gray-400 mt-0.5">Internal - v2.4</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-3">
        {NAV.map(({ section, items }) => (
          <div key={section} className="mb-4">
            <p className="px-4 py-1 text-[10px] font-semibold text-gray-400 uppercase tracking-widest">
              {section}
            </p>
            {items.map(({ label, href, icon: Icon, color, badge }) => {
              const active = href === '/' ? path === '/' : path.startsWith(href)
              return (
                <Link
                  key={href}
                  href={href}
                  className={clsx(
                    'flex items-center gap-2.5 px-4 py-2 mx-2 rounded-lg text-sm transition-colors',
                    active
                      ? 'bg-gray-100 text-gray-900 font-medium'
                      : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
                  )}
                >
                  <span className={clsx('w-5 h-5 rounded flex items-center justify-center shrink-0', color)}>
                    <Icon className="w-3 h-3 text-white" />
                  </span>
                  <span className="flex-1">{label}</span>
                  {badge && (
                    <span className="text-[10px] bg-red-50 text-red-600 font-semibold px-1.5 py-0.5 rounded-full">
                      {badge}
                    </span>
                  )}
                  {active && <ChevronRight className="w-3 h-3 text-gray-400" />}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-gray-100">
        <p className="text-[11px] text-gray-400">Supabase - Read-only access</p>
      </div>
    </aside>
  )
}

