/** Display-only euro amounts; callers convert fixture cents to euros. */
export const euros = new Intl.NumberFormat("bg-BG", {
  style: "currency",
  currency: "EUR",
});
