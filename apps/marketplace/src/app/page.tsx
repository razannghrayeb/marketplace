'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowRight, Camera, Image as ImageIcon, Layers, Search, Shirt,
  TrendingUp, Zap, Eye, BarChart3, Sparkles,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell } from 'recharts'
import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'
import { ProductGrid } from '@/components/product/ProductGrid'
import { SearchBar } from '@/components/search/SearchBar'
import { Reveal } from '@/components/motion/Reveal'

/* ── Hero carousel slides ── */
const heroSlides = [
  {
    eyebrow: 'Visual fashion discovery',
    headline: (
      <>
        <span className="text-neutral-900">Shop with </span>
        <span className="text-gradient-accent">color, clarity,</span>
        <span className="text-neutral-900"> and AI</span>
      </>
    ),
    desc: 'See it, search it, save it. Text, photos, or blended references — find exactly what you\'re looking for.',
    cta: { label: 'Start exploring', href: '/search' },
    secondary: { label: 'Visual search', href: '/search?mode=image', Icon: Camera },
    hasSearch: true,
  },
  {
    eyebrow: 'Virtual try-on',
    headline: (
      <>
        <span className="text-neutral-900">Try before </span>
        <span className="text-gradient-accent">you buy</span>
      </>
    ),
    desc: 'Preview any garment on yourself using AI — from the catalog or your own wardrobe. No dressing room needed.',
    cta: { label: 'Try it on', href: '/try-on' },
    secondary: { label: 'Browse catalog', href: '/products', Icon: Shirt },
    hasSearch: false,
  },
  {
    eyebrow: 'Smart wardrobe',
    headline: (
      <>
        <span className="text-neutral-900">Your wardrobe, </span>
        <span className="text-gradient-accent">digitized</span>
      </>
    ),
    desc: 'Upload your closet, get outfit suggestions, and discover what\'s missing — powered by visual AI.',
    cta: { label: 'Open wardrobe', href: '/wardrobe' },
    secondary: { label: 'Compare items', href: '/compare', Icon: Layers },
    hasSearch: false,
  },
]

/* Per-slide card layouts — unique design for each slide */
const slideLayouts: Array<Array<{
  cls: string; rotate: number; z: number; enterDelay: number; floatDur: number
  initial: Record<string, number>
}>> = [
  /* Slide 0 – Discovery: fanned cards, all clearly visible */
  [
    { cls: 'top-[3%] right-[0%] w-[54%] max-w-[255px]', rotate: 4, z: 30, enterDelay: 0.08, floatDur: 4.2,
      initial: { y: 70, rotate: 12 } },
    { cls: 'top-[18%] left-[0%] w-[46%] max-w-[215px]', rotate: -3, z: 20, enterDelay: 0.22, floatDur: 4.8,
      initial: { x: -60, rotate: -12 } },
    { cls: 'bottom-[0%] left-[28%] w-[50%] max-w-[235px]', rotate: 1, z: 25, enterDelay: 0.36, floatDur: 5.3,
      initial: { y: 70, rotate: -4 } },
  ],
  /* Slide 1 – Try-On: hero card center + two satellites */
  [
    { cls: 'top-[2%] left-[14%] w-[62%] max-w-[285px]', rotate: 0, z: 30, enterDelay: 0.1, floatDur: 4.5,
      initial: { scale: 0.7, y: 30 } },
    { cls: 'top-[8%] right-[-2%] w-[40%] max-w-[185px]', rotate: 8, z: 20, enterDelay: 0.28, floatDur: 5.0,
      initial: { x: 80, rotate: 20 } },
    { cls: 'bottom-[4%] left-[2%] w-[42%] max-w-[195px]', rotate: -5, z: 25, enterDelay: 0.4, floatDur: 4.3,
      initial: { x: -70, rotate: -16 } },
  ],
  /* Slide 2 – Wardrobe: horizontal cascade spread */
  [
    { cls: 'top-[2%] left-[-2%] w-[44%] max-w-[205px]', rotate: -6, z: 20, enterDelay: 0.06, floatDur: 4.0,
      initial: { x: -50, y: -30, rotate: -18 } },
    { cls: 'top-[5%] left-[26%] w-[52%] max-w-[245px]', rotate: 0, z: 30, enterDelay: 0.2, floatDur: 4.6,
      initial: { y: -50, scale: 0.85 } },
    { cls: 'bottom-[0%] right-[-2%] w-[46%] max-w-[215px]', rotate: 6, z: 25, enterDelay: 0.35, floatDur: 5.2,
      initial: { x: 60, y: 30, rotate: 18 } },
  ],
]

function CategoryChart() {
  const { data } = useQuery({
    queryKey: ['facets-chart'],
    queryFn: async () => {
      const res = await api.get<{ data?: { categories?: Array<{ value: string; count: number }> } }>(
        endpoints.products.facets,
      )
      return res
    },
  })

  const categories =
    (data?.data as { categories?: Array<{ value: string; count: number }> })?.categories?.slice(0, 6) ?? []
  const chartData = categories.map((c) => ({ name: c.value || 'Other', count: c.count }))
  const palette = ['#7c3aed', '#a855f7', '#c026d3', '#db2777', '#0ea5e9', '#059669']

  if (chartData.length === 0) return null

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} layout="vertical" margin={{ top: 8, right: 24, left: 0, bottom: 8 }}>
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="name"
            width={100}
            tick={{ fontSize: 12, fill: '#525252' }}
            axisLine={false}
            tickLine={false}
          />
          <Bar dataKey="count" radius={[0, 8, 8, 0]}>
            {chartData.map((_, i) => (
              <Cell key={i} fill={palette[i % palette.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

const features = [
  {
    icon: Search,
    title: 'Text Search',
    desc: 'Describe mood, occasion, or silhouette — we translate intent into products you can act on.',
    href: '/search',
    image: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=900&h=700&fit=crop&q=80',
    iconBg: 'from-violet-500 to-indigo-600',
    strip: 'from-violet-500 via-fuchsia-500 to-indigo-500',
  },
  {
    icon: Camera,
    title: 'Photo Upload',
    desc: 'Upload your own images to find matching products across the entire catalog instantly.',
    href: '/search?mode=image',
    image: 'https://images.unsplash.com/photo-1542272604-787c3835535d?w=900&h=700&fit=crop&q=80',
    iconBg: 'from-fuchsia-500 to-pink-600',
    strip: 'from-fuchsia-500 via-rose-500 to-pink-600',
  },
  {
    icon: Layers,
    title: 'Mix References',
    desc: 'Blend multiple images to steer search towards the style you have in mind.',
    href: '/search?mode=multi',
    image: 'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?w=900&h=700&fit=crop&q=80',
    iconBg: 'from-sky-500 to-cyan-600',
    strip: 'from-sky-500 via-cyan-500 to-emerald-500',
  },
]

const benefits = [
  {
    icon: Zap,
    title: 'Instant Discovery',
    desc: 'Reduces frustration and speeds up product discovery, increasing likelihood of finding what you want.',
    bg: 'bg-violet-50/90',
    border: 'border-violet-200/60',
    iconWrap: 'bg-violet-100 text-violet-700',
  },
  {
    icon: Eye,
    title: 'Visual & Intuitive',
    desc: 'Eliminates the need for complex keywords — find what you want using images or natural language.',
    bg: 'bg-fuchsia-50/90',
    border: 'border-fuchsia-200/60',
    iconWrap: 'bg-fuchsia-100 text-fuchsia-700',
  },
  {
    icon: BarChart3,
    title: 'Smart Comparison',
    desc: 'AI-backed context helps you compare products confidently — not guesswork.',
    bg: 'bg-sky-50/90',
    border: 'border-sky-200/60',
    iconWrap: 'bg-sky-100 text-sky-700',
  },
]

const capabilities = [
  {
    icon: Search,
    title: 'AI-Powered Search',
    desc: 'Fashion-aware search identifies patterns, colors, textures, and styles to deliver results that match.',
    gradient: 'from-violet-500 via-purple-500 to-fuchsia-500',
    borderAccent: 'border-l-violet-500',
    href: '/search',
  },
  {
    icon: Shirt,
    title: 'Virtual Try-On',
    desc: 'Preview garments on yourself before committing — try styles from your wardrobe or the catalog.',
    gradient: 'from-rose-500 via-pink-500 to-fuchsia-500',
    borderAccent: 'border-l-rose-500',
    href: '/try-on',
  },
  {
    icon: ImageIcon,
    title: 'Style Matching',
    desc: 'Matches product styles and fits based on image analysis of silhouettes and shapes.',
    gradient: 'from-sky-500 via-cyan-500 to-emerald-500',
    borderAccent: 'border-l-sky-500',
    href: '/search?mode=image',
  },
]

/* ── Hero carousel component ── */
function HeroCarousel() {
  const [current, setCurrent] = useState(0)
  const touchX = useRef(0)
  const timerRef = useRef<ReturnType<typeof setInterval>>()

  const { data: heroProducts } = useQuery({
    queryKey: ['hero-carousel-products'],
    queryFn: async () => {
      const res = await api.get<Array<{
        id: number; title: string; brand?: string | null; category?: string | null
        price_cents: number; currency?: string; image_cdn?: string | null; image_url?: string | null
      }>>(endpoints.products.list, { limit: 15, page: 1 })
      const raw = Array.isArray(res?.data) ? res.data : []
      return raw.filter((p) => p.image_cdn || p.image_url).slice(0, 9)
    },
    staleTime: 5 * 60_000,
  })

  const products = heroProducts ?? []

  const resetTimer = () => {
    clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      setCurrent((p) => (p + 1) % heroSlides.length)
    }, 6000)
  }

  useEffect(() => {
    resetTimer()
    return () => clearInterval(timerRef.current)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const goTo = (i: number) => {
    setCurrent(i)
    resetTimer()
  }

  const slide = heroSlides[current]
  const slideCards = products.length >= 3
    ? [
        products[(current * 3) % products.length],
        products[(current * 3 + 1) % products.length],
        products[(current * 3 + 2) % products.length],
      ]
    : products.slice(0, 3)

  return (
    <section
      className="relative bg-neutral-100 overflow-hidden mesh-bg"
      onTouchStart={(e) => { touchX.current = e.touches[0].clientX }}
      onTouchEnd={(e) => {
        const dx = e.changedTouches[0].clientX - touchX.current
        if (dx < -50) goTo((current + 1) % heroSlides.length)
        else if (dx > 50) goTo((current - 1 + heroSlides.length) % heroSlides.length)
      }}
    >
      <div className="pointer-events-none absolute -top-32 -left-24 h-96 w-96 rounded-full bg-violet-300/35 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute top-20 right-0 h-[28rem] w-[28rem] rounded-full bg-fuchsia-300/30 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute bottom-0 left-1/3 h-80 w-80 rounded-full bg-amber-200/25 blur-3xl" aria-hidden />

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 sm:py-18 lg:py-24">
        <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
          {/* ── Left: text content (unique animation per slide) ── */}
          <div className="min-h-[380px] sm:min-h-[420px] flex flex-col justify-center">
            <AnimatePresence mode="wait">
              <motion.div
                key={current}
                initial={
                  current === 0 ? { opacity: 0, y: 30 }
                  : current === 1 ? { opacity: 0, x: -40 }
                  : { opacity: 0, scale: 0.94, y: 20 }
                }
                animate={{ opacity: 1, y: 0, x: 0, scale: 1 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
              >
                <p className="section-eyebrow mb-4">{slide.eyebrow}</p>
                <h1 className="text-4xl sm:text-5xl lg:text-[3.25rem] xl:text-[3.5rem] font-display font-bold tracking-tight leading-[1.06]">
                  {slide.headline}
                </h1>
                <p className="mt-5 text-lg sm:text-xl text-neutral-600 leading-relaxed max-w-xl">
                  {slide.desc}
                </p>

                {slide.hasSearch && (
                  <div className="mt-7 max-w-xl">
                    <SearchBar variant="hero" />
                  </div>
                )}

                <div className="mt-7 flex flex-wrap gap-3">
                  <Link href={slide.cta.href} className="btn-primary">{slide.cta.label}</Link>
                  <Link href={slide.secondary.href} className="btn-secondary">
                    <slide.secondary.Icon className="w-4 h-4" />
                    {slide.secondary.label}
                  </Link>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* ── Right: floating product cards (unique layout per slide) ── */}
          <div className="relative h-[380px] sm:h-[440px] lg:h-[500px] hidden sm:block">
            <AnimatePresence mode="wait">
              <motion.div
                key={current}
                className="relative w-full h-full"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
              >
                {slideCards.map((product, i) => {
                  const layouts = slideLayouts[current] ?? slideLayouts[0]
                  const layout = layouts[i]
                  if (!product || !layout) return null
                  const imgUrl = product.image_cdn || product.image_url || ''
                  const rawPrice = typeof product.price_cents === 'string' ? parseInt(product.price_cents, 10) : product.price_cents
                  const priceCents = Number.isFinite(rawPrice) ? rawPrice : 0
                  const price = priceCents > 0
                    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: product.currency || 'USD', minimumFractionDigits: 0 }).format(priceCents / 100)
                    : null

                  return (
                    <motion.div
                      key={`${current}-${product.id}`}
                      className={`absolute ${layout.cls}`}
                      style={{ zIndex: layout.z }}
                      initial={{ opacity: 0, scale: 1, x: 0, y: 0, rotate: 0, ...layout.initial }}
                      animate={{ opacity: 1, y: 0, x: 0, rotate: layout.rotate, scale: 1 }}
                      transition={{ delay: layout.enterDelay, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                    >
                      <motion.div
                        animate={{ y: [0, -10, 0] }}
                        transition={{ duration: layout.floatDur, repeat: Infinity, ease: 'easeInOut' }}
                      >
                        <Link
                          href={`/products/${product.id}`}
                          className="block bg-white rounded-2xl shadow-xl shadow-violet-500/12 overflow-hidden ring-1 ring-neutral-200/60 hover:shadow-2xl hover:shadow-violet-500/20 transition-shadow duration-300"
                        >
                          <div className="relative aspect-[3/4]">
                            <Image
                              src={imgUrl}
                              alt={product.title}
                              fill
                              className="object-cover"
                              sizes="280px"
                              onError={(e) => {
                                e.currentTarget.src = 'https://placehold.co/400x533/f5f5f5/737373?text=No+Image'
                              }}
                            />
                          </div>
                          <div className="p-3">
                            <p className="text-[10px] font-semibold text-violet-600 uppercase tracking-wider">
                              {product.brand || product.category || 'Trending'}
                            </p>
                            <p className="text-[13px] font-semibold text-neutral-900 line-clamp-1 mt-0.5">
                              {product.title}
                            </p>
                            {price && <p className="text-sm font-bold text-violet-700 mt-0.5">{price}</p>}
                          </div>
                        </Link>
                      </motion.div>
                    </motion.div>
                  )
                })}
              </motion.div>
            </AnimatePresence>

            {products.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-64 aspect-[3/4] rounded-2xl skeleton-shimmer" />
              </div>
            )}
          </div>
        </div>

        {/* ── Dot indicators ── */}
        <div className="flex justify-center gap-2.5 mt-10">
          {heroSlides.map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              className={`h-2.5 rounded-full transition-all duration-300 ${
                i === current
                  ? 'w-8 bg-gradient-to-r from-violet-600 to-fuchsia-500'
                  : 'w-2.5 bg-neutral-300 hover:bg-neutral-400'
              }`}
              aria-label={`Slide ${i + 1}`}
            />
          ))}
        </div>
      </div>
    </section>
  )
}

function ShopTheLook() {
  const { data, isLoading } = useQuery({
    queryKey: ['trending-looks'],
    queryFn: async () => {
      const res = await api.get<Array<{
        id: number; title: string; brand?: string | null; category?: string | null
        price_cents: number; currency?: string; image_cdn?: string | null; image_url?: string | null
      }>>(endpoints.products.list, { limit: 20, page: 1 })
      const raw = Array.isArray(res?.data) ? res.data : []
      return raw.filter((p) => p.image_cdn || p.image_url).slice(0, 2)
    },
    staleTime: 5 * 60_000,
  })

  const products = data ?? []

  if (isLoading) {
    return (
      <section className="py-20 lg:py-28 bg-neutral-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <div className="section-divider" />
            <div className="h-8 w-48 mx-auto rounded-lg skeleton-shimmer mt-4" />
          </div>
          <div className="grid md:grid-cols-2 gap-6 lg:gap-8">
            {[0, 1].map((i) => (
              <div key={i} className="aspect-[3/4] rounded-3xl skeleton-shimmer ring-1 ring-neutral-200/60" />
            ))}
          </div>
        </div>
      </section>
    )
  }

  if (products.length === 0) return null

  return (
    <section className="py-20 lg:py-28 bg-neutral-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <Reveal className="text-center max-w-2xl mx-auto mb-12">
          <div className="section-divider" />
          <p className="section-eyebrow mb-3">Trending now</p>
          <h2 className="heading-display text-3xl sm:text-4xl lg:text-[2.85rem] leading-tight">
            What&apos;s hot right now
          </h2>
          <p className="mt-4 text-lg text-neutral-600">
            Fresh picks from the catalog — updated live, tap to explore.
          </p>
        </Reveal>

        <div className="grid md:grid-cols-2 gap-6 lg:gap-8">
          {products.map((product, i) => {
            const imgUrl = product.image_cdn || product.image_url || ''
            const rawP = typeof product.price_cents === 'string' ? parseInt(product.price_cents, 10) : product.price_cents
            const pc = Number.isFinite(rawP) ? rawP : 0
            const price = pc > 0
              ? new Intl.NumberFormat('en-US', { style: 'currency', currency: product.currency || 'USD', minimumFractionDigits: 0 }).format(pc / 100)
              : null
            const searchQ = product.brand
              ? `${product.brand} ${product.category || ''}`.trim()
              : product.title

            return (
              <Reveal key={product.id} index={i}>
                <div className="group relative aspect-[3/4] rounded-3xl shadow-xl shadow-violet-500/10 overflow-hidden ring-1 ring-neutral-200/80">
                  <Image
                    src={imgUrl}
                    alt={product.title}
                    fill
                    className="object-cover transition-transform duration-700 group-hover:scale-105"
                    sizes="(max-width: 768px) 100vw, 50vw"
                    onError={(e) => {
                      e.currentTarget.src = 'https://placehold.co/700x950/f5f5f5/737373?text=No+Image'
                    }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/5 to-transparent" />

                  {/* Trending badge */}
                  <div className="absolute top-4 left-4 z-10">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/90 backdrop-blur-sm px-3 py-1.5 text-xs font-semibold text-violet-700 shadow-md">
                      <TrendingUp className="w-3 h-3" />
                      Trending
                    </span>
                  </div>

                  {/* Product info + actions */}
                  <div className="absolute bottom-0 inset-x-0 p-4 sm:p-5 z-10">
                    <div className="bg-white/92 backdrop-blur-md rounded-2xl p-4 shadow-xl border border-white/50">
                      <p className="text-[0.65rem] font-semibold text-violet-600 uppercase tracking-[0.15em]">
                        {product.brand || product.category || 'Trending'}
                      </p>
                      <h3 className="font-bold text-neutral-900 text-sm sm:text-base line-clamp-1 mt-0.5">
                        {product.title}
                      </h3>
                      {price && <p className="text-sm font-semibold text-neutral-800 mt-1">{price}</p>}
                      <div className="flex gap-2 mt-3">
                        <Link
                          href={`/products/${product.id}`}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-500 text-white text-xs font-bold hover:from-violet-500 hover:to-fuchsia-400 transition-all shadow-md shadow-violet-500/25 active:scale-[0.97]"
                        >
                          View product
                        </Link>
                        <Link
                          href={`/search?q=${encodeURIComponent(searchQ)}`}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-white border-2 border-violet-200 text-violet-700 text-xs font-bold hover:bg-violet-50 hover:border-violet-300 transition-all active:scale-[0.97]"
                        >
                          Find similar <ArrowRight className="w-3 h-3" />
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              </Reveal>
            )
          })}
        </div>
      </div>
    </section>
  )
}

export default function HomePage() {
  return (
    <div className="overflow-x-hidden">
      {/* ───── Hero carousel ───── */}
      <HeroCarousel />

      {/* ───── Features with images ───── */}
      <section className="py-20 lg:py-28 bg-neutral-100 border-t border-neutral-200/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal className="text-center max-w-2xl mx-auto mb-16">
            <div className="section-divider" />
            <p className="section-eyebrow mb-3">Fashion search</p>
            <h2 className="heading-display text-3xl sm:text-4xl lg:text-[2.85rem] leading-tight">
              Turn images into instant finds
            </h2>
            <p className="mt-5 text-lg text-neutral-600 leading-relaxed">
              Every path starts with something visual — editorials, selfies, or mood boards. We match the vibe to real products.
            </p>
          </Reveal>

          <div className="grid md:grid-cols-3 gap-8 lg:gap-10">
            {features.map((f, i) => (
              <Reveal key={f.title} index={i}>
                <Link
                  href={f.href}
                  className="group block h-full rounded-3xl border border-neutral-200/70 bg-white overflow-hidden shadow-md hover:shadow-xl hover:shadow-violet-500/15 hover:-translate-y-1.5 transition-all duration-300 ring-1 ring-transparent hover:ring-violet-200/40"
                >
                  <div className={`h-1 w-full bg-gradient-to-r ${f.strip} opacity-90 group-hover:opacity-100 transition-opacity`} />
                  <div className="relative h-52 overflow-hidden">
                    <Image
                      src={f.image}
                      alt={f.title}
                      fill
                      className="object-cover transition-transform duration-700 group-hover:scale-105"
                      sizes="(max-width: 768px) 100vw, 33vw"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
                    <div className="absolute bottom-4 left-4">
                      <span className={`inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${f.iconBg} text-white shadow-lg`}>
                        <f.icon className="w-5 h-5" />
                      </span>
                    </div>
                  </div>
                  <div className="p-7 lg:p-8">
                    <h3 className="text-xl font-bold text-neutral-900 mb-2">{f.title}</h3>
                    <p className="text-neutral-600 leading-relaxed text-[15px]">{f.desc}</p>
                    <span className="inline-flex items-center gap-2 mt-5 text-sm font-semibold text-violet-700 group-hover:gap-3 transition-all">
                      Explore <ArrowRight className="w-4 h-4" />
                    </span>
                  </div>
                </Link>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ───── Benefits ───── */}
      <section className="py-20 lg:py-28 bg-white border-y border-neutral-200/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal className="text-center max-w-2xl mx-auto mb-16">
            <div className="section-divider" />
            <h2 className="heading-display text-3xl sm:text-4xl lg:text-[2.85rem] leading-tight">A smarter way to shop</h2>
            <p className="mt-4 text-lg text-neutral-600">Built for people who think in outfits, not keywords.</p>
          </Reveal>

          <div className="grid md:grid-cols-3 gap-6 lg:gap-8">
            {benefits.map((b, i) => (
              <Reveal key={b.title} index={i}>
                <div className={`h-full rounded-3xl border-2 ${b.border} ${b.bg} p-8 text-center shadow-sm hover:shadow-lg hover:shadow-violet-500/10 hover:-translate-y-0.5 transition-all duration-300 backdrop-blur-[2px]`}>
                  <div className={`w-14 h-14 rounded-2xl ${b.iconWrap} flex items-center justify-center mx-auto mb-6`}>
                    <b.icon className="w-7 h-7" />
                  </div>
                  <h3 className="text-lg font-bold text-neutral-900 mb-3">{b.title}</h3>
                  <p className="text-neutral-600 leading-relaxed text-sm sm:text-base">{b.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ───── Shop the Look ───── */}
      <ShopTheLook />

      {/* ───── AI + side image ───── */}
      <section className="relative py-20 lg:py-28 bg-white overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <Reveal>
              <div className="section-divider-left" />
              <p className="section-eyebrow mb-3">AI-powered</p>
              <h2 className="heading-display text-3xl sm:text-4xl lg:text-[2.85rem] mb-5 leading-tight">
                Intelligence that understands style
              </h2>
              <p className="text-lg text-neutral-600 leading-relaxed mb-10 max-w-lg">
                From texture to silhouette, StyleAI reads what matters in an image — then surfaces pieces that feel right together.
              </p>
              <div className="space-y-5">
                {capabilities.map((c) => (
                  <Link
                    key={c.title}
                    href={c.href}
                    className={`group/cap flex gap-4 p-5 rounded-2xl bg-white border border-neutral-200/70 border-l-4 ${c.borderAccent} shadow-sm hover:shadow-md hover:shadow-violet-500/10 hover:-translate-x-1 transition-all duration-300`}
                  >
                    <div className={`shrink-0 w-12 h-12 rounded-xl bg-gradient-to-br ${c.gradient} flex items-center justify-center shadow-md`}>
                      <c.icon className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h3 className="font-bold text-neutral-900 mb-1 group-hover/cap:text-violet-700 transition-colors">{c.title}</h3>
                      <p className="text-neutral-600 text-sm leading-relaxed">{c.desc}</p>
                      <span className="inline-flex items-center gap-1.5 mt-2 text-xs font-semibold text-violet-600 group-hover/cap:gap-2.5 transition-all">
                        Try it <ArrowRight className="w-3 h-3" />
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </Reveal>
            <Reveal index={1}>
              <div className="relative aspect-[4/5] max-w-md mx-auto rounded-3xl overflow-hidden shadow-2xl shadow-violet-500/15 ring-1 ring-white/80 border border-neutral-200/60">
                <Image
                  src="https://images.unsplash.com/photo-1483985988355-763728e1935b?w=800&h=1000&fit=crop&q=80"
                  alt="Fashion styling"
                  fill
                  className="object-cover"
                  sizes="(max-width: 1024px) 90vw, 480px"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-violet-900/40 via-transparent to-fuchsia-500/10" />
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ───── Catalog + chart + image ───── */}
      <section className="py-20 lg:py-28 bg-neutral-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <Reveal className="order-2 lg:order-1">
              <div className="relative aspect-[4/5] max-w-md mx-auto lg:mx-0 rounded-3xl overflow-hidden shadow-2xl shadow-violet-500/15 ring-1 ring-white/80 border border-neutral-200/60">
                <Image
                  src="https://images.unsplash.com/photo-1441984904996-e0b6ba687e04?w=800&h=1000&fit=crop&q=80"
                  alt="Boutique assortment"
                  fill
                  className="object-cover"
                  sizes="(max-width: 1024px) 90vw, 480px"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-violet-900/50 via-transparent to-fuchsia-500/10" />
              </div>
            </Reveal>
            <Reveal className="order-1 lg:order-2">
              <div className="section-divider-left" />
              <p className="section-eyebrow mb-3">Catalog</p>
              <h2 className="heading-display text-3xl sm:text-4xl mb-5 leading-tight">Where the assortment leans</h2>
              <p className="text-lg text-neutral-600 leading-relaxed mb-8">
                Live facet data shows category density — a quick read on what you&apos;ll find most when you browse.
              </p>
              <div className="surface-card p-6 sm:p-8 mb-8">
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-md">
                    <TrendingUp className="w-5 h-5" />
                  </div>
                  <h3 className="text-lg font-bold text-neutral-900">Top categories</h3>
                </div>
                <CategoryChart />
              </div>
              <Link href="/products" className="btn-primary">Shop all categories</Link>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ───── CTA ───── */}
      <section className="py-16 lg:py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal>
            <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-violet-700 via-fuchsia-600 to-rose-500 shadow-2xl shadow-fuchsia-500/25 ring-1 ring-white/20">
              <div className="absolute inset-0 opacity-40">
                <Image
                  src="https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=1400&h=800&fit=crop&q=80"
                  alt=""
                  fill
                  className="object-cover mix-blend-overlay"
                  sizes="100vw"
                />
              </div>
              <div className="absolute inset-0 bg-gradient-to-r from-violet-900/88 via-fuchsia-900/72 to-rose-900/78" />
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_0%,rgba(255,255,255,0.12),transparent_50%)]" />
              <div className="relative grid lg:grid-cols-2 gap-10 items-center px-8 py-14 lg:px-16 lg:py-16 text-center lg:text-left">
                <div>
                  <h2 className="text-3xl sm:text-4xl lg:text-[2.5rem] font-display font-bold text-white tracking-tight drop-shadow-sm">
                    Ready when you are
                  </h2>
                  <p className="mt-4 text-white/90 text-lg max-w-md mx-auto lg:mx-0">
                    Jump into Discover or open your wardrobe — same account, same experience.
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-end">
                  <Link href="/search" className="btn-on-dark">Explore Discover</Link>
                  <Link href="/wardrobe" className="btn-on-dark-ghost">Open wardrobe</Link>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ───── Featured products ───── */}
      <section className="pb-24 lg:pb-32 pt-8 bg-neutral-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 mb-10 lg:mb-12">
            <Reveal>
              <div className="section-divider-left max-sm:mx-auto sm:mx-0" />
              <p className="section-eyebrow mb-2 max-sm:text-center">Curated</p>
              <h2 className="heading-display text-3xl sm:text-4xl max-sm:text-center leading-tight">Fresh from the catalog</h2>
            </Reveal>
            <Reveal index={1} className="max-sm:flex max-sm:justify-center">
              <Link href="/products" className="btn-secondary">
                View all products
                <ArrowRight className="w-4 h-4" />
              </Link>
            </Reveal>
          </div>
          <div className="rounded-[2rem] border border-neutral-200/70 bg-white/75 p-5 sm:p-7 lg:p-10 shadow-xl shadow-violet-500/[0.07] backdrop-blur-md ring-1 ring-white/50">
            <ProductGrid limit={8} />
          </div>
        </div>
      </section>
    </div>
  )
}
