import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

import { WebSocket } from 'ws';

import { HUB_SHARED_EXCLUDED, type HubEventMessage, type HubMessage } from '@fleex/shared';

import type { LoggerPort } from '../../application/ports/logger.port.js';
import type { AnyDomainEvent } from '../../domain/events.js';

const SERVER_VERSION = '0.1.0';
const PING_INTERVAL_MS = 20_000;
const QUEUE_CAP = 1000;
const RECONNECT_INITIAL_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
const RECEIVED_DEDUP_TTL_MS = 30_000;

export interface HubClientOptions {
  url: string;
  token: string | undefined;
  serverId: string;
  logger: LoggerPort;
  onRemoteEvent: (event: AnyDomainEvent) => void;
}

export interface HubClientStats {
  connected: boolean;
  reconnectAttempts: number;
  eventsSent: number;
  eventsReceived: number;
  eventsDropped: number;
  queueLength: number;
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

  constructor(private readonly opts: HubClientOptions) {}

  start(): void {
    this.connect();
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* swallow */
      }
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

  stats(): HubClientStats {
    return {
      connected: this.connected,
      reconnectAttempts: this.reconnectAttempts,
      eventsSent: this.eventsSent,
      eventsReceived: this.eventsReceived,
      eventsDropped: this.eventsDropped,
      queueLength: this.outbound.length,
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

      this.pingTimer = setInterval(() => {
        if (this.connected && this.ws) {
          try {
            this.ws.send(JSON.stringify({ kind: 'ping' } satisfies HubMessage));
          } catch {
            /* swallow */
          }
        }
      }, PING_INTERVAL_MS);
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
      try {
        this.ws.removeAllListeners();
      } catch {
        /* swallow */
      }
      this.ws = null;
    }
    if (this.closed) return;

    this.reconnectAttempts++;
    const base = Math.min(
      RECONNECT_INITIAL_MS * 2 ** (this.reconnectAttempts - 1),
      RECONNECT_MAX_MS,
    );
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
        try {
          this.ws.send(JSON.stringify({ kind: 'pong' } satisfies HubMessage));
        } catch {
          /* swallow */
        }
      }
      return;
    }
    if (msg.kind === 'hello') return; // hub doesn't say hello
    if (msg.kind !== 'event') return;

    if (msg.originatorServerId === this.opts.serverId) return; // never re-ingest our own

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
  const e = err as {
    message?: unknown;
    code?: unknown;
    error?: { message?: unknown; code?: unknown };
  };
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
