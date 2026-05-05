'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import Image from 'next/image'
import { ChevronLeft, ChevronRight } from 'lucide-react'

export function TryOnHeroComparison({
  beforeSrc = '/brand/tz-home-virtual-tryon-showcase.jpg',
  afterSrc = '/brand/tz-service-tryon-mirror.jpg',
  className = '',
  overlayBottomRight,
  fillVertical = false,
  /** Smoothly oscillates the divider so before/after is visible without dragging. */
  autoPlay = false,
}: {
  beforeSrc?: string
  afterSrc?: string
  overlayBottomRight?: ReactNode
  className?: string
  fillVertical?: boolean
  autoPlay?: boolean
}) {
  const [pct, setPct] = useState(48)
  const hostRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)

  const setFromClientX = useCallback((clientX: number) => {
    const el = hostRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const x = Math.min(Math.max(clientX - r.left, 0), r.width)
    setPct(Math.round((x / r.width) * 100))
  }, [])

  useEffect(() => {
    if (!autoPlay) return
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return
    }

    let raf = 0
    const start = performance.now()
    const periodMs = 5200
    const minP = 34
    const maxP = 66

    const tick = (now: number) => {
      if (!draggingRef.current) {
        const t = (now - start) / periodMs
        const wave = (Math.sin(t * Math.PI * 2) + 1) / 2
        setPct(Math.round(minP + wave * (maxP - minP)))
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [autoPlay])

  return (
    <div
      ref={hostRef}
      className={`relative w-full cursor-ew-resize overflow-hidden bg-[#ebe8e4] ring-1 ring-[#e3ddd4]/90 select-none touch-none ${
        fillVertical
          ? 'h-full min-h-[16rem] max-h-none flex-1'
          : 'aspect-[4/5] max-h-[min(72vh,560px)] rounded-[24px] shadow-[0_22px_52px_-28px_rgba(42,38,35,0.28)]'
      } ${className}`}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('[data-tryon-overlay-click]')) return
        draggingRef.current = true
        hostRef.current?.setPointerCapture(e.pointerId)
        setFromClientX(e.clientX)
      }}
      onPointerMove={(e) => {
        if (!hostRef.current?.hasPointerCapture(e.pointerId)) return
        setFromClientX(e.clientX)
      }}
      onPointerUp={(e) => {
        hostRef.current?.releasePointerCapture(e.pointerId)
        draggingRef.current = false
      }}
      onPointerCancel={(e) => {
        hostRef.current?.releasePointerCapture(e.pointerId)
        draggingRef.current = false
      }}
      role="img"
      aria-label={
        autoPlay
          ? 'Before and after virtual try-on demonstration. The comparison moves automatically; you can still drag the handle.'
          : 'Before and after virtual try-on demonstration. Drag to compare.'
      }
    >
      <Image src={afterSrc} alt="" fill className="object-cover object-center" sizes="(max-width:1024px) 100vw, 45vw" priority />

      <div className="pointer-events-none absolute inset-0 z-[1]" style={{ clipPath: `inset(0 ${100 - pct}% 0 0)` }}>
        <Image src={beforeSrc} alt="" fill className="object-cover object-center" sizes="(max-width:1024px) 100vw, 45vw" priority />
      </div>

      <div className="pointer-events-none absolute bottom-4 left-4 z-[3] rounded-full bg-black/60 px-3 py-1.5 text-[11px] font-semibold tracking-wide text-white shadow-md backdrop-blur-sm">
        Before
      </div>
      {!overlayBottomRight ? (
        <div className="pointer-events-none absolute bottom-4 right-4 z-[3] rounded-full bg-black/60 px-3 py-1.5 text-[11px] font-semibold tracking-wide text-white shadow-md backdrop-blur-sm">
          After
        </div>
      ) : (
        <div className="pointer-events-none absolute bottom-14 right-4 z-[3] rounded-full bg-black/55 px-3 py-1.5 text-[11px] font-semibold tracking-wide text-white shadow-md backdrop-blur-sm">
          After
        </div>
      )}

      <div
        className="pointer-events-none absolute inset-y-0 z-[2] w-px bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.06)]"
        style={{ left: `${pct}%`, transform: 'translateX(-50%)' }}
      />
      <div
        className="pointer-events-none absolute top-1/2 z-[2] flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-[#2a2623] shadow-[0_8px_24px_-8px_rgba(0,0,0,0.35)] ring-2 ring-white/90"
        style={{ left: `${pct}%` }}
        aria-hidden
      >
        <ChevronLeft className="h-3.5 w-3.5 -mr-1 opacity-70" />
        <ChevronRight className="h-3.5 w-3.5 -ml-1 opacity-70" />
      </div>

      {overlayBottomRight ? (
        <div className="absolute bottom-4 right-4 z-[5] max-w-[calc(100%-5rem)]" data-tryon-overlay-click>
          {overlayBottomRight}
        </div>
      ) : null}
    </div>
  )
}
