'use client'

import Link from 'next/link'
import Image from 'next/image'
import { motion } from 'framer-motion'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useInView } from 'framer-motion'
import {
  ArrowUpRight,
  GitCompare,
  Heart,
  Layers,
  Search,
  Shirt,
  Sparkles,
  Lock,
  Timer,
  UserRound,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'
import type { Product } from '@/types/product'
import { formatStoredPriceAsUsd } from '@/lib/money/displayUsd'

/* ─────────────────────────────────────────────────────────────────────────────
   Palette tokens (kept inline for clarity — same set across the page)
     #f5f3f2  page wash
     #ece8e5  soft surface
     #d8d2cd  accent stone
     #c9c1ba  hairline / divider
     #b8aea5  muted icon
     #2a2623  ink
   ────────────────────────────────────────────────────────────────────────── */

const EASE_OUT = [0.22, 1, 0.36, 1] as const

/* ─────────────────────────────────────────────────────────────────────────────
   Data hooks (unchanged logic — keep features intact)
   ────────────────────────────────────────────────────────────────────────── */

function useProducts(limit = 8, offset = 0) {
  return useQuery({
    queryKey: ['home-products', limit, offset],
    queryFn: async () => {
      const page = Math.floor(offset / limit) + 1
      const res = await api.get<Product[]>(endpoints.products.list, { limit, page })
      const arr = Array.isArray(res?.data) ? (res.data as Product[]) : []
      const seen = new Set<number>()
      return arr.filter((p) => {
        if (p?.id == null || seen.has(p.id)) return false
        seen.add(p.id)
        return true
      })
    },
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  })
}

type FacetBucket = { value?: string; count?: number; key?: string; doc_count?: number }
type FacetsResponse = {
  brands?: FacetBucket[]
  categories?: FacetBucket[]
  styles?: FacetBucket[]
  /** From API `GET /products/facets` — OpenSearch hit total (not capped by facet bucket sizes). */
  totalProductCount?: number
}

function useCatalogStats() {
  return useQuery({
    queryKey: ['home-stats'],
    queryFn: async () => {
      const [facetsRes, salesRes] = await Promise.allSettled([
        api.get<FacetsResponse>(endpoints.products.facets),
        api.get<Product[]>(endpoints.products.sales, { limit: 1, page: 1 }),
      ])
      const facets = facetsRes.status === 'fulfilled' ? facetsRes.value?.data : undefined
      const sales = salesRes.status === 'fulfilled' ? salesRes.value : undefined

      const sumBuckets = (b?: FacetBucket[]) =>
        Array.isArray(b)
          ? b.reduce((s, x) => s + (Number(x.count ?? x.doc_count ?? 0) || 0), 0)
          : 0

      const sumFallback = Math.max(sumBuckets(facets?.categories), sumBuckets(facets?.brands))
      const fromApi = facets?.totalProductCount
      const totalProducts =
        typeof fromApi === 'number' && Number.isFinite(fromApi) && fromApi > 0 ? fromApi : sumFallback
      const brandsLen = Array.isArray(facets?.brands) ? facets!.brands!.length : 0
      const categoriesLen = Array.isArray(facets?.categories) ? facets!.categories!.length : 0
      const onSaleTotal =
        Number((sales as { pagination?: { total?: number }; meta?: { total?: number } } | undefined)?.pagination?.total ?? (sales as { meta?: { total?: number } } | undefined)?.meta?.total ?? 0) || 0

      return { totalProducts, brandsLen, categoriesLen, onSaleTotal }
    },
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    retry: 1,
  })
}

function formatPrice(p: Product) {
  const raw = typeof p.price_cents === 'string' ? parseInt(p.price_cents, 10) : p.price_cents
  const pc = Number.isFinite(raw as number) ? (raw as number) : 0
  if (pc <= 0) return null
  return formatStoredPriceAsUsd(pc, p.currency, { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function CountUp({ to, suffix = '', durationMs = 1400 }: { to: number; suffix?: string; durationMs?: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, margin: '-80px' })
  const [val, setVal] = useState(0)
  useEffect(() => {
    if (!inView) return
    const start = performance.now()
    let raf = 0
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / durationMs)
      const eased = 1 - Math.pow(1 - k, 3)
      setVal(Math.round(to * eased))
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [inView, to, durationMs])
  return (
    <span ref={ref}>
      {val.toLocaleString()}
      {suffix}
    </span>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
   Section primitives — editorial typography / spacing
   ────────────────────────────────────────────────────────────────────────── */

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10.5px] font-semibold uppercase tracking-[0.32em] text-[#736b65]">
      {children}
    </p>
  )
}

function SectionHead({
  eyebrow,
  title,
  href,
  hrefLabel = 'View all',
}: {
  eyebrow?: string
  title: string
  href?: string
  hrefLabel?: string
}) {
  return (
    <div className="flex items-end justify-between gap-4 mb-7 sm:mb-9">
      <div>
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <h2 className="mt-2 font-display text-[1.95rem] sm:text-[2.35rem] lg:text-[2.85rem] font-bold text-[#2a2623] leading-[1.05] tracking-tight">
          {title}
        </h2>
      </div>
      {href && (
        <Link
          href={href}
          className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#2a2623] hover:opacity-60 transition-opacity"
        >
          {hrefLabel}
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
   Hero — edge-to-edge photo: fills width + viewport band below nav (no side letterboxing).
   object-cover scales to cover the frame; focal point biased slightly up for family shots.
   ────────────────────────────────────────────────────────────────────────── */

const HERO_IMAGE = '/brand/tz-hero-family-wide.jpg'

const heroShortcuts = [
  { href: '/search?mode=shop', label: 'Shop the look', Icon: Sparkles },
  { href: '/search', label: 'Text search', Icon: Search },
  { href: '/wardrobe', label: 'Wardrobe', Icon: Shirt },
  { href: '/try-on', label: 'Try-on', Icon: Layers },
  { href: '/compare', label: 'Compare', Icon: GitCompare },
  { href: '/sales', label: 'Sale', Icon: Heart },
] as const

function Hero() {
  return (
    <section className="relative w-full bg-[#ece8e5]">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1.05, ease: EASE_OUT }}
        className="relative w-full pt-[72px]"
      >
        <div className="relative min-h-[calc(100svh-72px)] w-full overflow-hidden outline-none ring-0">
          <Image
            src={HERO_IMAGE}
            alt="Bolden family editorial — the new season for everyone"
            fill
            priority
            sizes="100vw"
            className="object-cover object-[center_38%] sm:object-[center_42%] outline-none focus:outline-none"
          />

          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(42,38,35,0.28)_0%,rgba(42,38,35,0.06)_42%,rgba(42,38,35,0.18)_72%,rgba(42,38,35,0.52)_100%)]"
          />

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, ease: EASE_OUT, delay: 0.12 }}
            className="absolute inset-0 flex items-end justify-start px-5 pb-10 pt-[76px] sm:px-10 sm:pb-12 lg:px-[48px]"
          >
            <div className="max-w-[min(32rem,92vw)] text-left">
              <p className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.32em] text-white/90 drop-shadow-[0_2px_16px_rgba(0,0,0,0.35)]">
                The studio lookbook
              </p>
              <h1
                className="mt-3 font-display font-bold leading-[0.98] tracking-[-0.04em] text-white drop-shadow-[0_4px_32px_rgba(0,0,0,0.45)] [text-shadow:0_2px_24px_rgba(0,0,0,0.35)]"
                style={{ fontSize: 'clamp(2.35rem, 6.2vw, 5rem)' }}
              >
                Where style meets confidence
              </h1>
            </div>
          </motion.div>
        </div>

        <div className="relative bg-[#f3f0ed] px-5 py-9 sm:px-10 lg:px-[48px] border-t border-[#e5ded8]/90">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 0.75, ease: EASE_OUT }}
            className="mx-auto max-w-[1100px]"
          >
            <p className="text-[15px] sm:text-[16px] font-medium leading-[1.75] text-[#2a2623] max-w-3xl">
              From refined shirts and trousers to tailoring you can live in — explore the edit, shop the look, try
              pieces on virtually, and compare what you love.
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link
                href="/products"
                className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-[10.5px] sm:text-[11px] font-semibold uppercase tracking-[0.24em] text-[#2a2623] ring-1 ring-[#2a2623]/12 shadow-[0_8px_28px_-12px_rgba(42,38,35,0.35)] hover:bg-[#faf8f6] transition-colors"
              >
                Explore collection
                <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2.25} />
              </Link>
              <Link
                href="/search?mode=shop"
                className="inline-flex items-center gap-2 rounded-full border-2 border-[#2a2623] bg-transparent px-6 py-3 text-[10.5px] sm:text-[11px] font-semibold uppercase tracking-[0.24em] text-[#2a2623] hover:bg-[#2a2623]/[0.04] transition-colors"
              >
                Shop the look
              </Link>
            </div>

            <div className="mt-8 flex flex-wrap gap-2.5 sm:gap-3">
              {heroShortcuts.map(({ href, label, Icon }) => (
                <Link
                  key={href + label}
                  href={href}
                  className="inline-flex items-center gap-2 rounded-full border border-[#2a2623]/85 bg-[#f3f0ed] px-4 py-2.5 text-[9.5px] sm:text-[10px] font-semibold uppercase tracking-[0.18em] text-[#2a2623] hover:bg-white hover:border-[#2a2623] transition-colors"
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 opacity-90" strokeWidth={2} aria-hidden />
                  {label}
                </Link>
              ))}
            </div>
          </motion.div>
        </div>
      </motion.div>
    </section>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
   Categories — clean, restrained card grid
   ────────────────────────────────────────────────────────────────────────── */

function Categories() {
  const items = [
    { label: 'Dress', href: '/products?category=dress', img: '/brand/tz-cat-dresses.jpg' },
    { label: 'Trousers', href: '/products?category=bottoms&q=trousers', img: '/brand/tz-cat-trousers.jpg' },
    { label: 'Tops', href: '/products?category=tops', img: '/brand/tz-cat-tops.png' },
    { label: 'Shoes', href: '/products?category=shoes', img: '/brand/tz-cat-shoes.jpg' },
  ]

  return (
    <section className="px-4 sm:px-6 lg:px-10 py-8 lg:py-12">
      <SectionHead eyebrow="Product categories" title="Dress, tops, trousers & shoes" href="/products" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {items.map((c, i) => (
          <motion.div
            key={c.label}
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.7, delay: i * 0.04, ease: EASE_OUT }}
          >
            <Link
              href={c.href}
              className="group block relative aspect-[4/5] overflow-hidden rounded-[10px] ring-1 ring-[#d8d2cd] bg-[#ece8e5]"
            >
              <Image
                src={c.img}
                alt={`${c.label} category`}
                fill
                sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 16vw"
                className="object-cover transition-transform duration-[1100ms] ease-out group-hover:scale-[1.04]"
              />
              <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_55%,rgba(42,38,35,0.55)_100%)]" />
              <span className="absolute bottom-3 left-3 text-white text-[11px] sm:text-[12px] font-bold uppercase tracking-[0.26em] drop-shadow-[0_2px_8px_rgba(0,0,0,0.35)]">
                {c.label}
              </span>
            </Link>
          </motion.div>
        ))}
      </div>
    </section>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
   About Us — image + story, replaces the old "Modern Woman" block
   ────────────────────────────────────────────────────────────────────────── */

function AboutUs() {
  return (
    <section className="px-4 sm:px-6 lg:px-10 py-10 lg:py-20">
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-100px' }}
        transition={{ duration: 0.95, ease: EASE_OUT }}
        className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-14 items-center"
      >
        <div className="lg:col-span-6 relative aspect-[4/5] sm:aspect-[5/6] lg:aspect-[4/5] overflow-hidden rounded-[14px] ring-1 ring-[#d8d2cd] bg-[#ece8e5]">
            <Image
            src="/brand/tz-editorial-couple.jpg"
            alt="Bolden — about the studio"
            fill
            sizes="(max-width: 1024px) 100vw, 50vw"
            className="object-cover transition-transform duration-[1400ms] ease-out hover:scale-[1.03]"
          />
        </div>
        <div className="lg:col-span-6">
          <Eyebrow>About us</Eyebrow>
          <h2
            className="mt-5 font-display font-bold text-[#2a2623] leading-[0.96] tracking-[-0.03em]"
            style={{ fontSize: 'clamp(2.5rem, 5.5vw, 5rem)' }}
          >
            The house of
            <br />
            <span className="italic font-semibold">Bolden.</span>
          </h2>
          <div className="mt-7 grid sm:grid-cols-2 gap-6 sm:gap-8 text-[14px] sm:text-[15px] font-medium leading-[1.72] text-[#3d3935]">
            <p>
              Bolden is a modern fashion marketplace built around discovery. We bring together
              considered designers, AI-assisted search, virtual try-on and shop-the-look tools so
              every shopper finds pieces that genuinely belong in their wardrobe.
            </p>
            <p>
              From quiet tailoring to relaxed everyday essentials, every piece is selected for
              craft, fit and longevity — because great clothing should outlast the season it was
              bought in. This is fashion, the way it should feel: personal, effortless, yours.
            </p>
          </div>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              href="/products"
              className="inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-white hover:bg-brand-hover transition-colors"
            >
              Shop the studio
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
            <Link
              href="/search?mode=shop"
              className="inline-flex items-center gap-2 rounded-full border-2 border-brand bg-white px-5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-brand hover:bg-brand-muted transition-colors"
            >
              Discover the tools
            </Link>
          </div>
        </div>
    </motion.div>
    </section>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
   Virtual Try-On — full mockup section (standalone)
   ────────────────────────────────────────────────────────────────────────── */

function VirtualTryOnShowcase() {
  const highlights = [
    { Icon: Sparkles, text: 'Get the perfect fit, every time.' },
    { Icon: UserRound, text: 'Realistic AI try-on' },
    { Icon: Timer, text: 'Instant results' },
    { Icon: Lock, text: 'Secure & private' },
  ]

  return (
    <section className="px-4 sm:px-6 lg:px-10 py-12 lg:py-20 bg-[#ece8e5]">
      <motion.div
        initial={{ opacity: 0, y: 28 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.85, ease: EASE_OUT }}
      >
        <Eyebrow>Virtual try-on</Eyebrow>
        <div className="mt-3 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
          <div className="max-w-2xl">
            <h2
              className="font-display font-bold text-[#2a2623] tracking-[-0.03em] leading-[1.05]"
              style={{ fontSize: 'clamp(1.85rem, 4vw, 3rem)' }}
            >
              See how clothes look on you before you buy.
            </h2>
            <p className="mt-4 text-[14px] sm:text-[15px] font-medium leading-[1.7] text-[#4a4540]">
              Upload a photo, pick a garment from the catalog, and preview a realistic composite — right in the browser.
            </p>
          </div>
          <Link
            href="/try-on"
            className="inline-flex shrink-0 items-center gap-2 rounded-full bg-brand px-6 py-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-white hover:bg-brand-hover transition-colors shadow-[0_12px_36px_-16px_rgba(61,48,48,0.33)]"
          >
            Open virtual try-on
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="mt-10 relative overflow-hidden rounded-[18px] bg-[#f5f3f2] ring-1 ring-[#d8d2cd] shadow-[0_24px_80px_-32px_rgba(42,38,35,0.35)]">
          <Image
            src="/brand/tz-home-virtual-tryon-showcase.jpg"
            alt="Virtual Try-On interface: upload your photo, select a garment, and preview the AI try-on result"
            width={1024}
            height={562}
            className="w-full h-auto block"
            sizes="(max-width: 1400px) 100vw, 1320px"
            priority={false}
          />
        </div>

        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {highlights.map(({ Icon, text }) => (
            <div
              key={text}
              className="flex items-start gap-3 rounded-xl bg-[#f5f3f2]/90 px-4 py-3.5 ring-1 ring-[#d8d2cd]/80"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white ring-1 ring-[#d8d2cd] text-[#2a2623]">
                <Icon className="h-4 w-4" strokeWidth={2} />
              </span>
              <p className="text-[13px] font-semibold leading-snug text-[#2a2623] pt-1">{text}</p>
            </div>
          ))}
      </div>
      </motion.div>
    </section>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
   Visual Search — full mockup section (standalone)
   ────────────────────────────────────────────────────────────────────────── */

function VisualSearchShowcase() {
  return (
    <section className="px-4 sm:px-6 lg:px-10 py-12 lg:py-20 bg-[#f5f3f2]">
      <motion.div
        initial={{ opacity: 0, y: 28 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.85, ease: EASE_OUT }}
      >
        <Eyebrow>Visual search</Eyebrow>
        <div className="mt-3 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
          <div className="max-w-2xl">
            <h2
              className="font-display font-bold text-[#2a2623] tracking-[-0.03em] leading-[1.05]"
              style={{ fontSize: 'clamp(1.85rem, 4vw, 3rem)' }}
            >
              Snap a look. Find the closest pieces in our catalog.
            </h2>
            <p className="mt-4 text-[14px] sm:text-[15px] font-medium leading-[1.7] text-[#4a4540]">
              Match silhouettes, textures and colours from any photo — ideal for shop-the-look and in-store inspiration.
            </p>
          </div>
          <Link
            href="/search?mode=shop"
            className="inline-flex shrink-0 items-center gap-2 rounded-full bg-white px-6 py-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-brand ring-2 ring-brand hover:bg-brand-muted transition-colors"
          >
            <Search className="h-3.5 w-3.5" />
            Try visual search
          </Link>
        </div>

        <div className="mt-10 relative overflow-hidden rounded-[18px] bg-[#ece8e5] ring-1 ring-[#d8d2cd] shadow-[0_24px_80px_-32px_rgba(42,38,35,0.3)]">
          <Image
            src="/brand/tz-home-visual-search-showcase.jpg"
            alt="Visual Search interface: product detail, styled model with scan frame, and similar recommended pieces"
            width={1024}
            height={579}
            className="w-full h-auto block"
            sizes="(max-width: 1400px) 100vw, 1320px"
            priority={false}
          />
        </div>
      </motion.div>
    </section>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
   Services — clean four-card grid (Text search, Try-On, Shop the Look, Compare)
   ────────────────────────────────────────────────────────────────────────── */

function Services() {
  const items = [
    {
      title: 'Text Search',
      desc: 'Type brands, styles, colours or occasions — our catalog search understands natural language and brings back ranked matches in seconds.',
      img: '/brand/tz-home-text-search-lifestyle.jpg',
      href: '/search',
    },
    {
      title: 'Virtual Try-On',
      desc: 'Step in front of the mirror — change the size, the colour, the silhouette. See exactly how a piece falls on you before you commit, from any device.',
      img: '/brand/tz-service-tryon-mirror.jpg',
      href: '/try-on',
    },
    {
      title: 'Shop the Look',
      desc: 'Capture an outfit you love and we will rebuild it head-to-toe from our edits. Tops, bottoms, shoes, accessories — completed for you, in your style.',
      img: '/brand/tz-service-shop-the-look.jpg',
      href: '/search?mode=shop',
    },
    {
      title: 'Compare',
      desc: 'Stack pieces side by side — fabric, fit, price and reviews — so you can decide between two looks with confidence before you commit to one.',
      img: '/brand/tz-home-compare-lifestyle.png',
      href: '/compare',
    },
  ]

  return (
    <section className="px-4 sm:px-6 lg:px-10 py-8 lg:py-12">
      <SectionHead eyebrow="Our services" title="Four ways to shop smarter" />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        {items.map((s, i) => (
              <motion.div
            key={s.title}
            initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.8, delay: i * 0.06, ease: EASE_OUT }}
            className="group rounded-[10px] ring-1 ring-[#d8d2cd] bg-white overflow-hidden"
          >
            <Link href={s.href} className="block">
              <div className="relative aspect-[4/3] overflow-hidden bg-[#ece8e5]">
                <Image
                  src={s.img}
                  alt={s.title}
                  fill
                  sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 25vw"
                  className="object-cover transition-transform duration-[1100ms] ease-out group-hover:scale-[1.03]"
                />
              </div>
              <div className="p-5 sm:p-6">
                <p className="text-[11px] font-bold uppercase tracking-[0.32em] text-[#2a2623]">
                  {s.title}
                </p>
                <p className="mt-3 text-[14px] font-medium leading-[1.72] text-[#4a4540]">{s.desc}</p>
              </div>
            </Link>
              </motion.div>
        ))}
      </div>
    </section>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
   Featured products — calm grid (uses existing API)
   ────────────────────────────────────────────────────────────────────────── */

function featuredProductImageSrc(p: Product): string {
  return String(p.image_cdn || p.image_url || '').trim()
}

function FeaturedProductTile({
  product,
  index,
  onImageFailed,
}: {
  product: Product
  index: number
  onImageFailed: (id: number) => void
}) {
  const img = featuredProductImageSrc(product)
  const price = formatPrice(product)
  if (!img) return null

  return (
      <motion.div
      initial={{ opacity: 0, y: 14 }}
        whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.7, delay: index * 0.04, ease: EASE_OUT }}
      className="group"
    >
      <Link href={`/products/${product.id}`} className="block">
        <div className="relative aspect-[3/4] overflow-hidden rounded-[10px] ring-1 ring-[#d8d2cd] bg-[#ece8e5]">
          <Image
            src={img}
            alt={product.title || 'Product image'}
            fill
            sizes="(max-width: 640px) 50vw, 25vw"
            className="object-cover transition-transform duration-[1100ms] ease-out group-hover:scale-[1.04]"
            onError={() => onImageFailed(product.id)}
          />
        </div>
        <div className="mt-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[12px] font-semibold uppercase tracking-[0.16em] text-[#2a2623]">
              {product.title}
            </p>
            {(product.brand || product.category) && (
              <p className="mt-1 truncate text-[11px] text-[#736b65]">
                {product.brand}
                {product.brand && product.category ? ' · ' : ''}
                {product.category}
              </p>
            )}
          </div>
          {price && (
            <p className="text-[12px] font-semibold tabular-nums text-[#2a2623] whitespace-nowrap">
              {price}
            </p>
          )}
        </div>
      </Link>
      </motion.div>
  )
}

function FeaturedProducts() {
  /** Extra rows so we can drop broken/missing images and still fill up to four slots. */
  const featured = useProducts(32, 0)
  const list = featured.data ?? []
  const [failedIds, setFailedIds] = useState(() => new Set<number>())

  const markFailed = useCallback((id: number) => {
    setFailedIds((prev) => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }, [])

  const slots = useMemo(
    () => list.filter((p) => featuredProductImageSrc(p) && !failedIds.has(p.id)).slice(0, 4),
    [list, failedIds],
  )

  const loading = featured.isPending || list.length === 0

  return (
    <section className="px-4 sm:px-6 lg:px-10 py-8 lg:py-12">
      <SectionHead eyebrow="Curated edit" title="Featured products" href="/products" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5 lg:gap-7">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="aspect-[3/4] rounded-[10px] bg-[#ece8e5] ring-1 ring-[#d8d2cd]" />
            ))
          : slots.map((p, i) => (
              <FeaturedProductTile key={p.id} product={p} index={i} onImageFailed={markFailed} />
            ))}
      </div>
      {!loading && slots.length === 0 ? (
        <p className="mt-6 text-center text-sm text-[#736b65]">No highlighted products available right now.</p>
      ) : null}
    </section>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
   Numbers (kept — quiet typography)
   ────────────────────────────────────────────────────────────────────────── */

function Numbers() {
  const { data, isLoading } = useCatalogStats()

  const items = [
    { topNum: data?.totalProducts ?? 0, label: 'Products in catalog' },
    { topNum: data?.brandsLen ?? 0, label: 'Curated brands' },
    { topNum: data?.categoriesLen ?? 0, label: 'Live categories' },
    { topNum: data?.onSaleTotal ?? 0, label: 'Items on sale now' },
  ]

  return (
    <section className="px-4 sm:px-6 lg:px-10 py-8 lg:py-12">
      <SectionHead eyebrow="By the numbers" title="A studio, in motion" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-10 border-t border-[#d8d2cd] pt-8">
        {items.map((it, i) => (
            <motion.div
            key={i}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.7, delay: i * 0.06, ease: EASE_OUT }}
          >
            <p
              className="font-display font-semibold text-[#2a2623] tracking-[-0.02em] leading-none"
              style={{ fontSize: 'clamp(2rem, 4vw, 3rem)' }}
            >
              {isLoading ? <span className="text-[#b8aea5]">···</span> : <CountUp to={it.topNum} />}
            </p>
            <p className="mt-3 text-[10.5px] font-semibold uppercase tracking-[0.32em] text-[#736b65]">
              {it.label}
            </p>
            </motion.div>
          ))}
      </div>
    </section>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
   Closing wordmark — quiet, single panel
   ────────────────────────────────────────────────────────────────────────── */

function Closing() {
  return (
    <section className="px-4 sm:px-6 lg:px-10 py-10 lg:py-16">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-100px' }}
        transition={{ duration: 0.9, ease: EASE_OUT }}
        className="text-center"
      >
        <Eyebrow>Bolden</Eyebrow>
        <h2
          className="mt-4 font-display font-semibold text-[#c9c1ba] tracking-[-0.04em] leading-none select-none"
          style={{ fontSize: 'clamp(3.5rem, 14vw, 12rem)' }}
              >
                BOLDEN
              </h2>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
          <Link
            href="/products"
            className="inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-white hover:bg-brand-hover transition-colors"
          >
            Shop now
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
          <Link
            href="/sales"
            className="inline-flex items-center gap-2 rounded-full border-2 border-brand bg-white px-5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-brand hover:bg-brand-muted transition-colors"
          >
            Sale
          </Link>
        </div>
      </motion.div>
    </section>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────
   Page
   ────────────────────────────────────────────────────────────────────────── */

export default function HomePage() {
  return (
    <div className="overflow-x-hidden bg-[#f5f3f2]">
      <Hero />
      <Categories />
      <AboutUs />
      <VirtualTryOnShowcase />
      <VisualSearchShowcase />
      <Services />
      <FeaturedProducts />
      <Numbers />
      <Closing />
    </div>
  )
}
