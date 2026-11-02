export function formatPersistedPrice(
  priceCents: number | null,
  currency: string,
): string {
  return priceCents === null
    ? "Цената се уточнява на място"
    : new Intl.NumberFormat("bg-BG", { style: "currency", currency }).format(
        priceCents / 100,
      );
}
