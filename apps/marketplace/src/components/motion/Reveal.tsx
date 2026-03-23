'use client'

import { motion, type HTMLMotionProps, type Variants } from 'framer-motion'
import type { ReactNode } from 'react'

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 32, filter: 'blur(6px)' },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: {
      delay: i * 0.06,
      duration: 0.6,
      ease: [0.22, 1, 0.36, 1],
    },
  }),
}

type RevealProps = {
  children: ReactNode
  className?: string
  index?: number
} & Omit<HTMLMotionProps<'div'>, 'children' | 'variants' | 'initial' | 'whileInView'>

export function Reveal({ children, className, index = 0, ...rest }: RevealProps) {
  return (
    <motion.div
      className={className}
      variants={fadeUp}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: '-60px 0px' }}
      custom={index}
      {...rest}
    >
      {children}
    </motion.div>
  )
}
