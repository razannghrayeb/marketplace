import type { Metadata } from 'next'
import { Suspense } from 'react'
import { Playfair_Display, Inter } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'
import { Navbar } from '@/components/layout/Navbar'
import { MainContent } from '@/components/layout/MainContent'
import { Footer } from '@/components/layout/Footer'

/** Editorial serif — hero & section titles only (loaded via `--font-display`). */
const display = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
  adjustFontFallback: true,
  weight: ['400', '500', '600', '700', '800'],
})

/** UI sans — body, nav, buttons, product lines (loaded via `--font-sans`). */
const sans = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
  adjustFontFallback: true,
  weight: ['400', '500', '600', '700', '800'],
})

export const metadata: Metadata = {
  title: 'Bolden — Where style meets confidence.',
  description: 'Where style meets confidence. Discover fashion with AI-powered search, virtual try-on, and personalized recommendations.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable}`}>
      <body className="font-sans min-h-screen flex flex-col tz-pink-bg antialiased text-[#2B2521]">
        <Providers>
          <Suspense fallback={<div className="h-[72px]" aria-hidden />}>
            <Navbar />
          </Suspense>
          <MainContent>{children}</MainContent>
          <Footer />
        </Providers>
      </body>
    </html>
  )
}
