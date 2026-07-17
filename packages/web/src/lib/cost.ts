import type { TintHue } from './tints';

/**
 * Colour tier for a ticket's cumulative agentic cost badge (#404).
 *
 * Two shapes: `tint` reuses the theme-aware tint system (the only sanctioned way
 * to put decorative colour on the UI), while `style` carries raw inline colours
 * for the top "black" tier — the tint system has no black hue, so a near-black
 * dark-red fill (precedent: DeliverableTypeColor inline styles) signals
 * "beyond reasonable".
 */
export type CostTier =
  | { readonly maxUsd: number; readonly kind: 'tint'; readonly hue: TintHue }
  | {
      readonly maxUsd: number;
      readonly kind: 'style';
      readonly bg: string;
      readonly fg: string;
      readonly border: string;
    };

/**
 * Cost tiers, ordered by ascending upper bound. Bounds are INCLUSIVE
 * (green ≤ $5, yellow ≤ $10, red ≤ $50, black > $50), matching the ticket's
 * "jusqu'à 10$" phrasing. The calibration is provisional — NaS wants to
 * recalibrate once real per-ticket costs are known (#404), so every threshold
 * lives here, in one place.
 */
export const COST_TIERS: readonly CostTier[] = [
  { maxUsd: 5, kind: 'tint', hue: 'green' },
  { maxUsd: 10, kind: 'tint', hue: 'yellow' },
  { maxUsd: 50, kind: 'tint', hue: 'red' },
  { maxUsd: Infinity, kind: 'style', bg: '#450a0a', fg: '#fecaca', border: '#7f1d1d' },
];

/** Resolve the tier for a cost. The last tier (Infinity) is the catch-all. */
export function costTier(usd: number): CostTier {
  return COST_TIERS.find((t) => usd <= t.maxUsd) ?? COST_TIERS[COST_TIERS.length - 1]!;
}

/** Always 2 decimals, `$` prefix: `12.8 → "$12.80"`, `0.05 → "$0.05"`. */
export function formatTicketCost(usd: number): string {
  return `$${usd.toFixed(2)}`;
}
