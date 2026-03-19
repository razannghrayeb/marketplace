'use client'

import Link from 'next/link'
import { Sparkles } from 'lucide-react'

export function Footer() {
  return (
    <footer className="bg-charcoal-800 text-cream-200 mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          <div>
            <Link href="/" className="flex items-center gap-2 font-display text-lg font-semibold text-white">
              <Sparkles className="w-5 h-5 text-gold-400" />
              StyleAI
            </Link>
            <p className="mt-3 text-sm text-charcoal-300">
              Fashion discovery powered by AI. Search, try on, and style with intelligence.
            </p>
          </div>
          <div>
            <h4 className="font-medium text-white mb-3">Shop</h4>
            <ul className="space-y-2 text-sm">
              <li><Link href="/products" className="hover:text-gold-400 transition-colors">All Products</Link></li>
              <li><Link href="/search" className="hover:text-gold-400 transition-colors">Search</Link></li>
              <li><Link href="/products?category=dresses" className="hover:text-gold-400 transition-colors">Dresses</Link></li>
              <li><Link href="/products?category=shoes" className="hover:text-gold-400 transition-colors">Shoes</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="font-medium text-white mb-3">Features</h4>
            <ul className="space-y-2 text-sm">
              <li><Link href="/wardrobe" className="hover:text-gold-400 transition-colors">My Wardrobe</Link></li>
              <li><Link href="/try-on" className="hover:text-gold-400 transition-colors">Virtual Try-On</Link></li>
              <li><Link href="/compare" className="hover:text-gold-400 transition-colors">Compare</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="font-medium text-white mb-3">Company</h4>
            <ul className="space-y-2 text-sm">
              <li><Link href="/about" className="hover:text-gold-400 transition-colors">About</Link></li>
              <li><Link href="/contact" className="hover:text-gold-400 transition-colors">Contact</Link></li>
            </ul>
          </div>
        </div>
        <div className="mt-12 pt-8 border-t border-charcoal-600 text-center text-sm text-charcoal-400">
          © {new Date().getFullYear()} StyleAI. Fashion meets AI.
        </div>
      </div>
    </footer>
  )
}
