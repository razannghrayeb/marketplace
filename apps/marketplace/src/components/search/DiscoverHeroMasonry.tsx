'use client'

import Image from 'next/image'
import clsx from 'clsx'
import { motion } from 'framer-motion'

/** Hero strip assets in `public/discover-hero/01.png` … `11.png`. */
export const DISCOVER_HERO_IMAGE_PATHS = Array.from(
  { length: 11 },
  (_, i) => `/discover-hero/${String(i + 1).padStart(2, '0')}.png`,
) as readonly string[]

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] as const },
  },
}

function HeroThumb({ src, priority }: { src: string; priority?: boolean }) {
  return (
    <div className="relative aspect-[3/4] w-full shrink-0 overflow-hidden rounded-xl bg-[#f4efe8] shadow-[0_8px_24px_-12px_rgba(42,32,26,0.22)] ring-1 ring-[#3e3026]/[0.1] sm:rounded-2xl">
      <Image
        src={src}
        alt=""
        fill
        className="object-cover"
        sizes="(max-width: 640px) 34vw, (max-width: 1024px) 28vw, 320px"
        priority={priority}
      />
    </div>
  )
}

function ScrollingColumn({
  srcs,
  direction,
  durationSec,
  priorityFirst,
  compact,
}: {
  srcs: readonly string[]
  direction: 'up' | 'down'
  durationSec: number
  priorityFirst?: boolean
  compact?: boolean
}) {
  const strip = (dupKey: 'a' | 'b') => (
    <div className={compact ? 'flex flex-col gap-0.5' : 'flex flex-col gap-1 sm:gap-1'}>
      {srcs.map((src, i) => (
        <HeroThumb
          key={`${dupKey}-${src}`}
          src={src}
          priority={priorityFirst && dupKey === 'a' && i === 0}
        />
      ))}
    </div>
  )

  return (
    <div
      className="relative h-full min-h-0 w-full flex-1 overflow-hidden"
      style={{ ['--discover-marquee-duration' as string]: `${durationSec}s` }}
    >
      <div
        className={`flex flex-col will-change-transform ${
          direction === 'up' ? 'discover-hero-marquee-up' : 'discover-hero-marquee-down'
        }`}
      >
        {strip('a')}
        {strip('b')}
      </div>
    </div>
  )
}

/**
 * Discover landing hero: three columns of editorial stills, alternating vertical marquees.
 * `compact` fits a short strip when the user already has a query (hero stays visible while results load).
 */
export function DiscoverHeroMasonry({
  className = '',
  variant = 'full',
}: {
  className?: string
  variant?: 'full' | 'compact'
}) {
  const compact = variant === 'compact'
  const p = DISCOVER_HERO_IMAGE_PATHS
  const col0 = [p[0], p[3], p[6], p[9]] as const
  const col1 = [p[1], p[4], p[7], p[10]] as const
  const col2 = [p[2], p[5], p[8]] as const

  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={containerVariants}
      className={clsx('mx-auto flex w-full max-w-none shrink-0 flex-col px-0', className)}
      aria-hidden
    >
      <div
        className={clsx(
          'grid w-full shrink-0 grid-cols-3 grid-rows-[minmax(0,1fr)] items-stretch',
          compact
            ? 'h-[72px] max-h-[84px] gap-0.5 sm:h-[80px] sm:max-h-[92px] sm:gap-0.5'
            : /* Fixed short rail — grid row no longer stretches to left column */
              'h-[72px] gap-0.5 sm:h-[84px] sm:gap-1 md:h-[96px] lg:h-[104px]',
        )}
      >
        <div className="relative min-h-0 h-full min-w-0">
          <ScrollingColumn srcs={col0} direction="up" durationSec={36} priorityFirst compact={compact} />
        </div>
        {/* Staggered like reference: center column starts lower; scrolls down */}
        <div
          className={clsx(
            'relative flex min-h-0 min-w-0 flex-col',
            compact ? 'pt-0.5' : 'pt-1 sm:pt-1.5',
          )}
        >
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <ScrollingColumn srcs={col1} direction="down" durationSec={32} compact={compact} />
          </div>
        </div>
        <div className="relative min-h-0 h-full min-w-0">
          <ScrollingColumn srcs={col2} direction="up" durationSec={40} compact={compact} />
        </div>
      </div>
    </motion.div>
  )
}
