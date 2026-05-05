'use client'

import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import clsx from 'clsx'

/**
 * Hero pages keep content flush with the top so the fixed navbar overlays imagery.
 * Other routes get padding so content clears the bar when there is no full-bleed hero.
 */
export function MainContent({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const normalized = pathname.replace(/\/$/, '') || '/'
  const heroUnderNav =
    normalized === '/' ||
    normalized === '/products' ||
    normalized === '/try-on' ||
    normalized === '/sales'

  return <main className={clsx('flex-1', !heroUnderNav && 'pt-[72px]')}>{children}</main>
}
