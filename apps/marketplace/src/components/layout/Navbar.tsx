'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion } from 'framer-motion'
import { Search, Heart, User, Sparkles, Store } from 'lucide-react'
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
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="sticky top-0 z-50 bg-cream-100/95 backdrop-blur-md border-b border-cream-300"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 lg:h-18">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 group">
            <motion.span
              whileHover={{ scale: 1.05 }}
              className="w-9 h-9 rounded-lg bg-wine-700 flex items-center justify-center"
            >
              <Sparkles className="w-4 h-4 text-gold-200" />
            </motion.span>
            <span className="font-display text-xl font-semibold text-charcoal-800 group-hover:text-wine-700 transition-colors">
              StyleAI
            </span>
          </Link>

          {/* Nav links */}
          <nav className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => {
              const active = pathname === link.href || (link.href !== '/' && pathname.startsWith(link.href))
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={clsx(
                    'px-4 py-2 rounded-full text-sm font-medium transition-all duration-200',
                    active
                      ? 'bg-wine-100 text-wine-700'
                      : 'text-charcoal-600 hover:bg-cream-200 hover:text-charcoal-800'
                  )}
                >
                  {link.label}
                </Link>
              )
            })}
            {mounted && user?.user_type === 'business' && (
              <Link
                href="/dashboard"
                className={clsx(
                  'flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all duration-200',
                  pathname.startsWith('/dashboard')
                    ? 'bg-wine-700 text-white'
                    : 'bg-wine-100 text-wine-700 hover:bg-wine-200'
                )}
              >
                <Store className="w-4 h-4" />
                Dashboard
              </Link>
            )}
          </nav>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <Link
              href="/search"
              className="p-2 rounded-full text-charcoal-600 hover:bg-cream-200 hover:text-wine-700 transition-colors"
              aria-label="Search"
            >
              <Search className="w-5 h-5" />
            </Link>
            {mounted && isAuthenticated() && (
              <>
                <Link
                  href="/favorites"
                  className="p-2 rounded-full text-charcoal-600 hover:bg-cream-200 hover:text-wine-700 transition-colors"
                  aria-label="Favorites"
                >
                  <Heart className="w-5 h-5" />
                </Link>
              </>
            )}
            {mounted && isAuthenticated() ? (
              <div className="relative group">
                <button className="p-2 rounded-full text-charcoal-600 hover:bg-cream-200 transition-colors">
                  <User className="w-5 h-5" />
                </button>
                <div className="absolute right-0 mt-1 w-40 py-2 bg-white rounded-xl shadow-elevated border border-cream-300 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all">
                  {user?.user_type === 'business' && (
                    <Link href="/dashboard" className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-cream-100">
                      <Store className="w-4 h-4" />
                      Dashboard
                    </Link>
                  )}
                  <Link href="/wardrobe" className="block px-4 py-2 text-sm hover:bg-cream-100">
                    My Wardrobe
                  </Link>
                  <Link href="/try-on" className="block px-4 py-2 text-sm hover:bg-cream-100">
                    Virtual Try-On
                  </Link>
                  <button
                    onClick={logout}
                    className="w-full text-left px-4 py-2 text-sm text-wine-600 hover:bg-cream-100"
                  >
                    Sign out
                  </button>
                </div>
              </div>
            ) : (
              <Link href="/login" className="btn-primary text-sm py-2 px-4">
                Sign in
              </Link>
            )}
          </div>
        </div>
      </div>
    </motion.header>
  )
}
