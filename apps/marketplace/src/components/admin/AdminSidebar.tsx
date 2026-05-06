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
  Store,
  Package,
  TrendingUp,
  Clock,
  Bell,
  TrendingDown,
  X,
} from 'lucide-react'
import { useAdminBasePath } from '@/components/admin/AdminBasePathContext'
import { BoldenLogoMark, boldenWordmarkClassName } from '@/components/brand/BoldenLogoMark'

type NavItem = {
  segment: '' | 'moderation' | 'canonicals' | 'jobs' | 'reco' | 'system' | 'console' | 'alerts'
  label: string
  icon: LucideIcon
  exact?: boolean
}

type CatalogLinkItem = {
  segment: 'catalog' | 'catalog/vendors' | 'catalog/products' | 'catalog/prices' | 'catalog/freshness'
  label: string
  icon: LucideIcon
}

const CATALOG_LINKS: { section: string; items: CatalogLinkItem[] } = {
  section: 'Catalog database',
  items: [
    { segment: 'catalog', label: 'Scraper overview', icon: LayoutDashboard },
    { segment: 'catalog/vendors', label: 'Vendors', icon: Store },
    { segment: 'catalog/products', label: 'Products', icon: Package },
    { segment: 'catalog/prices', label: 'Prices', icon: TrendingUp },
    { segment: 'catalog/freshness', label: 'Freshness', icon: Clock },
  ],
}

const ADMIN_SECTIONS: { section: string; items: NavItem[] }[] = [
  {
    section: 'Operations',
    items: [
      { segment: '', label: 'Overview', icon: LayoutDashboard, exact: true },
      { segment: 'moderation', label: 'Moderation', icon: Shield },
      { segment: 'canonicals', label: 'Canonicals', icon: GitMerge },
      { segment: 'jobs', label: 'Jobs', icon: Timer },
    ],
  },
  {
    section: 'Intelligence & system',
    items: [
      { segment: 'reco', label: 'Reco labeling', icon: Brain },
      { segment: 'system', label: 'System', icon: Activity },
      { segment: 'console', label: 'API console', icon: Terminal },
    ],
  },
]

const BUSINESS_SECTIONS: { section: string; items: NavItem[] }[] = [
  {
    section: 'Dead Stock Risk',
    items: [
      { segment: '', label: 'DSR Overview', icon: TrendingDown, exact: true },
      { segment: 'alerts', label: 'Alerts', icon: Bell },
    ],
  },
  {
    section: 'Operations',
    items: [
      { segment: 'moderation', label: 'Moderation', icon: Shield },
      { segment: 'jobs', label: 'Jobs', icon: Timer },
      { segment: 'console', label: 'API console', icon: Terminal },
    ],
  },
]

const ICON_BG_IDLE = 'bg-[#f1e8e2] text-[#0a0a0a] ring-1 ring-[#0a0a0a]/12'
const ICON_BG_ACTIVE = 'bg-[#0a0a0a] text-[#ffffff] ring-1 ring-[#0a0a0a]'

export function AdminSidebar({
  brandLabel = 'Admin',
  onDismiss,
}: {
  brandLabel?: string
  /** Collapse mobile drawer (nav tap or close button); backdrop uses shell */
  onDismiss?: () => void
}) {
  const pathname = usePathname()
  const base = useAdminBasePath()
  const isBusiness = base === '/dashboard'
  const SECTIONS = isBusiness ? BUSINESS_SECTIONS : ADMIN_SECTIONS
  const adminCatalogOnly = !isBusiness && brandLabel === 'Admin'

  return (
    <aside
      className={clsx(
        'flex h-full w-[min(88vw,260px)] shrink-0 flex-col overflow-y-auto border-r border-[#0a0a0a]/10 bg-[#ffffff]/98 shadow-[4px_0_32px_rgba(10,10,10,0.08)] backdrop-blur-sm md:w-[220px] md:min-w-[220px] md:max-w-[220px] md:shadow-none',
      )}
    >
      <div className="border-b border-[#0a0a0a]/10 px-4 py-5">
        <div className="flex items-center gap-2.5">
          <BoldenLogoMark tone="default" className="h-9 w-9 shrink-0 ring-1 ring-[#0a0a0a]/10" />
          <div className="min-w-0 flex-1">
            <p className={clsx('text-sm tz-burgundy', boldenWordmarkClassName)}>Bolden</p>
            <p className="mt-1 text-[10px] font-medium text-[#0a0a0a]/65">
              {brandLabel === 'Business' ? 'Business · internal' : 'Admin · internal'}
            </p>
          </div>
          {onDismiss ? (
            <button
              type="button"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#0a0a0a]/70 ring-1 ring-[#0a0a0a]/12 hover:bg-[#f1e8e2] md:hidden"
              aria-label="Close navigation"
              onClick={onDismiss}
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          ) : null}
        </div>
      </div>

      <nav className="flex-1 py-3">
        {!adminCatalogOnly &&
          SECTIONS.map(({ section, items }) => (
            <div key={section} className="mb-4">
              <p className="px-4 py-1 text-[10px] font-semibold text-[#0a0a0a]/55 uppercase tracking-widest">
                {section}
              </p>
              {items.map(({ segment, label, icon: Icon, exact }) => {
                const href = segment === '' ? base : `${base}/${segment}`
                const active = exact
                  ? pathname === href || pathname === `${href}/`
                  : pathname === href || pathname.startsWith(`${href}/`)
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => onDismiss?.()}
                    className={clsx(
                      'flex items-center gap-2.5 px-4 py-2 mx-2 rounded-lg text-sm transition-colors',
                      active
                        ? 'bg-[#f3e9e2] tz-burgundy font-semibold shadow-sm ring-1 ring-[#0a0a0a]/10'
                        : 'text-[#0a0a0a]/75 hover:bg-[#f1e8e2]/80 hover:text-[#0a0a0a]'
                    )}
                  >
                    <span
                      className={clsx(
                        'w-5 h-5 rounded-md flex items-center justify-center shrink-0',
                        active ? ICON_BG_ACTIVE : ICON_BG_IDLE
                      )}
                    >
                      <Icon className="w-3 h-3" />
                    </span>
                    <span className="flex-1">{label}</span>
                    {active && <ChevronRight className="w-3 h-3 text-[#0a0a0a]/60 shrink-0" />}
                  </Link>
                )
              })}
            </div>
          ))}
        {!isBusiness && (
          <div className={clsx('mb-4', adminCatalogOnly && 'pt-1')}>
            <p className="px-4 py-1 text-[10px] font-semibold text-[#0a0a0a]/55 uppercase tracking-widest">
              {CATALOG_LINKS.section}
            </p>
            {CATALOG_LINKS.items.map(({ segment, label, icon: Icon }) => {
              const href = `${base}/${segment}`
              const active =
                segment === 'catalog'
                  ? pathname === href || pathname === `${href}/`
                  : pathname === href || pathname.startsWith(`${href}/`)
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={() => onDismiss?.()}
                  className={clsx(
                    'flex items-center gap-2.5 px-4 py-2 mx-2 rounded-lg text-sm transition-colors',
                    active
                      ? 'bg-[#f3e9e2] tz-burgundy font-semibold shadow-sm ring-1 ring-[#0a0a0a]/10'
                      : 'text-[#0a0a0a]/75 hover:bg-[#f1e8e2]/80 hover:text-[#0a0a0a]'
                  )}
                >
                  <span
                    className={clsx(
                      'w-5 h-5 rounded-md flex items-center justify-center shrink-0',
                      active ? ICON_BG_ACTIVE : ICON_BG_IDLE
                    )}
                  >
                    <Icon className="w-3 h-3" />
                  </span>
                  <span className="flex-1">{label}</span>
                  {active && <ChevronRight className="w-3 h-3 text-[#0a0a0a]/60 shrink-0" />}
                </Link>
              )
            })}
          </div>
        )}
      </nav>

      <div className="px-4 py-3 border-t border-[#0a0a0a]/10 mt-auto">
        <p className="text-[11px] text-[#0a0a0a]/65 leading-relaxed">
          {brandLabel === 'Business'
            ? 'Business dashboard — not shown to shoppers'
            : 'Admin only — account must have admin role; not linked for guests'}
        </p>
      </div>
    </aside>
  )
}
