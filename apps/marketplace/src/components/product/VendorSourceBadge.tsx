'use client'

import Image from 'next/image'
import { useEffect, useState } from 'react'
import type { Product } from '@/types/product'
import { DEFAULT_CATALOG_VENDOR_LOGO, resolveCatalogSourceLogo } from '@/lib/vendorLogo'

function logoShouldUnoptimize(url: string): boolean {
  return url.includes('google.com/s2/favicons') || url.includes('gstatic.com')
}

function VendorLogoFill({ resolvedSrc, alt, sizes }: { resolvedSrc: string; alt: string; sizes: string }) {
  const [src, setSrc] = useState(resolvedSrc)
  useEffect(() => {
    setSrc(resolvedSrc)
  }, [resolvedSrc])
  const isRemote = src.startsWith('http://') || src.startsWith('https://')
  return (
    <Image
      src={src}
      alt={alt}
      fill
      className="object-cover"
      sizes={sizes}
      unoptimized={isRemote ? logoShouldUnoptimize(src) : src.endsWith('.svg')}
      onError={() => {
        setSrc((cur) => (cur === DEFAULT_CATALOG_VENDOR_LOGO ? cur : DEFAULT_CATALOG_VENDOR_LOGO))
      }}
    />
  )
}

export type VendorSourceBadgeVariant = 'card' | 'detail'

export type VendorSourceBadgeLayout = 'floating' | 'embedded'

/**
 * Round source logo on product imagery. Uses API logo when present, otherwise shared default (My Holiday).
 */
export function VendorSourceBadge({
  product,
  variant = 'card',
  layout = 'floating',
}: {
  product: Product
  variant?: VendorSourceBadgeVariant
  layout?: VendorSourceBadgeLayout
}) {
  const { src, label } = resolveCatalogSourceLogo(product)
  const alt = `${label} logo`
  const isDetail = variant === 'detail'
  const ring = isDetail ? 'h-8 w-8' : 'h-6 w-6'
  const isRemote = src.startsWith('http://') || src.startsWith('https://')

  const inner = (
    <div
      className={`relative ${ring} shrink-0 overflow-hidden rounded-full bg-white/95 shadow-md ring-1 ring-black/10`}
    >
      <Image
        src={src}
        alt={alt}
        fill
        className="object-cover"
        sizes={isDetail ? '32px' : '24px'}
        unoptimized={isRemote ? logoShouldUnoptimize(src) : src.endsWith('.svg')}
      />
    </div>
  )

  if (layout === 'embedded') {
    return (
      <div className="pointer-events-none shrink-0" title={label}>
        {inner}
      </div>
    )
  }

  const position = isDetail ? 'top-4 right-4 z-[6]' : 'top-3 right-3 z-[6]'

  return (
    <div className={`pointer-events-none absolute ${position} flex`} title={label}>
      {inner}
    </div>
  )
}

/**
 * Compact round logo for inline placement (e.g. Discover text cards under price).
 */
export function VendorSourceLogoChip({ product }: { product: Product }) {
  const { src, label } = resolveCatalogSourceLogo(product)
  const alt = `${label} logo`

  return (
    <div
      className="relative h-[22px] w-[22px] shrink-0 overflow-hidden rounded-full bg-white shadow-sm ring-1 ring-black/[0.08]"
      title={label}
    >
      <VendorLogoFill resolvedSrc={src} alt={alt} sizes="22px" />
    </div>
  )
}
