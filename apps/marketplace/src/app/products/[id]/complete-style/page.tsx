'use client'

import { useParams, useRouter } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowLeft,
  Shirt,
  Sparkles,
  ShoppingBag,
  Wand2,
  Heart,
  ScanLine,
  Layers,
  Plus,
} from 'lucide-react'
import { api } from '@/lib/api/client'
import { endpoints } from '@/lib/api/endpoints'
import { useAuthStore } from '@/store/auth'
import { useCompareStore } from '@/store/compare'
import { formatStoredPriceAsUsd } from '@/lib/money/displayUsd'

interface CategoryRec {
  category: string
  reason: string
  priority: number
  priorityLabel: string
  products: Array<{
    id?: number
    product_id?: number
    title: string
    brand?: string
    price?: number
    price_cents?: number
    currency?: string
    image?: string
    matchScore?: number
    matchReasons?: string[]
  }>
}

interface CompleteStyleData {
  sourceProduct: {
    id: number
    title: string
    image_cdn?: string
    image_url?: string
    category?: string
    price_cents?: number
    currency?: string
  }
  detectedCategory: string
  style?: { occasion?: string; aesthetic?: string; season?: string; formality?: number }
  outfitSuggestion?: string
  recommendations: CategoryRec[]
  totalRecommendations: number
}

const ACCENT = '#5D4037'
const CREAM = '#F9F6F1'
const INK = '#3E2723'

function formatPrice(storedCents: number, currency?: string | null) {
  return formatStoredPriceAsUsd(storedCents, currency, { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function resolveNumericId(p: { id?: number; product_id?: number }): number | null {
  const n = Number(p.id ?? p.product_id)
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : null
}

function toProductCard(p: CategoryRec['products'][0]) {
  const pid = resolveNumericId(p) ?? 0
  const cents = typeof p.price === 'number' && Number.isFinite(p.price) ? p.price : p.price_cents
  const price_cents = typeof cents === 'number' && Number.isFinite(cents) ? Math.round(cents) : 0
  return {
    id: pid,
    title: p.title,
    brand: p.brand,
    price_cents,
    currency: p.currency || 'USD',
    image_cdn: p.image,
    image_url: p.image,
  }
}

const EASE = [0.22, 1, 0.36, 1] as const

const HOW_STEPS = [
  {
    title: 'Select an item',
    desc: 'Choose any piece you love from the catalog.',
    Icon: Shirt,
  },
  {
    title: 'AI analyzes',
    desc: 'Our model reads category, style, and occasion.',
    Icon: Sparkles,
  },
  {
    title: 'Get recommendations',
    desc: 'Personalized picks that complete the outfit.',
    Icon: Layers,
  },
  {
    title: 'Complete your look',
    desc: 'See shoes, bags, and layers that belong together.',
    Icon: ScanLine,
  },
  {
    title: 'Shop with ease',
    desc: 'Open products or add several to Compare.',
    Icon: ShoppingBag,
  },
] as const

function MiniOrbitCard({
  card,
  delay,
}: {
  card: ReturnType<typeof toProductCard>
  delay: number
}) {
  const shot = card.image_cdn || card.image_url || ''
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.45, delay, ease: EASE }}
    >
      <Link
        href={`/products/${card.id}`}
        className="group relative block w-[76px] sm:w-[88px] rounded-xl border-2 border-dashed border-[#8D6E63]/45 bg-white/90 p-1.5 shadow-[0_8px_24px_-12px_rgba(62,39,35,0.2)] ring-1 ring-[#5D4037]/10 transition-all hover:border-[#5D4037]/55 hover:shadow-md"
      >
        <div className="relative aspect-[3/4] w-full overflow-hidden rounded-lg bg-[#efe8e0]">
          {shot ? (
            <Image src={shot} alt="" fill className="object-cover" sizes="88px" />
          ) : null}
        </div>
        <span
          className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border border-[#5D4037]/20 bg-[#5D4037] text-white shadow-md"
          aria-hidden
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
        </span>
      </Link>
    </motion.div>
  )
}

function PhoneMockup({
  productId,
  sourceTitle,
  sourcePrice,
  sourceImg,
  flat,
  onAddAll,
}: {
  productId: string
  sourceTitle: string
  sourcePrice: string | null
  sourceImg: string
  flat: ReturnType<typeof toProductCard>[]
  onAddAll: () => void
}) {
  const grid = flat.slice(0, 6)
  return (
    <div className="mx-auto w-full max-w-[300px] shrink-0">
      <div
        className="rounded-[2.5rem] border-[10px] border-[#2a2623]/12 bg-[#1a1514] p-2 shadow-[0_32px_64px_-24px_rgba(62,39,35,0.45)]"
        style={{ boxShadow: `0 24px 48px -16px rgba(62,39,35,0.25), inset 0 1px 0 rgba(255,255,255,0.06)` }}
      >
        <div className="overflow-hidden rounded-[2rem] bg-[#F9F6F1]">
          <div className="flex items-center justify-between border-b border-[#5D4037]/10 px-4 py-3">
            <Link
              href={`/products/${productId}`}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white text-[#5D4037] shadow-sm ring-1 ring-[#5D4037]/10 transition hover:bg-[#efe8e0]"
              aria-label="Back to product"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
            </Link>
            <p className="font-display text-[13px] font-semibold text-[#3E2723]">Complete the Style</p>
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white text-[#5D4037] shadow-sm ring-1 ring-[#5D4037]/10">
              <Heart className="h-4 w-4" aria-hidden />
            </span>
          </div>
          <div className="max-h-[min(68vh,520px)] overflow-y-auto px-3 pb-4 pt-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#5D4037]/80">Your item</p>
            <div className="mt-2 flex gap-3 rounded-2xl border border-[#5D4037]/12 bg-white p-2.5 shadow-sm">
              <div className="relative h-20 w-16 shrink-0 overflow-hidden rounded-xl bg-[#efe8e0] ring-1 ring-[#5D4037]/10">
                <Image src={sourceImg} alt="" fill className="object-cover" sizes="64px" />
              </div>
              <div className="min-w-0 flex-1 pt-0.5">
                <p className="text-[11px] font-semibold leading-snug text-[#3E2723] line-clamp-2">{sourceTitle}</p>
                {sourcePrice ? (
                  <p className="mt-1 font-display text-sm font-bold tabular-nums text-[#5D4037]">{sourcePrice}</p>
                ) : null}
                <Heart className="mt-2 h-4 w-4 text-[#8D6E63]" aria-hidden />
              </div>
            </div>
            <p className="mt-5 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#5D4037]/80">AI recommendations</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {grid.map((card) => {
                const shot = card.image_cdn || card.image_url || ''
                const price =
                  card.price_cents > 0 ? formatPrice(card.price_cents, card.currency) : null
                return (
                  <Link
                    key={card.id}
                    href={`/products/${card.id}`}
                    className="overflow-hidden rounded-xl border border-[#5D4037]/10 bg-white shadow-sm transition hover:ring-2 hover:ring-[#5D4037]/20"
                  >
                    <div className="relative aspect-[3/4] w-full bg-[#efe8e0]">
                      {shot ? <Image src={shot} alt="" fill className="object-cover" sizes="120px" /> : null}
                    </div>
                    <div className="p-2">
                      <p className="line-clamp-2 text-[10px] font-medium leading-tight text-[#3E2723]">{card.title}</p>
                      {price ? (
                        <p className="mt-1 font-display text-[11px] font-bold tabular-nums text-[#5D4037]">{price}</p>
                      ) : null}
                    </div>
                  </Link>
                )
              })}
            </div>
            <button
              type="button"
              onClick={onAddAll}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-full py-3 text-[12px] font-semibold text-[#F9F6F1] shadow-md transition hover:opacity-95 active:scale-[0.99]"
              style={{ backgroundColor: ACCENT }}
            >
              <ShoppingBag className="h-4 w-4" aria-hidden />
              Add all to Compare
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function CompleteStylePage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string
  const productId = parseInt(id, 10)
  const isAuth = useAuthStore((s) => s.isAuthenticated())
  const compareAdd = useCompareStore((s) => s.add)

  const wardrobeQuery = useQuery({
    queryKey: ['complete-style', 'wardrobe-product', id],
    queryFn: async () => {
      const res = await api.get<CompleteStyleData>(endpoints.products.completeStyle(id), {
        maxPerCategory: 6,
        maxTotal: 24,
      })
      if (res.success === false) {
        throw new Error(res.error?.message ?? 'Could not load outfit suggestions')
      }
      const d = res.data
      if (!d) throw new Error('No outfit data returned')
      return d
    },
    enabled: !!id && Number.isFinite(productId) && productId >= 1 && isAuth,
  })

  const fallbackQuery = useQuery({
    queryKey: ['complete-style', 'catalog', id],
    queryFn: async () => {
      const res = await api.get<CompleteStyleData>(endpoints.products.completeStyle(id), {
        maxPerCategory: 6,
        maxTotal: 24,
      })
      if (res.success === false) {
        throw new Error(res.error?.message ?? 'Could not load outfit suggestions')
      }
      const d = res.data
      if (!d) throw new Error('No outfit data returned')
      return d
    },
    enabled: !!id && Number.isFinite(productId) && productId >= 1 && !isAuth,
  })

  const data = isAuth ? wardrobeQuery.data : fallbackQuery.data
  const isLoading = isAuth ? wardrobeQuery.isLoading : fallbackQuery.isLoading
  const isError = isAuth ? wardrobeQuery.isError : fallbackQuery.isError
  const error = isAuth ? wardrobeQuery.error : fallbackQuery.error

  const flatProducts = useMemo(() => {
    const d = wardrobeQuery.data ?? fallbackQuery.data
    if (!d) return []
    const out: ReturnType<typeof toProductCard>[] = []
    for (const rec of d.recommendations) {
      for (const p of rec.products) {
        if (resolveNumericId(p) == null) continue
        out.push(toProductCard(p))
      }
    }
    const seen = new Set<number>()
    return out.filter((c) => {
      if (seen.has(c.id)) return false
      seen.add(c.id)
      return true
    })
  }, [wardrobeQuery.data, fallbackQuery.data])

  const addAllToCompare = () => {
    let n = 0
    for (const c of flatProducts) {
      if (n >= 5) break
      compareAdd(c.id)
      n++
    }
    router.push('/compare')
  }

  if (isLoading) {
    return (
      <div className="min-h-screen" style={{ backgroundColor: CREAM }}>
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="h-9 w-40 animate-pulse rounded-full bg-[#5D4037]/10" />
          <div className="mt-12 grid gap-10 lg:grid-cols-2">
            <div className="space-y-4">
              <div className="h-6 w-24 animate-pulse rounded-full bg-[#5D4037]/10" />
              <div className="h-14 w-full max-w-md animate-pulse rounded-lg bg-[#5D4037]/8" />
              <div className="h-24 w-full max-w-lg animate-pulse rounded-lg bg-[#5D4037]/8" />
            </div>
            <div className="mx-auto aspect-[9/19] w-full max-w-[280px] animate-pulse rounded-[2.5rem] bg-[#5D4037]/10" />
          </div>
        </div>
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="min-h-screen px-4 py-24 text-center" style={{ backgroundColor: CREAM }}>
        <p className="font-medium text-[#3E2723]">{(error as Error)?.message ?? 'Failed to load outfit suggestions'}</p>
        <Link
          href={`/products/${id}`}
          className="mt-6 inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold text-[#F9F6F1] transition hover:opacity-95"
          style={{ backgroundColor: ACCENT }}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to product
        </Link>
      </div>
    )
  }

  const source = data.sourceProduct
  const imgUrl = source.image_cdn || source.image_url || 'https://placehold.co/600x800/efe8e0/5D4037?text=Bolden'
  const sourcePrice =
    typeof source.price_cents === 'number' && source.price_cents > 0
      ? formatPrice(source.price_cents, source.currency || 'USD')
      : null

  const orbitCards = flatProducts.slice(0, 6)

  const features = [
    {
      Icon: Wand2,
      title: 'Smart suggestions',
      desc: 'AI recommends what goes best with your selected item.',
    },
    {
      Icon: ShoppingBag,
      title: 'Perfect matches',
      desc: 'Find pieces that fit your style, occasion, and preferences.',
    },
    {
      Icon: Shirt,
      title: 'Complete looks',
      desc: 'Build a coordinated outfit without guesswork.',
    },
  ] as const

  return (
    <div className="min-h-screen pb-20" style={{ backgroundColor: CREAM }}>
      <div className="border-b border-[#5D4037]/10 bg-[#F9F6F1]/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <Link
            href={`/products/${id}`}
            className="inline-flex items-center gap-2 text-sm font-medium text-[#5D4037] transition hover:text-[#3E2723]"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
          <p className="hidden text-xs font-medium uppercase tracking-[0.2em] text-[#8D6E63] sm:block">
            {isAuth ? 'Wardrobe-aware' : 'Catalog'} · AI styling
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 pt-12 sm:px-6 lg:pt-16">
        <div className="grid items-start gap-14 lg:grid-cols-12 lg:gap-10">
          <div className="lg:col-span-7">
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }}>
              <span
                className="inline-flex items-center rounded-full border border-[#5D4037]/20 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em]"
                style={{ color: ACCENT }}
              >
                New feature
              </span>
              <h1 className="mt-5 font-display text-[2.35rem] font-bold leading-[1.05] tracking-[-0.03em] sm:text-[2.85rem] lg:text-[3.15rem]" style={{ color: INK }}>
                Complete the Style
              </h1>
              <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-[#5D4037]/90 sm:text-lg">
                Get AI-powered outfit recommendations that complete your look perfectly.
              </p>

              <ul className="mt-10 space-y-6">
                {features.map(({ Icon, title, desc }, i) => (
                  <motion.li
                    key={title}
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.45, delay: 0.08 + i * 0.06, ease: EASE }}
                    className="flex gap-4"
                  >
                    <span
                      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[#5D4037]/15 bg-white shadow-sm"
                      style={{ color: ACCENT }}
                    >
                      <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden />
                    </span>
                    <div>
                      <p className="font-display text-lg font-semibold text-[#3E2723]">{title}</p>
                      <p className="mt-1 text-sm leading-relaxed text-[#6D4C41]/95">{desc}</p>
                    </div>
                  </motion.li>
                ))}
              </ul>
            </motion.div>

            {/* Flat-lay orbit — compact on mobile */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.12, ease: EASE }}
              className="relative mt-10 lg:hidden"
            >
              <p className="mb-4 text-center text-[10px] font-semibold uppercase tracking-[0.28em] text-[#8D6E63]">
                Your board
              </p>
              <div className="-mx-1 flex gap-3 overflow-x-auto pb-2 scrollbar-none">
                {orbitCards.map((c, i) => (
                  <MiniOrbitCard key={c.id} card={c} delay={0.04 * i} />
                ))}
              </div>
            </motion.div>

            {/* Flat-lay orbit (desktop) */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.12, ease: EASE }}
              className="relative mt-14 hidden lg:block"
            >
              <p className="mb-8 text-center text-[10px] font-semibold uppercase tracking-[0.28em] text-[#8D6E63]">
                Your board
              </p>
              <div className="relative mx-auto flex max-w-xl flex-col items-center gap-8">
                <div className="flex justify-center gap-6">
                  {orbitCards.slice(0, 3).map((c, i) => (
                    <MiniOrbitCard key={c.id} card={c} delay={0.05 * i} />
                  ))}
                </div>
                <div className="relative w-[min(100%,280px)] aspect-[3/4]">
                  <div
                    className="absolute inset-0 rounded-[28px] border-2 border-dashed border-[#8D6E63]/35 bg-white/60 shadow-[0_20px_50px_-24px_rgba(62,39,35,0.25)]"
                    aria-hidden
                  />
                  <div className="relative h-full overflow-hidden rounded-[26px] ring-1 ring-[#5D4037]/10">
                    <Image src={imgUrl} alt={source.title} fill className="object-cover" sizes="280px" priority />
                  </div>
                </div>
                <div className="flex justify-center gap-6">
                  {orbitCards.slice(3, 6).map((c, i) => (
                    <MiniOrbitCard key={c.id} card={c} delay={0.08 + 0.05 * i} />
                  ))}
                </div>
              </div>
            </motion.div>
          </div>

          <div className="lg:col-span-5">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.1, ease: EASE }}
              className="lg:sticky lg:top-24"
            >
              <PhoneMockup
                productId={id}
                sourceTitle={source.title}
                sourcePrice={sourcePrice}
                sourceImg={imgUrl}
                flat={flatProducts}
                onAddAll={addAllToCompare}
              />
              <p className="mt-4 text-center text-[11px] text-[#8D6E63]">
                Preview only — scroll for full categories &amp; links.
              </p>
              <button
                type="button"
                onClick={() => addAllToCompare()}
              className="mx-auto mt-3 hidden w-full max-w-[300px] items-center justify-center gap-2 rounded-full bg-[#5D4037] py-3 text-sm font-semibold text-[#F9F6F1] shadow-md transition hover:bg-[#4E342E] lg:flex"
            >
                <ShoppingBag className="h-4 w-4" aria-hidden />
                Add all to Compare
              </button>
            </motion.div>
          </div>
        </div>
      </div>

      {/* Recommendations — full width section */}
      <section id="outfit-recommendations" className="mx-auto mt-20 max-w-6xl px-4 sm:px-6 lg:mt-28">
        {data.outfitSuggestion ? (
          <div className="mb-10 rounded-2xl border border-[#5D4037]/12 bg-white/80 p-5 shadow-sm backdrop-blur-sm">
            <p className="text-sm font-medium leading-relaxed text-[#4E342E]">{data.outfitSuggestion}</p>
          </div>
        ) : null}

        <div className="mb-8 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[#8D6E63]">Your selection</p>
            <h2 className="mt-2 font-display text-2xl font-bold text-[#3E2723] sm:text-3xl">Outfit picks</h2>
            <p className="mt-1 text-sm text-[#6D4C41]">
              Styling for <span className="font-semibold text-[#3E2723]">{source.title}</span>
              {data.detectedCategory ? <span className="text-[#8D6E63]"> · {data.detectedCategory}</span> : null}
            </p>
          </div>
          <button
            type="button"
            onClick={() => addAllToCompare()}
            className="inline-flex shrink-0 items-center justify-center gap-2 self-start rounded-full bg-[#5D4037] px-5 py-2.5 text-sm font-semibold text-[#F9F6F1] shadow-md transition hover:bg-[#4E342E] sm:self-auto"
          >
            <ShoppingBag className="h-4 w-4" />
            Add all to Compare
          </button>
        </div>

        <div className="grid gap-12 lg:grid-cols-12">
          <div className="lg:col-span-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#8D6E63]">Your item</p>
            <div className="relative mt-3 aspect-[3/4] overflow-hidden rounded-2xl border border-[#5D4037]/10 bg-white shadow-[0_12px_40px_-20px_rgba(62,39,35,0.2)]">
              <Image src={imgUrl} alt={source.title} fill className="object-cover" sizes="(max-width:1024px) 100vw, 280px" />
            </div>
            <p className="mt-3 font-display text-lg font-semibold text-[#3E2723]">{source.title}</p>
            {sourcePrice ? <p className="mt-1 font-display text-base font-bold text-[#5D4037]">{sourcePrice}</p> : null}
          </div>

          <div className="space-y-12 lg:col-span-9">
            {data.recommendations.map((rec, idx) => (
              <section key={`${rec.category}-${idx}`}>
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <Shirt className="h-5 w-5 text-[#5D4037]" aria-hidden />
                  <h3 className="font-display text-xl font-bold text-[#3E2723]">{rec.category}</h3>
                  <span className="rounded-full border border-[#5D4037]/15 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-[#5D4037]">
                    {rec.priorityLabel}
                  </span>
                </div>
                <p className="mb-5 max-w-3xl text-sm leading-relaxed text-[#6D4C41]">{rec.reason}</p>
                <motion.div
                  initial="hidden"
                  whileInView="visible"
                  viewport={{ once: true, margin: '-40px' }}
                  variants={{ visible: { transition: { staggerChildren: 0.05 } }, hidden: {} }}
                  className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4"
                >
                  {rec.products
                    .filter((p) => resolveNumericId(p) != null)
                    .map((p) => {
                      const card = toProductCard(p)
                      const shot = card.image_cdn || card.image_url || ''
                      return (
                        <motion.div
                          key={card.id}
                          variants={{ hidden: { opacity: 0, y: 14 }, visible: { opacity: 1, y: 0 } }}
                          transition={{ duration: 0.4, ease: EASE }}
                        >
                          <Link
                            href={`/products/${card.id}`}
                            className="group block overflow-hidden rounded-2xl border border-[#5D4037]/10 bg-white shadow-[0_8px_28px_-16px_rgba(62,39,35,0.12)] transition-all duration-300 hover:-translate-y-0.5 hover:border-[#5D4037]/25 hover:shadow-[0_16px_40px_-18px_rgba(62,39,35,0.18)]"
                          >
                            <div className="relative aspect-[3/4] bg-[#efe8e0]">
                              {shot ? (
                                <Image
                                  src={shot}
                                  alt={card.title}
                                  fill
                                  className="object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                                  sizes="(max-width:640px) 50vw, 200px"
                                />
                              ) : null}
                            </div>
                            <div className="p-3.5">
                              {card.brand ? (
                                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#5D4037]">{card.brand}</p>
                              ) : null}
                              <p className="mt-1 line-clamp-2 text-sm font-semibold leading-snug text-[#3E2723]">{card.title}</p>
                              {card.price_cents > 0 ? (
                                <p className="mt-2 font-display text-sm font-bold tabular-nums text-[#5D4037]">
                                  {formatPrice(card.price_cents, card.currency)}
                                </p>
                              ) : null}
                            </div>
                          </Link>
                        </motion.div>
                      )
                    })}
                </motion.div>
              </section>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto mt-24 max-w-6xl border-t border-[#5D4037]/10 px-4 pt-16 sm:px-6">
        <p className="text-center text-[10px] font-semibold uppercase tracking-[0.32em] text-[#8D6E63]">How it works</p>
        <h2 className="mt-3 text-center font-display text-2xl font-bold text-[#3E2723] sm:text-3xl">From one piece to a full look</h2>
        <div className="mt-12 flex gap-6 overflow-x-auto pb-4 scrollbar-none lg:grid lg:grid-cols-5 lg:overflow-visible lg:pb-0">
          {HOW_STEPS.map(({ title, desc, Icon }, i) => (
            <motion.div
              key={title}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.05, ease: EASE }}
              className="min-w-[200px] flex-1 rounded-2xl border border-[#5D4037]/10 bg-white/90 p-5 text-center shadow-sm lg:min-w-0"
            >
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#F9F6F1] text-[#5D4037] ring-1 ring-[#5D4037]/10">
                <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden />
              </div>
              <p className="mt-4 font-display text-sm font-bold text-[#3E2723]">{title}</p>
              <p className="mt-2 text-xs leading-relaxed text-[#6D4C41]">{desc}</p>
            </motion.div>
          ))}
        </div>
      </section>
    </div>
  )
}
