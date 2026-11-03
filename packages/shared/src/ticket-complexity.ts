/**
 * Ticket complexity: a closed, Fibonacci-like point scale.
 *
 * Points (not t-shirt sizes) so they can be summed — per Kanban column, per
 * epic, and later in charts. Stored as a string union (like `TicketPriority`)
 * so it rides the existing `enum` plumbing: native-action descriptors, CLI
 * validation, the CLI-generated MCP tools.
 *
 * - `null` = not estimated yet. It is NOT `0` (`0` means trivial).
 * - `'inf'` = too big to estimate, must be split. Never folded into a numeric
 *   total: a sum containing one renders as `N pts + ∞`.
 */
export const TICKET_COMPLEXITIES = ['0', '0.5', '1', '2', '3', '5', '8', '13', '21', '34', '55', 'inf'] as const;

export type TicketComplexity = (typeof TICKET_COMPLEXITIES)[number];

export function isTicketComplexity(v: unknown): v is TicketComplexity {
  return typeof v === 'string' && (TICKET_COMPLEXITIES as readonly string[]).includes(v);
}

/** Defensive read of a stored value: anything off the scale becomes "not estimated". */
export function normalizeTicketComplexity(v: unknown): TicketComplexity | null {
  return isTicketComplexity(v) ? v : null;
}

/** Display label of one value: `5`, `0.5`, `∞`, or `–` when not estimated. */
export function complexityLabel(c: TicketComplexity | null): string {
  if (c === null) return '–';
  return c === 'inf' ? '∞' : c;
}

/** Numeric weight of a value. `'inf'` → `Infinity`. */
export function complexityValue(c: TicketComplexity): number {
  return c === 'inf' ? Infinity : Number(c);
}

const COMPLEXITY_ALIASES: Record<string, TicketComplexity | null> = {
  '∞': 'inf',
  infinity: 'inf',
  '.5': '0.5',
  '0,5': '0.5',
  none: null,
};

/**
 * Parse a human-typed value (CLI flag, MCP arg). Accepts the 12 scale values
 * plus the aliases `∞`/`infinity` → `inf`, `.5`/`0,5` → `0.5`, `none` → `null`
 * (clears the estimate). Returns `undefined` for anything else.
 */
export function parseTicketComplexityInput(raw: string): TicketComplexity | null | undefined {
  const key = raw.trim().toLowerCase();
  if (isTicketComplexity(key)) return key;
  if (key in COMPLEXITY_ALIASES) return COMPLEXITY_ALIASES[key];
  return undefined;
}

/** What `--complexity` accepts, for error messages and help text. */
export const TICKET_COMPLEXITY_INPUT_HINT = [...TICKET_COMPLEXITIES, 'none'].join(', ');

export interface ComplexitySum {
  /** Sum of the finite estimates. */
  readonly points: number;
  /** How many tickets are `∞` (excluded from `points`). */
  readonly infinite: number;
  /** How many tickets have no estimate (excluded from `points`). */
  readonly unestimated: number;
  /** How many tickets have an estimate, `∞` included. */
  readonly estimated: number;
}

export function sumComplexity(tickets: readonly { readonly complexity?: TicketComplexity | null }[]): ComplexitySum {
  let points = 0;
  let infinite = 0;
  let unestimated = 0;
  let estimated = 0;
  for (const t of tickets) {
    const c = normalizeTicketComplexity(t.complexity);
    if (c === null) {
      unestimated++;
      continue;
    }
    estimated++;
    if (c === 'inf') infinite++;
    else points += complexityValue(c);
  }
  return { points, infinite, unestimated, estimated };
}

/** `"34 pts"`, `"13.5 pts + ∞"`, or `"—"` when nothing is estimated. */
export function formatComplexitySum(sum: ComplexitySum): string {
  if (sum.estimated === 0) return '—';
  return `${sum.points} pts${sum.infinite > 0 ? ' + ∞' : ''}`;
}

/**
 * Points progress of a set of tickets (an epic): `total` over every ticket that
 * isn't cancelled, `done` over the done ones. `∞` and unestimated tickets are
 * counted apart in each sum, never folded into `points`.
 */
export function complexityProgress(
  tickets: readonly { readonly status: string; readonly complexity?: TicketComplexity | null }[],
): { done: ComplexitySum; total: ComplexitySum } {
  const live = tickets.filter((t) => t.status !== 'cancelled');
  return { done: sumComplexity(live.filter((t) => t.status === 'done')), total: sumComplexity(live) };
}
