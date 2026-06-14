/**
 * Event Hub protocol — shared between the server and the event-hub process.
 *
 * The hub fans out domain events between multiple Fleex server instances so
 * that frontends connected to any instance receive updates from writes that
 * happened on other instances. Side-effects (auto-trigger, auto-review, etc.)
 * stay on the originator — only UI broadcasts are forwarded to remote servers.
 */

/** Sent by the server right after the WS connection opens. */
export interface HubHelloMessage {
  kind: 'hello';
  serverId: string;
  pid: number;
  hostname: string;
  version: string;
}

/** Domain event published from one server, fanned out to all others by the hub. */
export interface HubEventMessage {
  kind: 'event';
  /** Random UUID per published message — used for receiver-side dedup. */
  eventId: string;
  /** UUID of the server that emitted this event. The hub excludes this server from fan-out. */
  originatorServerId: string;
  eventType: string;
  /** ISO-8601 string. Receivers must re-hydrate to Date. */
  occurredAt: string;
  /** Event-type-specific fields, minus `type` and `occurredAt` (which are surfaced above). */
  payload: Record<string, unknown>;
}

export interface HubPingMessage { kind: 'ping' }
export interface HubPongMessage { kind: 'pong' }

export type HubMessage = HubHelloMessage | HubEventMessage | HubPingMessage | HubPongMessage;

/**
 * Domain events that are intentionally NOT shared via the hub. They reference
 * process-local resources (PTY sessions, worktrees on the originator's
 * filesystem) and have no meaning on other instances.
 *
 * The auditing layer also excludes the high-frequency
 * `session.hookStatusChanged` event for storage reasons.
 */
export const HUB_SHARED_EXCLUDED: ReadonlySet<string> = new Set([
  'session.created',
  'session.renamed',
  'session.killed',
  'session.hookStatusChanged',
  'worktree.created',
  'worktree.deleted',
]);
