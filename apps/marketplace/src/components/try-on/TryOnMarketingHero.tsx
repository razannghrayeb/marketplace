'use client'

import { motion } from 'framer-motion'
import { Sparkles } from 'lucide-react'
import type { ReactNode } from 'react'
import { TryOnHeroComparison } from '@/components/try-on/TryOnHeroComparison'
import { TryOnStepper } from '@/components/try-on/TryOnStepper'

/** Demo imagery: before = original look, after = styled / try-on result */
const TRYON_HERO_BEFORE = '/brand/tryon-hero-before.jpg'
const TRYON_HERO_AFTER = '/brand/tryon-hero-after.jpg'

export function TryOnMarketingHero({
  signInSlot,
  activeStep = 1,
}: {
  signInSlot?: ReactNode
  activeStep?: 1 | 2 | 3
}) {
  return (
    <header className="relative w-full bg-[#ece8e5]">
      <div className="relative z-10 mx-auto w-full max-w-7xl px-4 pb-8 pt-[72px] sm:px-6 sm:pb-10 lg:px-10 lg:pb-12">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="grid w-full grid-cols-1 items-center gap-8 lg:grid-cols-12 lg:gap-10 xl:gap-12"
        >
          <div className="flex flex-col justify-center lg:col-span-7">
            <div className="mb-4 inline-flex w-fit items-center gap-2 rounded-full border border-[#d8d2cd] bg-white/80 px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-[#4a4540] shadow-sm sm:mb-5 sm:px-4 sm:py-2 sm:text-[11px]">
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-brand sm:h-4 sm:w-4" aria-hidden />
              AI virtual fitting room
            </div>
            <h1 className="font-display text-[2.35rem] font-bold leading-[1.05] tracking-[-0.03em] text-[#1c1917] sm:text-[2.85rem] lg:text-[3.25rem] xl:text-[3.5rem]">
              Virtual try-on
            </h1>
            <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-[#3d3935] sm:mt-5 sm:text-[1.05rem] lg:text-lg">
              Upload your photo and a garment image. Our AI will create a realistic try-on for you.
            </p>

            <div className="mt-7 sm:mt-8">
              <TryOnStepper variant="hero" heroSize="compact" activeStep={activeStep} />
            </div>

            {signInSlot ? <div className="mt-6 flex flex-wrap gap-2 sm:mt-7">{signInSlot}</div> : null}
          </div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
            className="flex w-full flex-col items-center justify-center lg:col-span-5"
          >
            <div className="relative w-full max-w-[min(92vw,380px)] sm:max-w-[420px] lg:max-w-[460px] xl:max-w-[500px]">
              <TryOnHeroComparison
                beforeSrc={TRYON_HERO_BEFORE}
                afterSrc={TRYON_HERO_AFTER}
                fillVertical={false}
                autoPlay
                className="!max-h-[min(52vh,520px)] w-full rounded-[20px] shadow-[0_12px_32px_-18px_rgba(42,38,35,0.16)] ring-1 ring-[#ddd8d2] sm:!max-h-[min(56vh,560px)]"
              />
              <p className="mt-2.5 px-1 text-center text-[11px] text-[#6b6560] sm:text-[12px]">
                The preview moves on its own — drag the handle anytime to explore.
              </p>
            </div>
          </motion.div>
        </motion.div>
      </div>
    </header>
  )
}
