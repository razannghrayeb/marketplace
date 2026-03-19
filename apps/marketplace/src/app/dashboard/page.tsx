'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Package, TrendingUp, ArrowRight } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/store/auth'
import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'

type FacetData = { categories?: Array<{ value: string; count: number }>; brands?: Array<{ value: string; count: number }> }

export default function DashboardPage() {
  const router = useRouter()
  const user = useAuthStore((s) => s.user)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  const { data: facetsRes } = useQuery({
    queryKey: ['dashboard-facets'],
    queryFn: () => api.get<FacetData>(endpoints.products.facets),
  })

  const facets = (facetsRes?.data ?? {}) as FacetData
  const totalProducts = facets.categories?.reduce((acc, c) => acc + c.count, 0) ?? 0
  const categoryCount = facets.categories?.length ?? 0
  const brandCount = facets.brands?.length ?? 0

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace('/login')
      return
    }
    if (user?.user_type === 'customer') {
      router.replace('/')
    }
  }, [isAuthenticated, user?.user_type, router])

  if (!user || user.user_type === 'customer') {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="animate-pulse text-charcoal-500">Redirecting...</div>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h1 className="font-display text-3xl font-bold text-charcoal-800 mb-2">
          Business Dashboard
        </h1>
        <p className="text-charcoal-500 mb-2">
          Welcome back, {user.email}. Manage your products and sales.
        </p>
        <p className="text-sm text-charcoal-400 mb-8">
          You can always enter the dashboard from the <strong>Dashboard</strong> button in the top navigation bar.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-12">
          {[
            { icon: Package, title: 'Products', desc: 'Manage your catalog', href: '/dashboard/products', color: 'bg-wine-100 text-wine-700' },
            { icon: TrendingUp, title: 'Analytics', desc: 'Catalog insights & performance', href: '/dashboard/analytics', color: 'bg-gold-100 text-gold-800' },
          ].map((item) => (
            <Link
              key={item.title}
              href={item.href}
              className="block p-6 rounded-2xl border border-cream-300 bg-white hover:shadow-elevated hover:border-cream-400 transition-all"
            >
              <div className={`w-12 h-12 rounded-xl ${item.color} flex items-center justify-center mb-4`}>
                <item.icon className="w-6 h-6" />
              </div>
              <h3 className="font-display font-semibold text-charcoal-800">{item.title}</h3>
              <p className="text-sm text-charcoal-500 mt-1">{item.desc}</p>
            </Link>
          ))}
        </div>

        <div className="rounded-2xl border border-cream-300 bg-white p-8">
          <h2 className="font-display text-xl font-semibold text-charcoal-800 mb-6">
            Marketplace overview
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-6 mb-8">
            <div className="p-4 rounded-xl bg-cream-100">
              <p className="text-sm text-charcoal-500">Products</p>
              <p className="text-2xl font-bold text-charcoal-800">{totalProducts}</p>
            </div>
            <div className="p-4 rounded-xl bg-cream-100">
              <p className="text-sm text-charcoal-500">Categories</p>
              <p className="text-2xl font-bold text-charcoal-800">{categoryCount}</p>
            </div>
            <div className="p-4 rounded-xl bg-cream-100">
              <p className="text-sm text-charcoal-500">Brands</p>
              <p className="text-2xl font-bold text-charcoal-800">{brandCount}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-4">
            <Link href="/dashboard/products" className="btn-primary inline-flex items-center gap-2">
              Manage products <ArrowRight className="w-4 h-4" />
            </Link>
            <Link href="/dashboard/analytics" className="btn-secondary inline-flex items-center gap-2">
              View analytics
            </Link>
            <Link href="/" className="text-charcoal-500 hover:text-charcoal-700 text-sm">
              Back to marketplace
            </Link>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
