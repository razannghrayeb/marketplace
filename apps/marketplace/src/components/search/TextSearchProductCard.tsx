'use client'

import Image from 'next/image'
import Link from 'next/link'
import { Heart } from 'lucide-react'
import type { Product } from '@/types/product'
import { formatStoredPriceAsUsd } from '@/lib/money/displayUsd'
import { VendorSourceBadge } from '@/components/product/VendorSourceBadge'
import { saveListingScrollY } from '@/lib/navigation/listingScrollRestore'

function formatPriceLine(storedCents: number, currency?: string | null) {
  return formatStoredPriceAsUsd(storedCents, currency, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function effectivePriceCents(p: Product): number {
  const sale = p.sales_price_cents
  const base = typeof p.price_cents === 'number' ? p.price_cents : Number(p.price_cents) || 0
  if (sale != null && sale > 0 && sale < base) return sale
  return base
}

function useDirectRemoteImage(url: string): boolean {
  if (!url.startsWith('http://') && !url.startsWith('https://')) return false
  if (url.includes('placehold.co')) return false
  return true
}

export function TextSearchProductCard({
  product,
  fromReturnPath,
}: {
  product: Product
  fromReturnPath?: string
}) {
  const imgUrl = product.image_cdn || product.image_url || '/placeholder-product.jpg'
  const imageUnoptimized = useDirectRemoteImage(imgUrl)
  const fromListing =
    fromReturnPath &&
    (fromReturnPath.startsWith('/search') ||
      fromReturnPath.startsWith('/products') ||
      fromReturnPath.startsWith('/sales'))
  const href = fromListing
    ? `/products/${product.id}?from=${encodeURIComponent(fromReturnPath!)}`
    : `/products/${product.id}`
  const cents = effectivePriceCents(product)
  const subtitle =
    product.category?.replace(/_/g, ' ') ||
    product.brand ||
    'Catalog'

  return (
    <article className="group rounded-[18px] bg-white border border-[#ebe8e4] shadow-[0_6px_28px_-16px_rgba(42,38,35,0.12)] overflow-hidden transition-shadow duration-300 hover:shadow-[0_14px_40px_-18px_rgba(42,38,35,0.18)]">
      <Link
        href={href}
        className="block"
        prefetch={false}
        onClick={() => saveListingScrollY(fromReturnPath, typeof window !== 'undefined' ? window.scrollY : 0)}
      >
        <div className="relative aspect-square bg-[#faf9f7]">
          <Image
            src={imgUrl}
            alt={product.title}
            fill
            unoptimized={imageUnoptimized}
            className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]"
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
            onError={(e) => {
              e.currentTarget.src = 'https://placehold.co/600x600/f5f5f4/57534e?text=Bolden'
            }}
          />
          <VendorSourceBadge product={product} />
          <span
            className="absolute top-11 right-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/95 text-[#2a2623] shadow-sm ring-1 ring-black/[0.06] hover:bg-[#f9f8f6] transition-colors"
            aria-hidden
          >
            <Heart className="w-4 h-4" strokeWidth={2} />
          </span>
        </div>
        <div className="p-4 pt-3.5">
          <h3 className="font-sans font-semibold text-[15px] sm:text-[16px] text-ink leading-snug line-clamp-2">
            {product.title}
          </h3>
          <p className="mt-1 text-small text-muted/90 capitalize line-clamp-1 font-sans">{subtitle}</p>
          <p className="mt-2 font-sans text-[15px] font-bold text-ink tabular-nums">
            {cents > 0 ? formatPriceLine(cents, product.currency) : '—'}
          </p>
        </div>
      </Link>
    </article>
  )
}
