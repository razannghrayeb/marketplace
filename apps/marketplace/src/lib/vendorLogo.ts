import type { Product, ProductVendorSource } from '@/types/product'
import { domainForBrandName, faviconUrlForDomain } from '@/lib/brandLogoDomains'

function pickStr(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t || null
}

function vendorRecordFromUnknown(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
  return null
}

/**
 * Pull vendor / listing URL fields from API records (`src` = hit `_source` or flat row, `raw` = outer envelope).
 */
export function extractVendorFieldsFromRecords(
  src: Record<string, unknown>,
  raw: Record<string, unknown>,
): Pick<Product, 'vendor_id' | 'vendor' | 'vendor_name' | 'vendor_logo_url' | 'product_url'> {
  const nv =
    vendorRecordFromUnknown(src.vendor) ??
    vendorRecordFromUnknown(raw.vendor)

  const vendor_id_raw = src.vendor_id ?? src.vendorId ?? raw.vendor_id ?? raw.vendorId
  let vendor_id: number | undefined
  if (typeof vendor_id_raw === 'number' && Number.isFinite(vendor_id_raw)) vendor_id = vendor_id_raw
  else if (typeof vendor_id_raw === 'string' && /^\d+$/.test(vendor_id_raw.trim()))
    vendor_id = parseInt(vendor_id_raw, 10)

  const name =
    pickStr(nv?.name) ??
    pickStr(src.vendor_name ?? src.vendorName) ??
    pickStr(raw.vendor_name ?? raw.vendorName)

  const url =
    pickStr(nv?.url ?? nv?.website ?? nv?.site_url) ??
    pickStr(src.vendor_url ?? src.vendorUrl) ??
    pickStr(raw.vendor_url ?? raw.vendorUrl)

  const logo_url =
    pickStr(nv?.logo_url ?? nv?.logoUrl) ??
    pickStr(src.vendor_logo_url ?? src.vendorLogoUrl) ??
    pickStr(raw.vendor_logo_url ?? raw.vendorLogoUrl)

  const product_url =
    pickStr(src.product_url ?? src.productUrl ?? src.listing_url ?? src.source_url ?? src.product_link) ??
    pickStr(raw.product_url ?? raw.productUrl ?? raw.listing_url)

  const vendor: ProductVendorSource | undefined =
    name != null || url != null || logo_url != null
      ? { name: name ?? null, url: url ?? null, logo_url: logo_url ?? null }
      : undefined

  const out: Pick<Product, 'vendor_id' | 'vendor' | 'vendor_name' | 'vendor_logo_url' | 'product_url'> = {}
  if (vendor_id !== undefined) out.vendor_id = vendor_id
  if (vendor) out.vendor = vendor
  if (name) out.vendor_name = name
  if (logo_url) out.vendor_logo_url = logo_url
  if (product_url) out.product_url = product_url
  return out
}

/**
 * Merge envelope (`raw`) + document (`src`) so root-level search hit fields
 * (e.g. `vendor` on the hit) are not dropped when `src` is only `_source`.
 */
export function mergeVendorFromHit(
  src: Record<string, unknown>,
  raw: Record<string, unknown>,
): Pick<Product, 'vendor_id' | 'vendor' | 'vendor_name' | 'vendor_logo_url' | 'product_url'> {
  return {
    ...extractVendorFieldsFromRecords(raw, raw),
    ...extractVendorFieldsFromRecords(src, raw),
  }
}

/** Shown only when we cannot resolve an explicit logo, brand favicon, or listing-site favicon. */
export const DEFAULT_CATALOG_VENDOR_LOGO = '/brand/default-vendor.svg'
export const DEFAULT_CATALOG_VENDOR_LABEL = 'My Holiday'

/** HTTPS logo from vendor row only (no favicon). */
export function getExplicitVendorLogoUrl(product: Product): string | null {
  const explicit = product.vendor?.logo_url ?? product.vendor_logo_url
  if (typeof explicit === 'string' && /^https?:\/\//i.test(explicit.trim())) return explicit.trim()
  return null
}

/** Favicon for the listing / retailer host (product or vendor URL). */
export function getListingSiteFaviconUrl(product: Product): string | null {
  const urlStr =
    (typeof product.vendor?.url === 'string' ? product.vendor.url : null) ??
    (typeof product.product_url === 'string' ? product.product_url : null)
  if (urlStr && /^https?:\/\//i.test(urlStr)) {
    try {
      const host = new URL(urlStr).hostname
      if (host) return faviconUrlForDomain(host)
    } catch {
      /* ignore */
    }
  }
  return null
}

export function getVendorSiteLogoUrl(product: Product): string | null {
  return getExplicitVendorLogoUrl(product) ?? getListingSiteFaviconUrl(product)
}

export function getVendorDisplayLabel(product: Product): string {
  const direct =
    (product.vendor?.name && String(product.vendor.name).trim()) ||
    (product.vendor_name && String(product.vendor_name).trim()) ||
    ''
  if (direct) return direct

  const urlStr =
    (typeof product.vendor?.url === 'string' ? product.vendor.url : null) ??
    (typeof product.product_url === 'string' ? product.product_url : null)
  if (urlStr && /^https?:\/\//i.test(urlStr)) {
    try {
      return new URL(urlStr).hostname.replace(/^www\./i, '')
    } catch {
      /* ignore */
    }
  }
  return ''
}

function brandLabel(product: Product): string {
  if (typeof product.brand === 'string') {
    const t = product.brand.trim()
    if (t) return t
  }
  return ''
}

/**
 * Logo + label for catalog chips: explicit vendor logo → brand favicon (from `product.brand`) →
 * listing-site favicon → My Holiday default.
 */
export function resolveCatalogSourceLogo(product: Product): { src: string; label: string } {
  const explicit = getExplicitVendorLogoUrl(product)
  if (explicit) {
    const label = getVendorDisplayLabel(product) || brandLabel(product) || DEFAULT_CATALOG_VENDOR_LABEL
    return { src: explicit, label }
  }

  const brandDomain = domainForBrandName(product.brand)
  if (brandDomain) {
    const label = brandLabel(product) || getVendorDisplayLabel(product) || DEFAULT_CATALOG_VENDOR_LABEL
    return { src: faviconUrlForDomain(brandDomain), label }
  }

  const listingFav = getListingSiteFaviconUrl(product)
  if (listingFav) {
    const label = getVendorDisplayLabel(product) || brandLabel(product) || DEFAULT_CATALOG_VENDOR_LABEL
    return { src: listingFav, label }
  }

  return { src: DEFAULT_CATALOG_VENDOR_LOGO, label: DEFAULT_CATALOG_VENDOR_LABEL }
}

export function productHasVendorBadge(_product: Product): boolean {
  return true
}
