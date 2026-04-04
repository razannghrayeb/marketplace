import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Sidebar } from '@/components/Sidebar'

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' })

export const metadata: Metadata = {
  title: 'Business dashboard — Fashion Aggregator API',
  description: 'Operational UI for products, search, compare, and admin APIs',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen flex">
        <Sidebar />
        <main className="flex-1 overflow-y-auto min-h-screen mesh-bg">{children}</main>
      </body>
    </html>
  )
}
