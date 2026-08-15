/**
 * Shared, source-agnostic formatting helpers. Lives here (not in `alert/buildAlert.ts`, where
 * `formatPriceCents` originated) because it's consumed by modules with no domain reason to
 * depend on the alert stage: `cli/rank.ts` (a table column) and the dashboard client
 * (`packages/dashboard/client/src/App.tsx`, a price cell) both just need USD formatting.
 */

const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

export function formatPriceCents(priceCents: number): string {
  return usdFormatter.format(priceCents / 100);
}
