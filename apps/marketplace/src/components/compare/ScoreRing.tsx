'use client'

import { motion } from 'framer-motion'

type LevelColor = 'green' | 'yellow' | 'red'

export function ScoreRing({
  score,
  color,
  size = 72,
}: {
  score: number
  color: LevelColor
  size?: number
}) {
  const radius = (size - 8) / 2
  const circ = 2 * Math.PI * radius
  const pct = Math.max(0, Math.min(100, score))
  const offset = circ - (pct / 100) * circ

  const strokeColor =
    color === 'green' ? '#22c55e' : color === 'yellow' ? '#eab308' : '#ef4444'
  const bgColor =
    color === 'green' ? '#dcfce7' : color === 'yellow' ? '#fef9c3' : '#fee2e2'

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={bgColor} strokeWidth={6} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={strokeColor}
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={circ}
          initial={{ strokeDashoffset: circ }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1], delay: 0.3 }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <motion.span
          className="text-lg font-bold text-neutral-800"
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.6, duration: 0.4 }}
        >
          {score}
        </motion.span>
      </div>
    </div>
  )
}

export function scoreToLevelColor(score: number): LevelColor {
  if (score >= 67) return 'green'
  if (score >= 40) return 'yellow'
  return 'red'
}
