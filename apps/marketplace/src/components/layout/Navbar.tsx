'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion } from 'framer-motion'
import { Search, Heart, User, Sparkles, Store, ShoppingCart, Shield } from 'lucide-react'
import clsx from 'clsx'
import { useAuthStore } from '@/store/auth'

const navLinks = [
  { href: '/', label: 'Home' },
  { href: '/search', label: 'Discover' },
  { href: '/products', label: 'Shop' },
  { href: '/compare', label: 'Compare' },
  { href: '/wardrobe', label: 'Wardrobe' },
  { href: '/try-on', label: 'Try On' },
]

export function Navbar() {
  const [mounted, setMounted] = useState(false)
  const pathname = usePathname()
  const { isAuthenticated, logout, user } = useAuthStore()

  useEffect(() => setMounted(true), [])

  return (
    <motion.header
      initial={{ y: -12, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="sticky top-0 z-50 border-b border-neutral-200/70 bg-white/90 backdrop-blur-xl"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-3 h-16">
          <Link href="/" className="flex items-center gap-2.5 shrink-0 group">
            <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-600 via-fuchsia-500 to-rose-500 flex items-center justify-center shadow-md shadow-violet-500/25 group-hover:shadow-lg group-hover:shadow-violet-500/30 transition-shadow">
              <Sparkles className="w-4 h-4 text-white" />
            </span>
            <span className="font-display text-lg font-bold text-neutral-900 tracking-tight">
              StyleAI
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-0.5 flex-1 justify-center min-w-0 max-w-2xl mx-4 overflow-x-auto scrollbar-none">
            {navLinks.map((link) => {
              const active =
                pathname === link.href || (link.href !== '/' && pathname.startsWith(link.href))
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={clsx(
                    'px-3.5 py-2 rounded-full text-sm font-medium transition-all duration-200 whitespace-nowrap',
                    active
                      ? 'bg-violet-100 text-violet-800 shadow-sm'
                      : 'text-neutral-600 hover:text-violet-700 hover:bg-violet-50/80'
                  )}
                >
                  {link.label}
                </Link>
              )
            })}
            {mounted && user?.is_admin && (
              <Link
                href="/admin"
                className={clsx(
                  'flex items-center gap-1.5 px-3.5 py-2 rounded-full text-sm font-medium transition-all',
                  pathname.startsWith('/admin')
                    ? 'bg-violet-600 text-white shadow-sm shadow-violet-500/25'
                    : 'text-neutral-600 hover:text-violet-700 hover:bg-violet-50/80'
                )}
              >
                <Shield className="w-3.5 h-3.5" />
                Admin
              </Link>
            )}
            {mounted && user?.user_type === 'business' && (
              <Link
                href="/dashboard"
                className={clsx(
                  'flex items-center gap-1.5 px-3.5 py-2 rounded-full text-sm font-medium transition-all',
                  pathname.startsWith('/dashboard')
                    ? 'bg-violet-100 text-violet-800 shadow-sm'
                    : 'text-neutral-600 hover:text-violet-700 hover:bg-violet-50/80'
                )}
              >
                <Store className="w-3.5 h-3.5" />
                Dashboard
              </Link>
            )}
          </nav>

          <div className="flex items-center gap-0.5 shrink-0">
            <Link
              href="/search"
              className="p-2 rounded-full text-neutral-500 hover:bg-violet-50 hover:text-violet-700 transition-colors"
              aria-label="Search"
            >
              <Search className="w-5 h-5" />
            </Link>
            {mounted && isAuthenticated() && (
              <>
                <Link
                  href="/cart"
                  className="p-2 rounded-full text-neutral-500 hover:bg-violet-50 hover:text-violet-700 transition-colors"
                  aria-label="Cart"
                >
                  <ShoppingCart className="w-5 h-5" />
                </Link>
                <Link
                  href="/favorites"
                  className="p-2 rounded-full text-neutral-500 hover:bg-rose-50 hover:text-rose-600 transition-colors"
                  aria-label="Favorites"
                >
                  <Heart className="w-5 h-5" />
                </Link>
              </>
            )}
            {mounted && isAuthenticated() ? (
              <div className="relative group">
                <button
                  type="button"
                  className="p-2 rounded-full text-neutral-500 hover:bg-violet-50 hover:text-violet-700 transition-colors"
                >
                  <User className="w-5 h-5" />
                </button>
                <div className="absolute right-0 mt-2 w-48 py-1.5 rounded-xl border border-neutral-200 bg-white shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200">
                  <Link href="/account" className="block px-4 py-2 text-sm text-neutral-700 hover:bg-violet-50/60">Account</Link>
                  <Link href="/cart" className="block px-4 py-2 text-sm text-neutral-700 hover:bg-violet-50/60">Cart</Link>
                  {user?.is_admin && (
                    <Link href="/admin" className="flex items-center gap-2 px-4 py-2 text-sm text-neutral-700 hover:bg-violet-50/60">
                      <Shield className="w-3.5 h-3.5" /> Admin
                    </Link>
                  )}
                  {user?.user_type === 'business' && (
                    <Link href="/dashboard" className="flex items-center gap-2 px-4 py-2 text-sm text-neutral-700 hover:bg-violet-50/60">
                      <Store className="w-3.5 h-3.5" /> Dashboard
                    </Link>
                  )}
                  <Link href="/wardrobe" className="block px-4 py-2 text-sm text-neutral-700 hover:bg-violet-50/60">My Wardrobe</Link>
                  <Link href="/try-on" className="block px-4 py-2 text-sm text-neutral-700 hover:bg-violet-50/60">Virtual Try-On</Link>
                  <div className="border-t border-neutral-100 my-1" />
                  <button
                    type="button"
                    onClick={logout}
                    className="w-full text-left px-4 py-2 text-sm text-rose-600 hover:bg-rose-50"
                  >
                    Sign out
                  </button>
                </div>
              </div>
            ) : (
              <Link href="/login" className="btn-primary text-sm py-2 px-4 ml-1">
                Sign in
              </Link>
            )}
          </div>
        </div>

        <nav
          className="md:hidden flex items-center gap-1 pb-3 -mx-4 px-4 overflow-x-auto scrollbar-none border-t border-neutral-100/80 pt-3"
          aria-label="Main"
        >
          {navLinks.map((link) => {
            const active =
              pathname === link.href || (link.href !== '/' && pathname.startsWith(link.href))
            return (
              <Link
                key={link.href}
                href={link.href}
                className={clsx(
                  'shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
                  active ? 'bg-violet-100 text-violet-800' : 'text-neutral-600 hover:bg-violet-50'
                )}
              >
                {link.label}
              </Link>
            )
          })}
        </nav>
      </div>
    </motion.header>
  )
}
