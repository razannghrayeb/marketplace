'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Package, TrendingUp, Store, ArrowLeft } from 'lucide-react'
import { useAuthStore } from '@/store/auth'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()
  const user = useAuthStore((s) => s.user)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace('/login')
      return
    }
    if (user?.user_type === 'customer') {
      router.replace('/')
    }
  }, [isAuthenticated, user?.user_type, router])

  const links = [
    { href: '/dashboard', label: 'Overview', icon: Store },
    { href: '/dashboard/products', label: 'Products', icon: Package },
    { href: '/dashboard/analytics', label: 'Analytics', icon: TrendingUp },
  ]

  if (!user || user.user_type === 'customer') {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="animate-pulse text-neutral-500">Redirecting...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <aside className="fixed left-0 top-0 z-40 h-screen w-64 border-r border-neutral-200 bg-white">
        <div className="flex h-16 items-center gap-2 border-b border-neutral-200 px-6">
          <Store className="w-6 h-6 text-neutral-800" />
          <span className="font-display font-semibold text-neutral-800">Business</span>
        </div>
        <nav className="p-4 space-y-1">
          {links.map((link) => {
            const active = link.href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(link.href)
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors ${
                  active ? 'bg-neutral-100 text-neutral-800' : 'text-neutral-600 hover:bg-neutral-100'
                }`}
              >
                <link.icon className="w-5 h-5" />
                {link.label}
              </Link>
            )
          })}
        </nav>
        <div className="absolute bottom-4 left-4 right-4">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-xl px-4 py-3 text-sm text-neutral-600 hover:bg-neutral-100"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to marketplace
          </Link>
        </div>
      </aside>
      <main className="pl-64">
        {children}
      </main>
    </div>
  )
}
