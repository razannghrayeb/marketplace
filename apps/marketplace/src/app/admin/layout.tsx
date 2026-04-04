'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/auth'
import { AdminSidebar } from '@/components/admin/AdminSidebar'
import { AdminBasePathProvider } from '@/components/admin/AdminBasePathContext'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const user = useAuthStore((s) => s.user)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated())
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    const finish = () => setHydrated(true)
    if (useAuthStore.persist.hasHydrated()) finish()
    else {
      const unsub = useAuthStore.persist.onFinishHydration(finish)
      return unsub
    }
  }, [])

  useEffect(() => {
    if (!hydrated) return
    if (!isAuthenticated) {
      router.replace('/login')
      return
    }
    if (!user?.is_admin) router.replace('/')
  }, [hydrated, isAuthenticated, user?.is_admin, router])

  if (!hydrated) {
    return (
      <div className="max-w-lg mx-auto px-4 py-20 text-center text-neutral-600 text-sm">Loading…</div>
    )
  }

  if (!isAuthenticated || !user?.is_admin) {
    return (
      <div className="max-w-lg mx-auto px-4 py-20 text-center text-neutral-600 text-sm">
        Redirecting…
      </div>
    )
  }

  return (
    <AdminBasePathProvider value="/admin">
      <div className="flex max-w-[1600px] mx-auto px-2 sm:px-4 mesh-bg min-h-[calc(100vh-4rem)]">
        <AdminSidebar brandLabel="Admin" />
        <div className="flex-1 min-w-0 py-8 px-4">{children}</div>
      </div>
    </AdminBasePathProvider>
  )
}
