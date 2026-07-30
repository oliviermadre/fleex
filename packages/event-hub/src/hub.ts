import type { ServerWebSocket } from 'bun';
import type { HubMessage, HubRelayMessage } from '@fleex/shared';

export interface HubClientData {
  /** Authenticated client name (from authorized_clients file). */
  clientName: string;
  serverId: string | null;
  pid: number | null;
  hostname: string | null;
  connectedAt: number;
}

export interface HubStats {
  connectedServers: number;
  eventsForwarded: number;
  startedAt: number;
  servers: Array<{
    clientName: string;
    serverId: string | null;
    pid: number | null;
    hostname: string | null;
    connectedAt: number;
  }>;
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

  /**
   * Forward a relayable message from `from` to every other connected server.
   *
   * Deliberately shape-agnostic: domain events, agent events, stream-demand
   * snapshots and backfill traffic all go through here. The hub does no
   * addressing, filtering or bookkeeping beyond "not back to the sender" —
   * receivers decide what concerns them (including `targetServerId`).
   */
  forward(from: ServerWebSocket<HubClientData>, message: HubRelayMessage): number {
    const payload = JSON.stringify(message);
    let delivered = 0;
    for (const ws of this.clients) {
      if (ws === from) continue;
      // Defensively guard against same serverId reconnecting on a new socket.
      if (ws.data.serverId && ws.data.serverId === message.originatorServerId) continue;
      ws.send(payload);
      delivered++;
    }
    this.eventsForwarded += delivered;
    return delivered;
  }

  send(ws: ServerWebSocket<HubClientData>, msg: HubMessage): void {
    ws.send(JSON.stringify(msg));
  }

  /** Close every socket whose clientName is no longer authorized. */
  disconnectRevoked(isAuthorized: (clientName: string) => boolean): string[] {
    const closed: string[] = [];
    for (const ws of this.clients) {
      if (!isAuthorized(ws.data.clientName)) {
        try { ws.close(4001, 'revoked'); } catch { /* ignore */ }
        closed.push(ws.data.clientName);
      }
    }
    return closed;
  }

  stats(): HubStats {
    const servers = Array.from(this.clients).map((ws) => ({
      clientName: ws.data.clientName,
      serverId: ws.data.serverId,
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
