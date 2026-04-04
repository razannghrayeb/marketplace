import type { Product, ProductQualityFlags, IssueSeverity } from '@/types/catalog-admin'

const SIZE_PATTERN = /\b(xs|s|m|l|xl|xxl|xxxl|[3-4]\d)\b/i
const COLOR_PATTERN = /\b(black|white|red|navy|beige|olive|pink|brown|camel|grey|gray|blue|green|yellow|orange|purple|cream|ivory)\b/i

export function getProductFlags(p: Product): ProductQualityFlags {
  const now = Date.now()
  const lastSeen = p.last_seen ? new Date(p.last_seen).getTime() : 0
  const daysOld = (now - lastSeen) / 86400000

  return {
    missing_category: !p.category,
    missing_brand: !p.brand,
    missing_color: !p.color,
    missing_size: !p.size,
    missing_image_url: !p.image_url,
    missing_image_urls: !p.image_urls || p.image_urls.length === 0,
    missing_variant_id: !p.variant_id,
    missing_parent_url: !p.parent_product_url,
    color_looks_like_size: !!p.color && SIZE_PATTERN.test(p.color),
    size_looks_like_color: !!p.size && COLOR_PATTERN.test(p.size),
    sale_exceeds_base:
      p.sales_price_cents !== null &&
      p.price_cents !== null &&
      p.sales_price_cents > p.price_cents,
    price_is_zero: p.price_cents === 0,
    is_stale: daysOld > 14,
    is_aging: daysOld > 7 && daysOld <= 14,
    missing_return_policy: !p.return_policy,
  }
}

export interface FlagSummary {
  label: string
  severity: IssueSeverity
  key: keyof ProductQualityFlags
}

export const FLAG_DEFINITIONS: FlagSummary[] = [
  { key: 'sale_exceeds_base', severity: 'critical', label: 'Sale > base price' },
  { key: 'price_is_zero', severity: 'critical', label: 'Price is zero' },
  { key: 'color_looks_like_size', severity: 'warning', label: 'Color ↔ size swap?' },
  { key: 'size_looks_like_color', severity: 'warning', label: 'Size ↔ color swap?' },
  { key: 'missing_image_url', severity: 'warning', label: 'No image_url' },
  { key: 'missing_image_urls', severity: 'info', label: 'No image_urls array' },
  { key: 'missing_category', severity: 'warning', label: 'Missing category' },
  { key: 'missing_brand', severity: 'info', label: 'Missing brand' },
  { key: 'missing_color', severity: 'info', label: 'Missing color' },
  { key: 'missing_size', severity: 'info', label: 'Missing size' },
  { key: 'missing_variant_id', severity: 'info', label: 'No variant_id' },
  { key: 'missing_parent_url', severity: 'info', label: 'No parent URL' },
  { key: 'is_stale', severity: 'stale', label: 'Stale >14d' },
  { key: 'is_aging', severity: 'stale', label: 'Aging 7–14d' },
  { key: 'missing_return_policy', severity: 'info', label: 'No return policy' },
]

export function getActiveFlags(flags: ProductQualityFlags): FlagSummary[] {
  return FLAG_DEFINITIONS.filter((def) => flags[def.key])
}

export function getWorstSeverity(flags: FlagSummary[]): IssueSeverity | null {
  if (flags.some((f) => f.severity === 'critical')) return 'critical'
  if (flags.some((f) => f.severity === 'warning')) return 'warning'
  if (flags.some((f) => f.severity === 'stale')) return 'stale'
  if (flags.some((f) => f.severity === 'info')) return 'info'
  return null
}

export function formatCents(cents: number | null | undefined, currency = 'USD'): string {
  if (cents == null) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(cents / 100)
}

export function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return 'Never'
  const ms = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(ms / 60000)
  const hours = Math.floor(ms / 3600000)
  const days = Math.floor(ms / 86400000)
  if (mins < 2) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days === 1) return '1 day ago'
  return `${days}d ago`
}

export function discountPercent(price: number | null, salePrice: number | null): number | null {
  if (!price || !salePrice || salePrice >= price) return null
  return Math.round(((price - salePrice) / price) * 100)
}
