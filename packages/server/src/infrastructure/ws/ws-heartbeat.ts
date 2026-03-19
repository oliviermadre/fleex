import type { WebSocket } from 'ws';
import { WS_PING_INTERVAL_MS } from '@fleex/shared';

const aliveMap = new WeakMap<WebSocket, boolean>();
const pingPayload = JSON.stringify({ type: 'ping' });

export class WsHeartbeat {
  private sockets = new Set<WebSocket>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.timer = setInterval(() => this.tick(), WS_PING_INTERVAL_MS);
  }

  register(ws: WebSocket): void {
    aliveMap.set(ws, true);
    this.sockets.add(ws);
    ws.on('pong', () => {
      aliveMap.set(ws, true);
    });
  }

  unregister(ws: WebSocket): void {
    this.sockets.delete(ws);
    aliveMap.delete(ws);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.sockets.clear();
  }

  private tick(): void {
    for (const ws of this.sockets) {
      if (aliveMap.get(ws) === false) {
        this.sockets.delete(ws);
        ws.terminate();
        continue;
      }
      aliveMap.set(ws, false);
      ws.ping();
      if (ws.readyState === 1) {
        ws.send(pingPayload);
      }
    }
  }
}
