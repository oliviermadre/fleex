import type { ServerWebSocket } from 'bun';
import type { HubEventMessage, HubMessage } from '@fleex/shared';

export interface HubClientData {
  serverId: string | null;
  pid: number | null;
  hostname: string | null;
  connectedAt: number;
}

export interface HubStats {
  connectedServers: number;
  eventsForwarded: number;
  startedAt: number;
  servers: Array<{ serverId: string; pid: number | null; hostname: string | null; connectedAt: number }>;
}

/**
 * In-memory registry of connected servers + pure fan-out logic.
 *
 * No DB, no persistence. If the hub dies, in-flight events are lost; servers
 * reconnect with backoff and resume publishing. Each receiver dedups by
 * eventId to tolerate the rare case where the hub re-delivers.
 */
export class Hub {
  private readonly clients = new Set<ServerWebSocket<HubClientData>>();
  private eventsForwarded = 0;
  private readonly startedAt = Date.now();

  register(ws: ServerWebSocket<HubClientData>): void {
    this.clients.add(ws);
  }

  unregister(ws: ServerWebSocket<HubClientData>): void {
    this.clients.delete(ws);
  }

  /** Forward an event from `from` to every other connected server. */
  forward(from: ServerWebSocket<HubClientData>, event: HubEventMessage): number {
    const payload = JSON.stringify(event);
    let delivered = 0;
    for (const ws of this.clients) {
      if (ws === from) continue;
      // Also defensively guard against same serverId reconnecting on a new socket.
      if (ws.data.serverId && ws.data.serverId === event.originatorServerId) continue;
      ws.send(payload);
      delivered++;
    }
    this.eventsForwarded += delivered;
    return delivered;
  }

  send(ws: ServerWebSocket<HubClientData>, msg: HubMessage): void {
    ws.send(JSON.stringify(msg));
  }

  stats(): HubStats {
    const servers = Array.from(this.clients)
      .filter((ws) => ws.data.serverId)
      .map((ws) => ({
        serverId: ws.data.serverId!,
        pid: ws.data.pid,
        hostname: ws.data.hostname,
        connectedAt: ws.data.connectedAt,
      }));
    return {
      connectedServers: servers.length,
      eventsForwarded: this.eventsForwarded,
      startedAt: this.startedAt,
      servers,
    };
  }
}
