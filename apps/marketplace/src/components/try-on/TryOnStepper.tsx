'use client'

import { Fragment } from 'react'
import clsx from 'clsx'

const STEPS = [
  { n: 1 as const, label: 'Your photo' },
  { n: 2 as const, label: 'Garment' },
  { n: 3 as const, label: 'Generate' },
]

export function TryOnStepper({
  activeStep,
  variant = 'default',
  heroSize = 'default',
}: {
  activeStep: 1 | 2 | 3
  variant?: 'default' | 'hero'
  /** Smaller pills for try-on hero */
  heroSize?: 'default' | 'compact'
}) {
  if (variant === 'hero') {
    const compact = heroSize === 'compact'
    return (
      <div className="w-full" aria-label="Try-on steps">
        <div className={compact ? 'flex flex-wrap items-center gap-x-1 gap-y-2' : 'flex flex-wrap items-center gap-y-3'}>
          {STEPS.map(({ n, label }, i) => (
            <Fragment key={n}>
              <div
                className={clsx(
                  'flex shrink-0 items-center rounded-full border shadow-[0_4px_14px_-8px_rgba(42,38,35,0.12)] transition-colors',
                  compact ? 'gap-1.5 px-2.5 py-1 text-[11px]' : 'gap-2.5 px-4 py-2.5 text-[13px]',
                  activeStep >= n
                    ? 'border-brand/20 bg-white text-[#2a2623] ring-1 ring-brand/12'
                    : 'border-[#d8d2cd] bg-white/80 text-[#6b6560]',
                )}
              >
                <span
                  className={clsx(
                    'flex shrink-0 items-center justify-center rounded-full font-bold tabular-nums',
                    compact ? 'h-5 w-5 text-[10px]' : 'h-7 w-7 text-[12px]',
                    activeStep >= n ? 'bg-brand text-white' : 'bg-[#ebe8e4] text-[#9c9590]',
                  )}
                >
                  {n}
                </span>
                <span className={compact ? 'font-medium tracking-tight' : 'font-semibold tracking-tight'}>{label}</span>
              </div>
              {i < STEPS.length - 1 ? (
                <div
                  className={clsx(
                    'mx-1 hidden h-0 shrink border-t border-dashed border-[#c9c3bc] sm:block',
                    compact ? 'min-w-[0.75rem] border-t sm:mx-1.5 sm:min-w-[1.25rem] md:min-w-[1.75rem]' : 'min-w-[1.25rem] border-t-2 sm:mx-3 sm:min-w-[2rem] md:min-w-[2.75rem]',
                  )}
                  aria-hidden
                />
              ) : null}
            </Fragment>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="grid grid-cols-[minmax(0,1fr)_20px_minmax(0,1fr)_20px_minmax(0,1fr)] items-start gap-x-1 sm:grid-cols-[minmax(0,1fr)_32px_minmax(0,1fr)_32px_minmax(0,1fr)] sm:gap-x-2">
        {STEPS.map(({ n, label }, i) => (
          <Fragment key={n}>
            <div className="flex flex-col items-center text-center">
              <div
                className={clsx(
                  'flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold shadow-sm transition-colors',
                  activeStep >= n ? 'bg-brand text-white ring-2 ring-brand/25' : 'bg-[#e8e4df] text-[#9c9590]',
                )}
              >
                {n}
              </div>
              <span className="mt-2 max-w-[6rem] text-[12px] font-medium leading-tight text-[#6b6560]">{label}</span>
            </div>
            {i < STEPS.length - 1 ? (
              <div className="mt-[1.25rem] w-full border-t-2 border-dashed border-[#d8d2cd]" aria-hidden />
            ) : null}
          </Fragment>
        ))}
      </div>
    </div>
  )
}
