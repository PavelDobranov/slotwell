/** Display-only euro amounts; callers convert fixture cents to euros. */
export const euros = new Intl.NumberFormat("bg-BG", {
  style: "currency",
  currency: "EUR",
});

const compactEuros = new Intl.NumberFormat("bg-BG", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/** A service's price or "на място"; compact omits unnecessary euro decimals. */
export function formatServicePrice(
  priceCents: number | null,
  compact = false,
): string {
  return priceCents === null
    ? "на място"
    : (compact ? compactEuros : euros).format(priceCents / 100);
}

/** Exact sum, "от X" with on-site pricing, else "на място"; compact omits unnecessary decimals. */
export function formatTotalPrice(
  totals: {
    priceCents: number;
    hasVariablePrice: boolean;
  },
  compact = false,
): string {
  const currency = compact ? compactEuros : euros;
  if (!totals.hasVariablePrice) return currency.format(totals.priceCents / 100);
  return totals.priceCents > 0
    ? `от ${currency.format(totals.priceCents / 100)}`
    : "на място";
}
