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

/** Visit length as "45 мин" or "1 ч 30 мин"; minutes-only below an hour. */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} мин`;
  return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
}

/** A single service's price, or "на място" when it is settled on site. */
export function formatServicePrice(
  priceCents: number | null,
  compact = false,
): string {
  return priceCents === null
    ? "на място"
    : (compact ? compactEuros : euros).format(priceCents / 100);
}

/** Selected total: exact sum, "от X" when a picked service is priced on site, else "на място". */
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
