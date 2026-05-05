'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import clsx from 'clsx'
import { Menu } from 'lucide-react'
import { AdminSidebar } from '@/components/admin/AdminSidebar'

type Brand = 'Admin' | 'Business'

export function AdminDashboardShell({ brandLabel, children }: { brandLabel: Brand; children: ReactNode }) {
  const pathname = usePathname()
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    setDrawerOpen(false)
  }, [pathname])

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const onChange = () => {
      if (mq.matches) setDrawerOpen(false)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    if (!drawerOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [drawerOpen])

  return (
    <div className="flex h-[calc(100vh-72px)] w-full max-w-[1920px] mx-auto flex-col overflow-hidden admin-mesh-bg px-0 sm:px-2 md:px-4">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[#0a0a0a]/10 bg-[#fffcf9]/95 px-3 py-2.5 backdrop-blur-sm md:hidden">
        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-[#0a0a0a] ring-1 ring-[#0a0a0a]/12 hover:bg-[#f1e8e2] transition-colors"
          aria-expanded={drawerOpen}
          aria-controls="admin-dashboard-nav"
          onClick={() => setDrawerOpen(true)}
        >
          <Menu className="h-5 w-5" strokeWidth={2} />
          <span className="sr-only">Open navigation</span>
        </button>
        <span className="text-sm font-semibold tracking-tight tz-burgundy">{brandLabel}</span>
        <span className="w-10" aria-hidden />
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        {drawerOpen ? (
          <button
            type="button"
            className="absolute inset-0 z-40 bg-[#0a0a0a]/45 backdrop-blur-[2px] md:hidden"
            aria-label="Close navigation"
            onClick={() => setDrawerOpen(false)}
          />
        ) : null}

        <div
          id="admin-dashboard-nav"
          className={clsx(
            'absolute left-0 top-0 z-50 h-full shrink-0 transition-transform duration-200 ease-out',
            'md:relative md:z-auto md:translate-x-0',
            drawerOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
          )}
        >
          <AdminSidebar brandLabel={brandLabel} onDismiss={() => setDrawerOpen(false)} />
        </div>

        <div className="relative z-10 min-h-0 min-w-0 flex-1 overflow-y-auto py-4 px-3 sm:py-6 sm:px-6 lg:px-8">
          {children}
        </div>
      </div>
    </div>
  )
}
