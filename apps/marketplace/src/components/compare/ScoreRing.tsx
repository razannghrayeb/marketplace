'use client'

import { motion } from 'framer-motion'
import { useId } from 'react'

type LevelColor = 'green' | 'yellow' | 'red'

/** Warm brown / beige arcs — matches brand compare studio (no orange or blue). */
const GRADIENT_STOPS: Record<LevelColor, [string, string]> = {
  green: ['#5c4033', '#7d5a48'],
  yellow: ['#8b6a54', '#a18066'],
  red: ['#c4ab93', '#d9cbb9'],
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
  /** Thinner arc on small thumbnail overlays; keeps proportions readable. */
  const stroke = size < 48 ? 5 : 7
  const radius = Math.max(4, size / 2 - stroke / 2 - 0.5)
  const circ = 2 * Math.PI * radius
  const pct = Math.max(0, Math.min(100, score))
  const offset = circ - (pct / 100) * circ
  const compact = size < 52

  const [c0, c1] = GRADIENT_STOPS[color]
  const trackColor = color === 'green' ? '#ede8e2' : color === 'yellow' ? '#f2ebe4' : '#f5f0ea'

  const scoreText =
    size < 40 ? 'text-xs font-bold' : size < 52 ? 'text-sm font-bold' : 'text-xl font-bold'

  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={`relative ${compact ? 'drop-shadow-[0_2px_8px_rgba(92,64,51,0.18)]' : 'drop-shadow-[0_4px_12px_rgba(92,64,51,0.22)]'}`}
        style={{ width: size, height: size }}
      >
        <svg width={size} height={size} className="-rotate-90">
          <defs>
            <linearGradient id={`sr-${gid}`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={c0} />
              <stop offset="100%" stopColor={c1} />
            </linearGradient>
          </defs>
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={trackColor} strokeWidth={stroke} />
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={`url(#sr-${gid})`}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circ}
            initial={{ strokeDashoffset: circ }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
          <motion.span
            className={`tabular-nums tracking-tight text-[#2a2623] ${scoreText}`}
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.45, duration: 0.35 }}
          >
            {score}
          </motion.span>
          {size >= 52 ? (
            <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-wider text-[#7a726b]">score</span>
          ) : null}
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
