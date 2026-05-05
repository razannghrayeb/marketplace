'use client'

import { Clock, Shield, Sparkles, Tag } from 'lucide-react'

const ITEMS = [
  { Icon: Tag, title: 'Best deals', subtitle: 'Hand-picked markdowns' },
  { Icon: Sparkles, title: 'AI try-on', subtitle: 'Preview on your photo' },
  { Icon: Shield, title: 'Secure shopping', subtitle: 'Encrypted checkout' },
  { Icon: Clock, title: 'Limited time', subtitle: 'While supplies last' },
]

export function SaleTrustBar() {
  return (
    <div className="border-y border-[#ebe8e4]/70 bg-[#f2ebe4]/75 backdrop-blur-[6px]">
      <div className="mx-auto grid max-w-7xl grid-cols-2 gap-4 px-4 py-4 sm:grid-cols-4 sm:gap-6 sm:px-6 lg:px-8">
        {ITEMS.map(({ Icon, title, subtitle }) => (
          <div key={title} className="flex items-start gap-2.5 sm:gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-brand shadow-sm ring-1 ring-[#ebe8e4] sm:h-10 sm:w-10">
              <Icon className="h-[18px] w-[18px]" aria-hidden />
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="text-[13px] font-semibold text-[#2a2623]">{title}</p>
              <p className="mt-0.5 text-[11px] leading-snug text-[#7a726b]">{subtitle}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
