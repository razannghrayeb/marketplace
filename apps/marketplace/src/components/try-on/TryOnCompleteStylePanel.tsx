'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Loader2, Shirt, Sparkles, AlertCircle } from 'lucide-react'
import { fetchCompleteStyleForGarmentFile, type TryOnCompleteStyleData } from '@/lib/tryon/completeStyleFromGarment'

function formatPrice(cents: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
  }).format(cents / 100)
}

function resolveNumericId(p: { id?: number; product_id?: number }): number | null {
  const n = Number(p.id ?? p.product_id)
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : null
}

type Props = {
  garmentFile: File | null
  jobId: string | null
  enabled: boolean
}

export function TryOnCompleteStylePanel({ garmentFile, jobId, enabled }: Props) {
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['tryon-complete-style', jobId, garmentFile?.name, garmentFile?.size, garmentFile?.lastModified],
    queryFn: () => fetchCompleteStyleForGarmentFile(garmentFile!),
    enabled: enabled && !!garmentFile && !!jobId,
    staleTime: 5 * 60 * 1000,
  })

  if (!enabled) return null

  if (!garmentFile) {
    return (
      <div className="rounded-2xl border border-dashed border-violet-200 bg-violet-50/40 p-6 text-center">
        <Sparkles className="mx-auto mb-3 h-8 w-8 text-violet-400" />
        <p className="text-sm font-medium text-neutral-800">Complete the look</p>
        <p className="mt-1 text-xs text-neutral-500">
          Outfit ideas use your garment photo. Start a new try-on to unlock suggestions here.
        </p>
        <Link
          href="/search"
          className="mt-4 inline-flex text-sm font-semibold text-violet-600 hover:text-violet-700"
        >
          Search the catalog →
        </Link>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-violet-100 bg-white/80 py-12 shadow-sm">
        <Loader2 className="h-8 w-8 animate-spin text-violet-500" />
        <p className="mt-3 text-sm font-medium text-neutral-700">Building your outfit…</p>
        <p className="mt-1 max-w-xs text-center text-xs text-neutral-500">
          Matching your garment to the catalog and pulling complementary pieces.
        </p>
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5">
        <div className="flex gap-3">
          <AlertCircle className="h-5 w-5 shrink-0 text-amber-600" />
          <div>
            <p className="text-sm font-medium text-amber-900">Couldn&apos;t load outfit ideas</p>
            <p className="mt-1 text-xs text-amber-800/90">{(error as Error)?.message ?? 'Try again in a moment.'}</p>
            <button
              type="button"
              onClick={() => void refetch()}
              disabled={isFetching}
              className="mt-3 text-xs font-semibold text-amber-900 underline decoration-amber-600/50 hover:decoration-amber-900"
            >
              {isFetching ? 'Retrying…' : 'Retry'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return <CompleteStyleSections data={data} />
}

function CompleteStyleSections({ data }: { data: TryOnCompleteStyleData }) {
  const source = data.sourceProduct
  const imgUrl = source.image_cdn || source.image_url

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-md shadow-violet-500/25">
          <Sparkles className="h-4 w-4" />
        </div>
        <div>
          <h3 className="font-display text-lg font-bold text-neutral-900">Complete the look</h3>
          <p className="text-xs text-neutral-500">Pieces that pair with your try-on</p>
        </div>
      </div>

      {data.outfitSuggestion && (
        <p className="rounded-xl border border-violet-100 bg-violet-50/80 px-4 py-3 text-sm leading-relaxed text-neutral-700">
          {data.outfitSuggestion}
        </p>
      )}

      <div className="flex gap-4 rounded-2xl border border-neutral-100 bg-neutral-50/80 p-4">
        <div className="relative h-20 w-16 shrink-0 overflow-hidden rounded-lg bg-neutral-200">
          {imgUrl ? (
            <Image src={imgUrl} alt="" fill className="object-cover" sizes="64px" />
          ) : (
            <div className="flex h-full items-center justify-center">
              <Shirt className="h-6 w-6 text-neutral-400" />
            </div>
          )}
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-violet-600">Anchor piece</p>
          <p className="line-clamp-2 text-sm font-semibold text-neutral-900">{source.title}</p>
          {data.detectedCategory && (
            <p className="mt-0.5 text-xs text-neutral-500">{data.detectedCategory}</p>
          )}
        </div>
      </div>

      {data.recommendations.map((rec, idx) => (
        <section key={`${rec.category}-${idx}`}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Shirt className="h-4 w-4 text-violet-600" />
            <h4 className="font-display text-base font-bold text-neutral-800">{rec.category}</h4>
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-600">
              {rec.priorityLabel}
            </span>
          </div>
          <p className="mb-4 text-xs text-neutral-500">{rec.reason}</p>
          <motion.div
            initial="hidden"
            animate="visible"
            variants={{ visible: { transition: { staggerChildren: 0.05 } }, hidden: {} }}
            className="grid grid-cols-2 gap-3 sm:grid-cols-3"
          >
            {rec.products
              .filter((p) => resolveNumericId(p) != null)
              .map((p) => {
                const id = resolveNumericId(p)!
                const cents =
                  typeof p.price === 'number' && Number.isFinite(p.price)
                    ? Math.round(p.price)
                    : typeof p.price_cents === 'number'
                      ? Math.round(p.price_cents)
                      : 0
                const shot = p.image
                return (
                  <motion.div
                    key={`${rec.category}-${id}`}
                    variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}
                  >
                    <Link
                      href={`/products/${id}?from=${encodeURIComponent('/try-on')}`}
                      className="group block overflow-hidden rounded-xl border border-neutral-200/80 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-violet-200 hover:shadow-md hover:shadow-violet-500/10"
                    >
                      <div className="relative aspect-[3/4] bg-neutral-100">
                        {shot && (
                          <Image
                            src={shot}
                            alt={p.title}
                            fill
                            className="object-cover transition duration-500 group-hover:scale-105"
                            sizes="120px"
                          />
                        )}
                      </div>
                      <div className="p-2.5">
                        {p.brand && (
                          <p className="truncate text-[9px] font-semibold uppercase tracking-wider text-violet-600">
                            {p.brand}
                          </p>
                        )}
                        <p className="line-clamp-2 text-xs font-semibold text-neutral-900">{p.title}</p>
                        {cents > 0 && (
                          <p className="mt-1 text-xs font-bold tabular-nums text-violet-700">
                            {formatPrice(cents, p.currency || 'USD')}
                          </p>
                        )}
                      </div>
                    </Link>
                  </motion.div>
                )
              })}
          </motion.div>
        </section>
      ))}
    </div>
  )
}
