/**
 * Tunables for the statistics read model. Values are unchanged from when they
 * were inline literals — see the fetch-limit note below before touching them.
 */

/**
 * Statuses tracked by the cumulative-flow diagram, in board order.
 *
 * `cancelled` is a valid `TicketStatus` but is deliberately absent: a cancelled
 * ticket drops out of every CFD counter rather than accumulating in a terminal
 * column.
 */
export const FLOW_STATUSES = ['backlog', 'todo', 'doing', 'reviewing', 'done'] as const;

export type FlowStatus = (typeof FLOW_STATUSES)[number];

/** How long a computed response stays served from the in-process cache. */
export const STATS_CACHE_TTL_MS = 60_000;

/**
 * Cap on `panel.executed` rows pulled from the domain event log. Hitting it
 * undercounts panels; the use case logs a warning when it does.
 */
export const PANEL_EVENTS_FETCH_LIMIT = 1_000;

/**
 * Cap on `ticket.moved` rows pulled from the domain event log. Hitting it is
 * worse than an undercount: lead time and the CFD are reconstructed by replaying
 * these transitions, so a truncated list yields *wrong* numbers rather than
 * merely incomplete ones. The use case logs a warning when it does.
 */
export const MOVE_EVENTS_FETCH_LIMIT = 50_000;
