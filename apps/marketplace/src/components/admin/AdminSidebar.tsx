'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import clsx from 'clsx'
import { LayoutDashboard, Shield, Terminal, Package, GitMerge, Timer, Brain, Activity } from 'lucide-react'

const links = [
  { href: '/admin', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/admin/moderation', label: 'Moderation', icon: Shield },
  { href: '/admin/canonicals', label: 'Canonicals', icon: GitMerge },
  { href: '/admin/jobs', label: 'Jobs', icon: Timer },
  { href: '/admin/reco', label: 'Reco labeling', icon: Brain },
  { href: '/admin/system', label: 'System', icon: Activity },
  { href: '/admin/console', label: 'API console', icon: Terminal },
]

export function AdminSidebar() {
  const pathname = usePathname()

  return (
    <aside className="w-56 shrink-0 border-r border-neutral-200 bg-neutral-50/80 min-h-[calc(100vh-4rem)] py-6 px-3">
      <div className="flex items-center gap-2 px-3 mb-6 text-neutral-800 font-display font-semibold">
        <Package className="w-5 h-5" />
        Admin
      </div>
      <nav className="space-y-1">
        {links.map(({ href, label, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`)
          return (
            <Link
              key={href}
              href={href}
              className={clsx(
                'flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
                active ? 'bg-neutral-800 text-white' : 'text-neutral-700 hover:bg-neutral-100'
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
