'use client'

import Image from 'next/image'
import { motion } from 'framer-motion'
import { DISCOVER_HERO_IMAGE_PATHS } from '@/components/search/DiscoverHeroMasonry'

const EASE = [0.22, 1, 0.36, 1] as const

/** 6 editorial stills — varied sizes & z-index, soft float (no marquee crop). */
const FLOAT_LAYOUT_FULL: { pathIndex: number; className: string; delay: string }[] = [
  { pathIndex: 0, className: 'absolute right-[0%] top-[4%] z-[8] w-[32%] max-w-[210px]', delay: '0s' },
  { pathIndex: 1, className: 'absolute right-[8%] top-[38%] z-[6] w-[28%] max-w-[180px]', delay: '0.8s' },
  { pathIndex: 2, className: 'absolute right-[22%] bottom-[6%] z-[7] w-[30%] max-w-[195px]', delay: '1.4s' },
  { pathIndex: 4, className: 'absolute left-[0%] top-[10%] z-[5] w-[30%] max-w-[190px]', delay: '0.4s' },
  { pathIndex: 5, className: 'absolute left-[4%] bottom-[12%] z-[9] w-[34%] max-w-[220px]', delay: '1.1s' },
  { pathIndex: 7, className: 'absolute left-[28%] top-[42%] z-[4] w-[26%] max-w-[165px]', delay: '1.9s' },
]

const FLOAT_LAYOUT_COMPACT: { pathIndex: number; className: string; delay: string }[] = [
  { pathIndex: 0, className: 'absolute right-[4%] top-[8%] z-[6] w-[38%] max-w-[140px]', delay: '0s' },
  { pathIndex: 2, className: 'absolute left-[6%] top-[12%] z-[5] w-[36%] max-w-[130px]', delay: '0.6s' },
  { pathIndex: 5, className: 'absolute left-[22%] bottom-[10%] z-[7] w-[40%] max-w-[150px]', delay: '1.2s' },
]

function FloatCard({
  src,
  delay,
  motionDelay,
  priority,
}: {
  src: string
  delay: string
  motionDelay: number
  priority?: boolean
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, delay: motionDelay, ease: EASE }}
      className="discover-hero-float-card group pointer-events-auto"
      style={{ animationDelay: delay }}
    >
      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-2xl bg-[#f4efe8] shadow-[0_24px_60px_rgba(43,37,33,0.14)] ring-1 ring-[#2B2521]/[0.08] transition-transform duration-500 ease-out group-hover:-translate-y-[6px] group-hover:scale-[1.03] motion-reduce:transition-none">
        <Image
          src={src}
          alt=""
          fill
          className="object-cover object-center"
          sizes="(max-width: 768px) 40vw, 220px"
          priority={priority}
        />
      </div>
    </motion.div>
  )
}

export function DiscoverHeroFloating({
  variant = 'full',
  className = '',
}: {
  variant?: 'full' | 'compact'
  className?: string
}) {
  const compact = variant === 'compact'
  const layout = compact ? FLOAT_LAYOUT_COMPACT : FLOAT_LAYOUT_FULL
  const p = DISCOVER_HERO_IMAGE_PATHS

  return (
    <div
      className={`relative mx-auto w-full ${compact ? 'min-h-[200px] max-h-[280px]' : 'min-h-[min(52vh,520px)] max-w-[min(100%,520px)] lg:max-w-none'} ${className}`}
      aria-hidden
    >
      <div className={compact ? 'relative h-[220px] w-full' : 'relative min-h-[min(52vh,520px)] w-full pb-6 pt-4'}>
        {layout.map(({ pathIndex, className: pos, delay }, i) => (
          <div key={`${pathIndex}-${i}`} className={pos}>
            <FloatCard src={p[pathIndex]!} delay={delay} motionDelay={0.06 + i * 0.07} priority={i === 0} />
          </div>
        ))}
      </div>
    </div>
  )
}
