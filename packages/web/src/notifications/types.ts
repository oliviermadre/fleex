import type { TicketTab } from '../stores/ticketStore';

/**
 * Fleex Pulse — notification primitives.
 *
 * One `PulseNotification` feeds BOTH surfaces:
 *   1. an ephemeral toast (auto-dismissed), and
 *   2. a persistent entry in the notification center (the bell).
 *
 * The system is open–closed: a renderer registry (see ./registry) maps a raw
 * WebSocket event type to a renderer. Supporting a new event type in a future
 * version means registering one more renderer — no change to the store, the
 * hook, or the UI.
 */

/** Visual severity / accent of a notification. */
export type PulseLevel = 'info' | 'success' | 'warning' | 'error' | 'action';

export interface PulseNotification {
  /**
   * Stable identity AND dedup key. The same logical event always produces the
   * same id, so hub re-broadcasts and "notify once" cases collapse to a single
   * entry. (e.g. `deliverable-final:<id>`)
   */
  readonly id: string;
  /** Emoji shown in the toast and the card. */
  readonly emoji: string;
  /** Short headline. */
  readonly title: string;
  /** One-line supporting text. */
  readonly body: string;
  /** Severity / accent. */
  readonly level: PulseLevel;
  /** In-app deep link to the relevant ticket/element. */
  readonly link: string;
  /** ISO timestamp of when the client received it. */
  readonly createdAt: string;
  /** Whether the user has already seen this (drives the unseen badge). */
  readonly seen: boolean;
}

/**
 * What a renderer returns. The pipeline fills in `createdAt`/`seen` and promotes
 * `dedupKey` to the notification's `id`.
 */
export interface NotificationDraft {
  /** Stable, event-unique key used for both identity and deduplication. */
  readonly dedupKey: string;
  readonly emoji: string;
  readonly title: string;
  readonly body: string;
  readonly level: PulseLevel;
  readonly link: string;
}

/**
 * Side dependencies a renderer may use to enrich a notification. Injected (not
 * imported) so renderers stay pure and unit-testable.
 */
export interface RendererContext {
  /** Human label for a ticket, or null when it cannot be resolved client-side. */
  readonly ticketTitle: (ticketId: string) => string | null;
  /** Build a deep link to a ticket (optionally a specific tab). */
  readonly ticketLink: (ticketId: string, tab?: TicketTab) => string;
}

/**
 * Pure transform: given the `data` payload of a WS message and a context,
 * return a draft notification — or `null` to skip (event not actionable).
 */
export type NotificationRenderer = (
  data: unknown,
  ctx: RendererContext,
) => NotificationDraft | null;

/** A raw channel message as delivered by `appWs.onChannel`. */
export interface WsChannelMessage {
  readonly type: string;
  readonly data: unknown;
}
