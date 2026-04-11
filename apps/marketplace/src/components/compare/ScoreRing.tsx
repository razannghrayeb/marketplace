'use client'

import { motion } from 'framer-motion'
import { useId } from 'react'

type LevelColor = 'green' | 'yellow' | 'red'

const GRADIENT_STOPS: Record<LevelColor, [string, string]> = {
  green: ['#7c3aed', '#db2777'],
  yellow: ['#ca8a04', '#ea580c'],
  red: ['#e11d48', '#be123c'],
}

export function ScoreRing({
  score,
  color,
  size = 80,
  label,
}: {
  score: number
  color: LevelColor
  size?: number
  label?: string
}) {
  const gid = useId().replace(/:/g, '')
  const radius = (size - 10) / 2
  const circ = 2 * Math.PI * radius
  const pct = Math.max(0, Math.min(100, score))
  const offset = circ - (pct / 100) * circ

  const [c0, c1] = GRADIENT_STOPS[color]
  const trackColor = color === 'green' ? '#f5f3ff' : color === 'yellow' ? '#fffbeb' : '#fff1f2'

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative drop-shadow-[0_4px_12px_rgba(124,58,237,0.15)]" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <defs>
            <linearGradient id={`sr-${gid}`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={c0} />
              <stop offset="100%" stopColor={c1} />
            </linearGradient>
          </defs>
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={trackColor} strokeWidth={7} />
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={`url(#sr-${gid})`}
            strokeWidth={7}
            strokeLinecap="round"
            strokeDasharray={circ}
            initial={{ strokeDashoffset: circ }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <motion.span
            className="text-xl font-bold tabular-nums tracking-tight text-neutral-900"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.45, duration: 0.35 }}
          >
            {score}
          </motion.span>
          <span className="text-[9px] font-semibold uppercase tracking-wider text-neutral-400">score</span>
        </div>
      </div>
      {label ? <span className="text-[10px] font-medium text-neutral-500 text-center max-w-[5.5rem] leading-tight">{label}</span> : null}
    </div>
  )
}

export function scoreToLevelColor(score: number): LevelColor {
  if (score >= 67) return 'green'
  if (score >= 40) return 'yellow'
  return 'red'
}
