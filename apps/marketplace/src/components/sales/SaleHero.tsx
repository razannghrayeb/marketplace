'use client'

import Image from 'next/image'
import { motion } from 'framer-motion'
import { Sparkles } from 'lucide-react'
import { SaleCountdown } from '@/components/sales/SaleCountdown'

/**
 * Full-viewport hero under fixed nav (MainContent has no top pad on /sales) — image reads edge-to-edge like home.
 */
export function SaleHero() {
  return (
    <header className="relative min-h-[100svh] w-full bg-[#f9f8f6]">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="relative isolate min-h-[100svh] w-full overflow-hidden"
      >
        <Image
          src="/brand/sale-hero.jpg"
          alt="Sale campaign — curated styles"
          fill
          priority
          className="object-cover object-[68%_28%] sm:object-[72%_30%] lg:object-[74%_28%]"
          sizes="100vw"
        />

        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'linear-gradient(to right, rgb(249,248,246) 0%, rgba(249,248,246,0.93) 26%, rgba(249,248,246,0.48) 58%, transparent 82%)',
          }}
          aria-hidden
        />
        <div
          className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/[0.22] via-transparent to-transparent"
          aria-hidden
        />

        <div className="relative z-[1] flex min-h-[100svh] flex-col justify-center px-6 pb-10 pt-[5.25rem] sm:px-10 sm:pb-12 sm:pt-28 lg:max-w-[54%] lg:px-12 lg:pt-32 xl:px-14">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="mb-4 inline-flex items-center gap-2 sm:mb-5"
          >
            <Sparkles className="h-4 w-4 shrink-0 text-brand sm:h-[1.125rem] sm:w-[1.125rem]" aria-hidden />
            <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-brand sm:text-[12px]">Sale</span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.05 }}
            className="font-display text-[2.125rem] font-bold leading-[1.06] tracking-[-0.02em] text-[#1c1917] sm:text-[2.85rem] lg:text-[3.25rem] xl:text-[3.5rem]"
          >
            Big style.
            <span className="block sm:inline"> </span>
            <span className="block sm:inline">Small prices.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="mt-4 max-w-lg font-sans text-[15px] leading-relaxed text-[#3d3935] sm:mt-5 sm:text-[1.06rem]"
          >
            Up to <span className="font-semibold text-brand">85% off</span> on your favorite styles.{' '}
            <span className="text-[#5c534c]">Limited time only.</span>
          </motion.p>

          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.18 }}>
            <SaleCountdown />
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
          className="absolute bottom-6 right-4 z-[2] flex h-[6.75rem] w-[6.75rem] flex-col items-center justify-center rounded-full bg-white/95 text-center shadow-[0_22px_50px_-20px_rgba(43,37,33,0.42)] backdrop-blur-sm ring-[1px] ring-[#e8dfd6] sm:bottom-auto sm:right-[7%] sm:top-1/2 sm:h-[8rem] sm:w-[8rem] sm:-translate-y-1/2 lg:right-[9%]"
          aria-hidden
        >
          <span className="text-[9px] font-semibold uppercase tracking-[0.2em] text-brand sm:text-[10px]">Up to</span>
          <span className="font-display text-[2.15rem] font-bold leading-none text-[#2a2623] sm:text-[2.5rem]">85%</span>
          <span className="-mt-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-brand sm:text-[11px]">OFF</span>
        </motion.div>
      </motion.div>
    </header>
  )
}
