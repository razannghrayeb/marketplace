'use client'

import Image from 'next/image'
import clsx from 'clsx'

const SRC = '/brand/bolden-logo.png'

export type BoldenLogoTone = 'default' | 'lightSurface' | 'inverted'

/** Playfair wordmark beside the mark — pairs with the serif “B” in the icon. */
export const boldenWordmarkClassName =
  'font-display font-semibold tracking-[-0.02em] leading-none antialiased'

/**
 * Logomark from `public/brand/bolden-logo.png` (editorial “B” + arc + star).
 * Decorative when shown beside the “Bolden” wordmark — use `ariaHidden`.
 */
export function BoldenLogoMark({
  tone = 'default',
  compact = false,
  className,
  ariaHidden = true,
}: {
  tone?: BoldenLogoTone
  compact?: boolean
  className?: string
  ariaHidden?: boolean
}) {
  return (
    <span
      className={clsx(
        'relative inline-block shrink-0 overflow-hidden rounded-full',
        compact ? 'h-8 w-8' : 'h-9 w-9',
        tone === 'default' && 'ring-1 ring-ink/12 bg-[#f8f3ee]/95 shadow-sm',
        tone === 'lightSurface' && 'ring-1 ring-white/35 bg-white/12 shadow-[0_1px_12px_rgba(0,0,0,0.15)]',
        tone === 'inverted' && 'ring-1 ring-white/25 bg-white/10',
        className,
      )}
    >
      <Image
        src={SRC}
        alt=""
        aria-hidden={ariaHidden}
        fill
        className={clsx(
          /* Asset is a white rounded square; cover + zoom clips corners so the mark reads circular */
          'rounded-full object-cover object-center scale-[1.14]',
          tone === 'inverted' && 'brightness-0 invert opacity-[0.94]',
        )}
        sizes={compact ? '32px' : '36px'}
        priority
      />
    </span>
  )
}
