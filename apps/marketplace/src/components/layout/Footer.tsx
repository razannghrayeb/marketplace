'use client'

import Link from 'next/link'
import clsx from 'clsx'
import { BoldenLogoMark, boldenWordmarkClassName } from '@/components/brand/BoldenLogoMark'

export function Footer() {
  return (
    <footer className="mt-auto px-3 sm:px-5 lg:px-8 pb-6">
      <div className="tz-sheet px-6 sm:px-10 py-12 lg:py-14">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-10 lg:gap-12">
          <div className="col-span-2 md:col-span-1">
            <Link
              href="/"
              className={clsx(
                'inline-flex items-center gap-2.5 text-lg text-ink rounded-lg',
                boldenWordmarkClassName,
                'outline-none [-webkit-tap-highlight-color:transparent]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2B2521]/25 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent',
              )}
            >
              <BoldenLogoMark tone="default" compact />
              Bolden
            </Link>
            <p className="mt-2 text-small font-medium text-muted leading-snug max-w-xs font-sans">
              Where style meets confidence.
            </p>
            <p className="mt-4 text-body text-muted/90 leading-relaxed max-w-xs font-sans">
              Fashion discovery powered by AI: search, compare, wardrobe, and try-on in one seamless experience.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link
                href="/#about"
                className="px-3 py-1.5 rounded-full text-small font-semibold tracking-[0.04em] text-ink bg-page ring-1 ring-ink/12 hover:bg-[#ebe6df] transition-colors font-sans"
              >
                About us
              </Link>
            </div>
          </div>

          <div>
            <h4 className="tz-eyebrow mb-4">Shop</h4>
            <ul className="space-y-2.5 text-body font-sans">
              <li>
                <Link href="/products" className="text-muted hover:text-ink transition-colors">
                  All products
                </Link>
              </li>
              <li>
                <Link href="/search" className="text-muted hover:text-ink transition-colors">
                  Discover
                </Link>
              </li>
              <li>
                <Link href="/sales" className="text-muted hover:text-ink transition-colors">
                  Sale
                </Link>
              </li>
              <li>
                <Link href="/favorites" className="text-muted hover:text-ink transition-colors">
                  Favorites
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="tz-eyebrow mb-4">Tools</h4>
            <ul className="space-y-2.5 text-body font-sans">
              <li>
                <Link href="/search?mode=shop" className="text-muted hover:text-ink transition-colors">
                  Shop the look
                </Link>
              </li>
              <li>
                <Link href="/wardrobe" className="text-muted hover:text-ink transition-colors">
                  Wardrobe
                </Link>
              </li>
              <li>
                <Link href="/try-on" className="text-muted hover:text-ink transition-colors">
                  Virtual try-on
                </Link>
              </li>
              <li>
                <Link href="/compare" className="text-muted hover:text-ink transition-colors">
                  Compare
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-black/10 flex flex-col sm:flex-row items-center justify-between gap-4 text-small font-sans text-muted">
          <p>&copy; {new Date().getFullYear()} Bolden. All rights reserved.</p>
          <p className="font-semibold text-ink">Where style meets confidence.</p>
        </div>
      </div>
    </footer>
  )
}
