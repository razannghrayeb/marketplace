'use client'

import Link from 'next/link'
import { Sparkles } from 'lucide-react'

export function Footer() {
  return (
    <footer className="mt-auto border-t border-neutral-300 bg-gradient-to-b from-neutral-200 to-neutral-300 text-neutral-600">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 lg:py-20">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-10 lg:gap-12">
          <div className="col-span-2 md:col-span-1">
            <Link
              href="/"
              className="inline-flex items-center gap-2.5 font-display text-lg font-bold text-neutral-900 tracking-tight"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-500 shadow-md shadow-violet-500/20">
                <Sparkles className="w-4 h-4 text-white" />
              </span>
              StyleAI
            </Link>
            <p className="mt-4 text-sm text-neutral-500 leading-relaxed max-w-xs">
              Fashion discovery powered by AI — search, compare, wardrobe, and try-on in one colorful experience.
            </p>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-violet-700 mb-4">Shop</h4>
            <ul className="space-y-2.5 text-sm">
              <li><Link href="/products" className="hover:text-violet-700 transition-colors">All products</Link></li>
              <li><Link href="/search" className="hover:text-fuchsia-600 transition-colors">Discover</Link></li>
              <li><Link href="/products?category=dresses" className="hover:text-rose-600 transition-colors">Dresses</Link></li>
              <li><Link href="/products?category=shoes" className="hover:text-sky-600 transition-colors">Shoes</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-violet-700 mb-4">Product</h4>
            <ul className="space-y-2.5 text-sm">
              <li><Link href="/wardrobe" className="hover:text-emerald-600 transition-colors">Wardrobe</Link></li>
              <li><Link href="/try-on" className="hover:text-fuchsia-600 transition-colors">Virtual try-on</Link></li>
              <li><Link href="/compare" className="hover:text-amber-600 transition-colors">Compare</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-violet-700 mb-4">Company</h4>
            <ul className="space-y-2.5 text-sm">
              <li><Link href="/about" className="hover:text-violet-700 transition-colors">About</Link></li>
              <li><Link href="/contact" className="hover:text-violet-700 transition-colors">Contact</Link></li>
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-neutral-300/80 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-neutral-500">
          <p>&copy; {new Date().getFullYear()} StyleAI. All rights reserved.</p>
          <p className="text-gradient-accent font-medium">Fashion meets intelligence.</p>
        </div>
      </div>
    </footer>
  )
}
