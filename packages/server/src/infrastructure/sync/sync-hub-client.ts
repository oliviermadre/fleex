import WebSocket from 'ws';
import type { LoggerPort } from '../../application/ports/logger.port.js';

/**
 * Lightweight event payload sent over the sync hub.
 * Intentionally minimal — the receiving server reloads from DB.
 */
export interface SyncEvent {
  eventType: string;
  entityId: string;
  /** Secondary ID for child entities (e.g. ticketId for comments) */
  secondaryId?: string;
}

export interface SyncHubClientOptions {
  hubUrl: string;
  instanceId: string;
  token?: string;
  logger: LoggerPort;
  onRemoteEvent: (event: SyncEvent, senderInstanceId: string) => void;
}

/**
 * Client that connects a Fleex server instance to a Sync Hub.
 *
 * - Pushes local domain events to the hub for relay to other instances.
 * - Receives remote events and calls the handler for cache invalidation.
 * - Auto-reconnects with exponential backoff.
 */
export class SyncHubClient {
  private ws: WebSocket | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private closing = false;
  private identified = false;

  constructor(private readonly opts: SyncHubClientOptions) {}

  connect(): void {
    if (this.closing) return;

    const url = new URL(this.opts.hubUrl);
    if (this.opts.token) {
      url.searchParams.set('token', this.opts.token);
    }

    this.opts.logger.info('Sync hub connecting', { url: url.origin + url.pathname });

    const ws = new WebSocket(url.toString());
    this.ws = ws;

    ws.on('open', () => {
      this.reconnectDelay = 1000;
      this.identified = false;

      // Identify ourselves
      ws.send(JSON.stringify({
        type: 'identify',
        instanceId: this.opts.instanceId,
      }));

      this.opts.logger.info('Sync hub connected');
    });

    ws.on('message', (raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg['type'] === 'identified') {
        this.identified = true;
        this.opts.logger.info('Sync hub identified', {
          instanceId: this.opts.instanceId,
          peers: msg['clients'],
        });
        return;
      }

      if (msg['type'] === 'event') {
        const senderInstanceId = msg['instanceId'] as string;
        const event: SyncEvent = {
          eventType: msg['eventType'] as string,
          entityId: msg['entityId'] as string,
          secondaryId: msg['secondaryId'] as string | undefined,
        };
        this.opts.onRemoteEvent(event, senderInstanceId);
      }
    });

    ws.on('close', () => {
      this.identified = false;
      if (!this.closing) {
        this.opts.logger.info('Sync hub disconnected, reconnecting', {
          delayMs: this.reconnectDelay,
        });
        setTimeout(() => this.connect(), this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
      }
    });

    ws.on('error', (err) => {
      this.opts.logger.error('Sync hub connection error', {
        error: err.message,
      });
      // close event will trigger reconnect
    });
  }

  /**
   * Push a local domain event to the sync hub for relay to other instances.
   */
  pushEvent(event: SyncEvent): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.identified) return;

    try {
      this.ws.send(JSON.stringify({
        type: 'event',
        instanceId: this.opts.instanceId,
        eventType: event.eventType,
        entityId: event.entityId,
        secondaryId: event.secondaryId,
      }));
    } catch {
      // Silently drop — reconnect will happen
    }
  }

  close(): void {
    this.closing = true;
    if (this.ws) {
      this.ws.close(1000, 'shutdown');
      this.ws = null;
    }
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this.identified;
  }
}
