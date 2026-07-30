import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import {
  AGENT_BACKFILL_MAX_BYTES,
  AGENT_BACKFILL_MAX_EVENTS,
  AGENT_EVENT_LIFECYCLE_TYPES,
  AGENT_STREAM_DEMAND_HEARTBEAT_MS,
  AGENT_STREAM_DEMAND_TTL_MS,
  HUB_SHARED_EXCLUDED,
  MAX_AGENT_EVENT_BYTES,
  type AgentEvent,
  type HubAgentBackfillEndMessage,
  type HubAgentBackfillRequestMessage,
  type HubAgentEventMessage,
  type HubEventMessage,
  type HubMessage,
} from '@fleex/shared';
import type { LoggerPort } from '../../application/ports/logger.port.js';
import type { InstanceIdentity } from '../../application/services/instance-identity.js';
import type { AnyDomainEvent } from '../../domain/events.js';

const SERVER_VERSION = '0.1.0';
const PING_INTERVAL_MS = 20_000;
const QUEUE_CAP = 1000;
const RECONNECT_INITIAL_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
const RECEIVED_DEDUP_TTL_MS = 30_000;
const DEMAND_DEBOUNCE_MS = 100;

export interface HubClientOptions {
  url: string;
  token: string | undefined;
  serverId: string;
  /** Stable identity stamped on relayed agent events, so receivers can attribute a run. */
  instance: InstanceIdentity;
  logger: LoggerPort;
  onRemoteEvent: (event: AnyDomainEvent) => void;
  /** A sibling's agent event arrived (already deduped and addressed to us). */
  onRemoteAgentEvent?: (msg: HubAgentEventMessage) => void;
  /** A sibling wants our recorded history for one of our executions. */
  onAgentBackfillRequest?: (msg: HubAgentBackfillRequestMessage) => void;
  /** A backfill we asked for is complete (or found nothing). */
  onAgentBackfillEnd?: (msg: HubAgentBackfillEndMessage) => void;
  /**
   * Relay stream-tier agent events at all (`FLEEX_HUB_RELAY_AGENT_EVENTS`).
   * When false, only lifecycle events cross the wire: siblings still see runs as
   * "running", they just can't watch them. Defaults to true.
   */
  relayAgentEvents?: boolean;
}

export interface HubClientStats {
  connected: boolean;
  reconnectAttempts: number;
  eventsSent: number;
  eventsReceived: number;
  eventsDropped: number;
  queueLength: number;
  agentEventsSent: number;
  agentEventsReceived: number;
  agentEventsDropped: number;
  /** executionIds this instance is currently asking siblings to stream. */
  streamDemandOut: number;
  /** executionIds siblings are currently asking us to stream. */
  streamDemandIn: number;
}

/**
 * WebSocket client that connects this server to the event hub.
 *
 * Outbound: events are sent immediately if connected; otherwise queued
 * (bounded). On reconnect the queue is drained oldest-first.
 *
 * Inbound: events from other servers are deduped by eventId (30s LRU) and
 * dispatched through `onRemoteEvent`. The occurredAt ISO string is rehydrated
 * into a Date so downstream comparisons keep working.
 */
export class HubClient {
  private ws: WebSocket | null = null;
  private connected = false;
  private closed = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private readonly outbound: HubEventMessage[] = [];
  private readonly recentEventIds = new Map<string, number>();

  private eventsSent = 0;
  private eventsReceived = 0;
  private eventsDropped = 0;
  private agentEventsSent = 0;
  private agentEventsReceived = 0;
  private agentEventsDropped = 0;

  /** What we want streamed to us, and the timers that keep siblings informed. */
  private demandOut = new Set<string>();
  private demandDebounce: NodeJS.Timeout | null = null;
  private demandHeartbeat: NodeJS.Timeout | null = null;

  /**
   * What siblings want streamed from us, per sender, with a last-seen stamp.
   * Entries expire after `AGENT_STREAM_DEMAND_TTL_MS` — that expiry is what
   * releases a stream when a viewer's instance disappears without saying so.
   */
  private readonly demandIn = new Map<string, { ids: Set<string>; updatedAt: number }>();

  constructor(private readonly opts: HubClientOptions) {}

  start(): void {
    this.connect();
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.demandDebounce) clearTimeout(this.demandDebounce);
    if (this.demandHeartbeat) clearInterval(this.demandHeartbeat);
    if (this.ws) {
      try { this.ws.close(); } catch { /* swallow */ }
      this.ws = null;
    }
  }

  publish(event: AnyDomainEvent): void {
    if (HUB_SHARED_EXCLUDED.has(event.type)) return;

    const msg: HubEventMessage = {
      kind: 'event',
      eventId: cryptoRandomUUID(),
      originatorServerId: this.opts.serverId,
      eventType: event.type,
      occurredAt: event.occurredAt.toISOString(),
      payload: serializePayload(event),
    };

    if (this.connected && this.ws) {
      try {
        this.ws.send(JSON.stringify(msg));
        this.eventsSent++;
        return;
      } catch (err) {
        this.opts.logger.warn('Hub send failed — queueing', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (this.outbound.length >= QUEUE_CAP) {
      this.outbound.shift();
      this.eventsDropped++;
      this.opts.logger.warn('Hub outbound queue full — dropped oldest event', {
        cap: QUEUE_CAP,
        dropped: this.eventsDropped,
      });
    }
    this.outbound.push(msg);
  }

  /**
   * Offer a locally-produced agent event to the hub.
   *
   * Two gates, in order:
   *  - lifecycle events always go out (a handful per run, a few hundred bytes) —
   *    that's what lets siblings show "running" without subscribing to anything;
   *  - stream payload goes out only while some sibling has declared demand for
   *    this execution, so nobody pays for a stream they aren't watching.
   *
   * Unlike domain events these are never queued: by the time a dropped
   * reconnection heals, the viewer has moved on, and any real gap is repaired by
   * a backfill request. Queueing them would only risk starving the domain-event
   * queue, whose contents actually matter.
   */
  publishAgentEvent(event: AgentEvent): void {
    const isLifecycle = AGENT_EVENT_LIFECYCLE_TYPES.has(event.eventType);
    if (!isLifecycle) {
      if (this.opts.relayAgentEvents === false) return;
      if (!this.isStreamDemanded(event.executionId)) return;
    }

    if (!this.connected || !this.ws) {
      this.agentEventsDropped++;
      return;
    }
    this.sendAgentEvent(event);
  }

  /**
   * Ask siblings for an execution's recorded history. Returns the requestId that
   * will come back on the matching `agentBackfillEnd`, or null when offline.
   */
  requestAgentBackfill(executionId: string): string | null {
    if (!this.connected || !this.ws) return null;
    const requestId = cryptoRandomUUID();
    this.trySend({
      kind: 'agentBackfillRequest',
      originatorServerId: this.opts.serverId,
      requestId,
      executionId,
    });
    return requestId;
  }

  /**
   * Answer a backfill request with our recorded events, newest-biased and capped.
   *
   * Keeps the *tail* on overflow: when a run is too long to relay whole, the
   * recent part is what a viewer actually wants. `elided` tells the requester to
   * say the beginning is missing rather than imply a complete log.
   */
  respondAgentBackfill(msg: HubAgentBackfillRequestMessage, events: AgentEvent[]): void {
    if (!this.connected || !this.ws) return;

    let selected = events;
    let elided = false;
    if (selected.length > AGENT_BACKFILL_MAX_EVENTS) {
      selected = selected.slice(-AGENT_BACKFILL_MAX_EVENTS);
      elided = true;
    }
    // Trim from the front until the batch fits the byte budget.
    let budget = AGENT_BACKFILL_MAX_BYTES;
    let firstKept = selected.length;
    for (let i = selected.length - 1; i >= 0; i--) {
      budget -= Buffer.byteLength(JSON.stringify(selected[i]!.data ?? null), 'utf-8');
      if (budget < 0) break;
      firstKept = i;
    }
    if (firstKept > 0) {
      selected = selected.slice(firstKept);
      elided = true;
    }

    for (const event of selected) {
      this.sendAgentEvent(event, msg.originatorServerId);
    }
    this.trySend({
      kind: 'agentBackfillEnd',
      originatorServerId: this.opts.serverId,
      targetServerId: msg.originatorServerId,
      requestId: msg.requestId,
      executionId: msg.executionId,
      count: selected.length,
      elided,
    });
  }

  /**
   * Declare which remote executions this instance wants streamed — a full
   * snapshot, not a delta. Safe to call on every browser subscribe/unsubscribe:
   * a no-op change is ignored and the wire send is debounced.
   */
  setAgentStreamDemand(executionIds: Iterable<string>): void {
    const next = new Set(executionIds);
    if (next.size === this.demandOut.size && [...next].every((id) => this.demandOut.has(id))) return;
    this.demandOut = next;

    if (this.demandDebounce) clearTimeout(this.demandDebounce);
    this.demandDebounce = setTimeout(() => {
      this.demandDebounce = null;
      this.sendDemandSnapshot();
    }, DEMAND_DEBOUNCE_MS);
  }

  /** Is any non-expired sibling asking us to stream this execution? */
  isStreamDemanded(executionId: string): boolean {
    if (this.opts.relayAgentEvents === false) return false;
    const now = Date.now();
    for (const [serverId, entry] of this.demandIn) {
      if (now - entry.updatedAt > AGENT_STREAM_DEMAND_TTL_MS) {
        this.demandIn.delete(serverId);
        continue;
      }
      if (entry.ids.has(executionId)) return true;
    }
    return false;
  }

  stats(): HubClientStats {
    let streamDemandIn = 0;
    for (const entry of this.demandIn.values()) streamDemandIn += entry.ids.size;
    return {
      connected: this.connected,
      reconnectAttempts: this.reconnectAttempts,
      eventsSent: this.eventsSent,
      eventsReceived: this.eventsReceived,
      eventsDropped: this.eventsDropped,
      queueLength: this.outbound.length,
      agentEventsSent: this.agentEventsSent,
      agentEventsReceived: this.agentEventsReceived,
      agentEventsDropped: this.agentEventsDropped,
      streamDemandOut: this.demandOut.size,
      streamDemandIn,
    };
  }

  private connect(): void {
    if (this.closed) return;

    const wsOpts: ConstructorParameters<typeof WebSocket>[2] = this.opts.token
      ? { headers: { Authorization: `Bearer ${this.opts.token}` } }
      : undefined;
    const ws = new WebSocket(this.opts.url, wsOpts);
    this.ws = ws;

    ws.on('open', () => {
      this.connected = true;
      this.reconnectAttempts = 0;
      this.opts.logger.info('Hub connection opened', { url: this.opts.url });

      const hello: HubMessage = {
        kind: 'hello',
        serverId: this.opts.serverId,
        pid: process.pid,
        hostname: hostname(),
        version: SERVER_VERSION,
      };
      ws.send(JSON.stringify(hello));

      this.drainQueue();

      // Re-announce demand: siblings hold it in memory keyed by our serverId, and
      // a reconnect (ours or theirs, or a hub restart) loses it.
      this.sendDemandSnapshot();

      this.pingTimer = setInterval(() => {
        if (this.connected && this.ws) {
          try { this.ws.send(JSON.stringify({ kind: 'ping' } satisfies HubMessage)); } catch { /* swallow */ }
        }
      }, PING_INTERVAL_MS);

      this.demandHeartbeat ??= setInterval(() => {
        // Refresh only while we actually want something: an empty snapshot is
        // pushed once on change, then owners let their entry expire.
        if (this.demandOut.size > 0) this.sendDemandSnapshot();
      }, AGENT_STREAM_DEMAND_HEARTBEAT_MS);
    });

    ws.on('message', (raw) => {
      let msg: HubMessage;
      try {
        const text = typeof raw === 'string' ? raw : raw.toString('utf-8');
        msg = JSON.parse(text);
      } catch {
        this.opts.logger.warn('Hub: invalid inbound message (not JSON)');
        return;
      }
      this.handleInbound(msg);
    });

    ws.on('close', () => {
      this.handleDisconnect('close');
    });

    ws.on('error', (err) => {
      const { message, code } = describeWsError(err);
      this.opts.logger.warn('Hub WS error', { error: message, code, url: this.opts.url });
      // 'close' will fire right after.
    });
  }

  private handleDisconnect(_reason: 'close' | 'error'): void {
    this.connected = false;
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.ws) {
      try { this.ws.removeAllListeners(); } catch { /* swallow */ }
      this.ws = null;
    }
    if (this.closed) return;

    this.reconnectAttempts++;
    const base = Math.min(RECONNECT_INITIAL_MS * 2 ** (this.reconnectAttempts - 1), RECONNECT_MAX_MS);
    const jitter = Math.random() * 0.3 * base;
    const delay = base + jitter;
    this.opts.logger.info('Hub disconnected — scheduling reconnect', {
      attempt: this.reconnectAttempts,
      delayMs: Math.round(delay),
    });
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private handleInbound(msg: HubMessage): void {
    if (msg.kind === 'pong') return;
    if (msg.kind === 'ping') {
      if (this.ws) {
        try { this.ws.send(JSON.stringify({ kind: 'pong' } satisfies HubMessage)); } catch { /* swallow */ }
      }
      return;
    }
    if (msg.kind === 'hello') return; // hub doesn't say hello

    if (msg.originatorServerId === this.opts.serverId) return; // never re-ingest our own

    if (msg.kind === 'agentStreamDemand') {
      this.demandIn.set(msg.originatorServerId, {
        ids: new Set(msg.executionIds),
        updatedAt: Date.now(),
      });
      return;
    }

    if (msg.kind === 'agentBackfillRequest') {
      this.opts.onAgentBackfillRequest?.(msg);
      return;
    }

    if (msg.kind === 'agentBackfillEnd') {
      if (msg.targetServerId !== this.opts.serverId) return;
      this.opts.onAgentBackfillEnd?.(msg);
      return;
    }

    if (msg.kind === 'agentEvent') {
      // A backfill response is addressed: everyone else drops it, because the hub
      // has no addressing of its own.
      if (msg.targetServerId && msg.targetServerId !== this.opts.serverId) return;

      this.evictStaleDedupEntries();
      if (this.recentEventIds.has(msg.eventId)) return;
      this.recentEventIds.set(msg.eventId, Date.now());

      this.agentEventsReceived++;
      try {
        this.opts.onRemoteAgentEvent?.(msg);
      } catch (err) {
        this.opts.logger.error('onRemoteAgentEvent threw', {
          executionId: msg.event.executionId,
          eventType: msg.event.eventType,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }

    if (msg.kind !== 'event') return;

    this.evictStaleDedupEntries();
    if (this.recentEventIds.has(msg.eventId)) {
      // duplicate — silently drop
      return;
    }
    this.recentEventIds.set(msg.eventId, Date.now());

    const reconstructed = {
      type: msg.eventType,
      occurredAt: new Date(msg.occurredAt),
      ...msg.payload,
    } as unknown as AnyDomainEvent;

    this.eventsReceived++;
    try {
      this.opts.onRemoteEvent(reconstructed);
    } catch (err) {
      this.opts.logger.error('onRemoteEvent threw', {
        eventType: msg.eventType,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Wrap and send one agent event, replacing an oversized payload with a stub.
   * `targetServerId` marks it as a backfill response for a single requester.
   */
  private sendAgentEvent(event: AgentEvent, targetServerId?: string): void {
    let payload = event;
    let truncated = false;
    const byteSize = Buffer.byteLength(JSON.stringify(event.data ?? null), 'utf-8');
    if (byteSize > MAX_AGENT_EVENT_BYTES) {
      payload = { ...event, data: { truncated: true, byteSize } };
      truncated = true;
    }

    const sent = this.trySend({
      kind: 'agentEvent',
      eventId: cryptoRandomUUID(),
      originatorServerId: this.opts.serverId,
      originatorInstanceId: this.opts.instance.id,
      originatorInstanceLabel: this.opts.instance.label,
      event: payload,
      ...(targetServerId ? { targetServerId } : {}),
      ...(truncated ? { truncated: true } : {}),
    });
    if (sent) this.agentEventsSent++;
    else this.agentEventsDropped++;
  }

  private sendDemandSnapshot(): void {
    this.trySend({
      kind: 'agentStreamDemand',
      originatorServerId: this.opts.serverId,
      executionIds: [...this.demandOut],
    });
  }

  /**
   * Fire-and-forget send for messages that are worthless once stale (agent
   * events, demand snapshots, backfill traffic). Never queues — see
   * `publishAgentEvent` for why.
   */
  private trySend(msg: HubMessage): boolean {
    if (!this.connected || !this.ws) return false;
    try {
      this.ws.send(JSON.stringify(msg));
      return true;
    } catch (err) {
      this.opts.logger.warn('Hub send failed (unqueued)', {
        kind: msg.kind,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  private drainQueue(): void {
    if (!this.connected || !this.ws) return;
    while (this.outbound.length > 0) {
      const next = this.outbound.shift()!;
      try {
        this.ws.send(JSON.stringify(next));
        this.eventsSent++;
      } catch (err) {
        // Put it back and stop draining; reconnect will retry.
        this.outbound.unshift(next);
        this.opts.logger.warn('Hub drain failed', {
          error: err instanceof Error ? err.message : String(err),
        });
        return;
      }
    }
  }

  private evictStaleDedupEntries(): void {
    const now = Date.now();
    for (const [id, ts] of this.recentEventIds) {
      if (now - ts > RECEIVED_DEDUP_TTL_MS) this.recentEventIds.delete(id);
    }
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function cryptoRandomUUID(): string {
  return randomUUID();
}

/**
 * `ws` emits either an `Error` (EventEmitter style) or an `ErrorEvent`-like
 * object on 'error'. The latter stringifies to "[object ErrorEvent]", hiding
 * the real cause — so normalize both into a readable message + optional code
 * (e.g. ECONNREFUSED, ENOTFOUND, or "Unexpected server response: 401").
 */
function describeWsError(err: unknown): { message: string; code?: string } {
  const e = err as { message?: unknown; code?: unknown; error?: { message?: unknown; code?: unknown } };
  const inner = e?.error;
  const message =
    (typeof e?.message === 'string' && e.message) ||
    (typeof inner?.message === 'string' && inner.message) ||
    String(err);
  const code =
    (typeof e?.code === 'string' && e.code) ||
    (typeof inner?.code === 'string' && inner.code) ||
    undefined;
  return { message, code };
}

/** Strip the base DomainEvent fields and keep event-type-specific payload. */
function serializePayload(event: AnyDomainEvent): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(event)) {
    if (k === 'type' || k === 'occurredAt') continue;
    out[k] = v;
  }
  return out;
}
