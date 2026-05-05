/**
 * Normalize catalog prices for shopper-facing USD display.
 * Backend rows sometimes store Lebanese pounds in `price_cents`-style fields while `currency` is missing or wrongly USD.
 */

/** Lebanese pound per US dollar (adjust when the peg / parallel rate you want to show changes). */
export const LBP_PER_USD = 89_500

/**
 * When currency is USD but `storedCents / 100` is implausible for apparel catalog pricing,
 * treat the amount as LBP whole pounds scaled ×100 in `storedCents` (same encoding as your bogus `$3,128,000` rows).
 */
const MISLABELED_USD_MIN_NAIVE_DOLLARS = 100_000

export function storedAmountToUsdCents(storedCents: number, currency?: string | null): number {
  if (!Number.isFinite(storedCents) || storedCents <= 0) return 0

  const cur = (currency ?? 'USD').trim().toUpperCase()
  const naiveUsd = storedCents / 100

  const treatAsLbp =
    cur === 'LBP' ||
    cur === 'LL' ||
    cur === 'LEB' ||
    (cur === 'USD' && naiveUsd >= MISLABELED_USD_MIN_NAIVE_DOLLARS)

  if (!treatAsLbp) return Math.round(storedCents)

  const lbpWhole = storedCents / 100
  const usd = lbpWhole / LBP_PER_USD
  return Math.round(usd * 100)
}

export function formatDisplayUsd(
  usdCents: number,
  opts?: { minimumFractionDigits?: number; maximumFractionDigits?: number },
): string {
  const minimumFractionDigits = opts?.minimumFractionDigits ?? 2
  const maximumFractionDigits = opts?.maximumFractionDigits ?? 2
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(usdCents / 100)
}

/** Stored API cents / ISO-ish currency → USD string for shoppers. */
export function formatStoredPriceAsUsd(
  storedCents: number,
  currency?: string | null,
  digitOpts?: { minimumFractionDigits?: number; maximumFractionDigits?: number },
): string {
  return formatDisplayUsd(storedAmountToUsdCents(storedCents, currency), digitOpts)
}
