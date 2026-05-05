'use client'

import { useEffect, useMemo, useState } from 'react'

function pad(n: number) {
  return String(n).padStart(2, '0')
}

/**
 * Counts down to a rolling end date (15 days from mount) for a limited-time sale strip.
 */
export function SaleCountdown() {
  const end = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() + 15)
    d.setHours(23, 59, 59, 999)
    return d.getTime()
  }, [])

  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const ms = Math.max(0, end - now)
  const days = Math.floor(ms / 86400000)
  const hrs = Math.floor((ms % 86400000) / 3600000)
  const mins = Math.floor((ms % 3600000) / 60000)
  const secs = Math.floor((ms % 60000) / 1000)

  const cells = [
    { value: pad(days), label: 'DAYS' },
    { value: pad(hrs), label: 'HRS' },
    { value: pad(mins), label: 'MINS' },
    { value: pad(secs), label: 'SECS' },
  ]

  return (
    <div className="mt-8 flex flex-wrap gap-2 sm:mt-10 sm:gap-3">
      {cells.map((c) => (
        <div
          key={c.label}
          className="flex min-w-[4.25rem] flex-col items-center justify-center rounded-xl bg-white/95 px-3 py-2.5 shadow-[0_8px_28px_-12px_rgba(43,37,33,0.25)] ring-1 ring-white/80 backdrop-blur-sm sm:min-w-[4.75rem] sm:rounded-2xl sm:py-3"
        >
          <span className="font-display text-xl font-bold tabular-nums leading-none text-[#2a2623] sm:text-2xl">{c.value}</span>
          <span className="mt-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-[#7a726b] sm:text-[10px]">{c.label}</span>
        </div>
      ))}
    </div>
  )
}
