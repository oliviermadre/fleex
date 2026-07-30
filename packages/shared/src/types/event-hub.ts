/**
 * Event Hub protocol — shared between the server and the event-hub process.
 *
 * The hub fans out domain events between multiple Fleex server instances so
 * that frontends connected to any instance receive updates from writes that
 * happened on other instances. Side-effects (auto-trigger, auto-review, etc.)
 * stay on the originator — only UI broadcasts are forwarded to remote servers.
 *
 * It also relays *agent* events (the SDK stream of a run) so a frontend on one
 * instance can see, and optionally watch, a run executing on another. Those are a
 * separate message kind with their own demand-gated delivery rules — see
 * `HubAgentEventMessage` and `HubAgentStreamDemandMessage`.
 */
import type { AgentEvent } from './agent-event.js';

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

/**
 * One agent event (SDK stream item) published from the instance running the agent,
 * fanned out to all others by the hub.
 *
 * Deliberately a separate `kind` from `'event'`: agent events are not domain
 * events. Routing them through the domain bus would re-audit them, re-trigger
 * side-effects, and drown the audit trail in stream chatter.
 */
export interface HubAgentEventMessage {
  kind: 'agentEvent';
  /** Random UUID per published message — used for receiver-side dedup. */
  eventId: string;
  originatorServerId: string;
  /** Stable id of the instance that owns the run (matches `AgentExecution.instanceId`). */
  originatorInstanceId: string;
  /** Human-facing hostname of the owning instance. */
  originatorInstanceLabel: string;
  /** The `AgentEvent` DTO, verbatim. */
  event: AgentEvent;
  /**
   * Set when this message answers a backfill request: every other instance drops
   * it. The hub itself stays a dumb broadcaster and does no addressing.
   */
  targetServerId?: string;
  /** `event.data` was replaced by a size stub — the UI should say so. */
  truncated?: boolean;
}

/**
 * Which executions this instance wants the full stream for — a complete snapshot,
 * re-sent periodically, not an incremental subscribe/unsubscribe.
 *
 * A snapshot is idempotent: no refcount drift, trivial to re-announce after a
 * reconnect, and no need for the hub to report disconnects (owners expire a
 * sender's demand once its heartbeat stops).
 *
 * Without demand, only `AGENT_EVENT_LIFECYCLE_TYPES` cross the wire — so sitting
 * on an unrelated screen never pulls a sibling's SDK traffic.
 */
export interface HubAgentStreamDemandMessage {
  kind: 'agentStreamDemand';
  originatorServerId: string;
  executionIds: string[];
}

/**
 * Ask whoever owns `executionId` for its recorded event history. Agent events live
 * in per-execution JSONL on the owner's disk (never in shared storage), so this is
 * the only way another instance can replay a run.
 */
export interface HubAgentBackfillRequestMessage {
  kind: 'agentBackfillRequest';
  originatorServerId: string;
  requestId: string;
  executionId: string;
}

/**
 * Terminates a backfill response stream. Sent even when nothing matched, so the
 * requester resolves immediately instead of waiting out its timeout.
 */
export interface HubAgentBackfillEndMessage {
  kind: 'agentBackfillEnd';
  originatorServerId: string;
  targetServerId: string;
  requestId: string;
  executionId: string;
  /** Events actually sent (may be fewer than recorded — see `elided`). */
  count: number;
  /** Older events dropped to respect the response cap. */
  elided: boolean;
}

export interface HubPingMessage { kind: 'ping' }
export interface HubPongMessage { kind: 'pong' }

export type HubMessage =
  | HubHelloMessage
  | HubEventMessage
  | HubAgentEventMessage
  | HubAgentStreamDemandMessage
  | HubAgentBackfillRequestMessage
  | HubAgentBackfillEndMessage
  | HubPingMessage
  | HubPongMessage;

/**
 * Messages the hub relays verbatim to every other connected server. All carry
 * `originatorServerId`, which is what the fan-out filter needs — so the hub can
 * forward them without knowing anything else about their shape.
 */
export type HubRelayMessage =
  | HubEventMessage
  | HubAgentEventMessage
  | HubAgentStreamDemandMessage
  | HubAgentBackfillRequestMessage
  | HubAgentBackfillEndMessage;

/** Message kinds that `Hub.forward` accepts. */
export const HUB_RELAYED_KINDS: ReadonlySet<string> = new Set([
  'event',
  'agentEvent',
  'agentStreamDemand',
  'agentBackfillRequest',
  'agentBackfillEnd',
]);

/**
 * Per-message ceiling for a relayed agent event. A single `content_block_delta`
 * can carry a tool result of several hundred KB (a file read), which has no place
 * on a shared relay — past this, `data` becomes a stub and `truncated` is set.
 */
export const MAX_AGENT_EVENT_BYTES = 256 * 1024;

/** How often a demanding instance re-announces its snapshot. */
export const AGENT_STREAM_DEMAND_HEARTBEAT_MS = 30_000;

/**
 * How long an owner honours a demand snapshot without a refresh. Three
 * heartbeats, so a couple of dropped messages don't cut a live stream.
 */
export const AGENT_STREAM_DEMAND_TTL_MS = 90_000;

/** Caps on a single backfill response. */
export const AGENT_BACKFILL_MAX_EVENTS = 500;
export const AGENT_BACKFILL_MAX_BYTES = 2 * 1024 * 1024;

/** How long a requester waits for a backfill before giving up. */
export const AGENT_BACKFILL_TIMEOUT_MS = 5_000;

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
