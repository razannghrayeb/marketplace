'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import clsx from 'clsx'
import {
  LayoutDashboard,
  Package,
  Search,
  ImageIcon,
  GitCompare,
  Activity,
  Shield,
  Wrench,
  Shirt,
} from 'lucide-react'

const nav = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/products', label: 'Products', icon: Package },
  { href: '/search', label: 'Text search', icon: Search },
  { href: '/visual', label: 'Image & shop look', icon: ImageIcon },
  { href: '/wardrobe', label: 'Complete look', icon: Shirt },
  { href: '/compare', label: 'Compare', icon: GitCompare },
  { href: '/tools', label: 'Quality & pricing', icon: Wrench },
  { href: '/admin', label: 'Admin & jobs', icon: Shield },
]

export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="w-64 shrink-0 border-r border-neutral-200 bg-white flex flex-col h-full">
      <div className="p-5 border-b border-neutral-100">
        <Link href="/" className="block">
          <span className="text-xs font-semibold uppercase tracking-widest text-violet-600">
            Fashion API
          </span>
          <h1 className="font-display font-bold text-lg text-neutral-900 leading-tight">Business</h1>
          <p className="text-xs text-neutral-500 mt-0.5">mydesign dashboard</p>
        </Link>
      </div>
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={clsx(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors',
                active
                  ? 'bg-violet-100 text-violet-900'
                  : 'text-neutral-600 hover:bg-violet-50 hover:text-violet-900'
              )}
            >
              <Icon className="w-4 h-4 shrink-0 opacity-80" />
              {label}
            </Link>
          )
        })}
      </nav>
      <div className="p-3 border-t border-neutral-100 text-[10px] text-neutral-400 flex items-center gap-2">
        <Activity className="w-3 h-3" />
        <span>Set NEXT_PUBLIC_API_BASE_URL</span>
      </div>
    </aside>
  )
}
