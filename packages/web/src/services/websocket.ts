import {
  WS_RECONNECT_INITIAL_MS,
  WS_RECONNECT_MAX_MS,
  WS_STALENESS_CHECK_INTERVAL_MS,
  WS_STALENESS_TIMEOUT_MS,
} from '@fleex/shared';
import type { WsChannel } from '@fleex/shared';

// Binary protocol (session-tagged):
// Client -> Server:
//   ATTACH:  [0x01][sessionId (UTF-8)][0x00][cols u16BE][rows u16BE]  (unchanged)
//   INPUT:   [0x02][sidLen u8][sid][data (UTF-8)]
//   RESIZE:  [0x03][sidLen u8][sid][cols u16BE][rows u16BE]
//   DETACH:  [0x04][sidLen u8][sid]
// Server -> Client:
//   ATTACHED: [0x01][sidLen u8][sid]
//   OUTPUT:   [0x02][sidLen u8][sid][data (UTF-8)]
//   EXIT:     [0x03][sidLen u8][sid][code u8]
//   ERROR:    [0x04][sidLen u8][sid][message (UTF-8)]

type Handler<T> = (data: T) => void;

export class WebSocketManager {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private url: string | null = null;
  private binaryQueue: ArrayBuffer[] = [];
  private textQueue: string[] = [];
  private channelHandlers = new Map<string, Set<Handler<{ type: string; data: unknown }>>>();
  private terminalHandlers = new Map<string, Set<Handler<ArrayBuffer>>>();
  private openHandlers = new Set<Handler<void>>();
  private closeHandlers = new Set<Handler<void>>();
  private lastMessageAt = 0;
  private stalenessTimer: ReturnType<typeof setInterval> | null = null;
  private connectTimeout: ReturnType<typeof setTimeout> | null = null;

  connect(url: string): void {
    this.url = url;
    this.reconnectAttempts = 0;
    this.startStalenessCheck();
    this.doConnect();
  }

  private doConnect(): void {
    if (!this.url) return;
    this.lastMessageAt = Date.now();

    const ws = new WebSocket(this.url);
    ws.binaryType = 'arraybuffer';

    this.connectTimeout = setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        ws.close();
      }
    }, 5000);

    ws.onopen = () => {
      if (this.connectTimeout) {
        clearTimeout(this.connectTimeout);
        this.connectTimeout = null;
      }
      this.reconnectAttempts = 0;
      this.lastMessageAt = Date.now();
      this.flushQueues();
      this.openHandlers.forEach((h) => h());
    };

    ws.onmessage = (event: MessageEvent) => {
      this.lastMessageAt = Date.now();

      if (event.data instanceof ArrayBuffer) {
        // Binary frame → session-tagged terminal data
        const view = new Uint8Array(event.data);
        if (view.length >= 2) {
          const msgType = view[0]!;
          const sidLen = view[1]!;
          if (view.length >= 2 + sidLen) {
            const sid = new TextDecoder().decode(view.subarray(2, 2 + sidLen));
            // Reconstruct stripped frame: [msgType][...rest] (same format old handlers expect)
            const rest = view.subarray(2 + sidLen);
            const stripped = new ArrayBuffer(1 + rest.length);
            const sv = new Uint8Array(stripped);
            sv[0] = msgType;
            sv.set(rest, 1);
            this.terminalHandlers.get(sid)?.forEach((h) => h(stripped));
          }
        }
      } else if (typeof event.data === 'string') {
        // Text frame → JSON channel message or ping
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'ping') return;
          const channel = msg.channel as string | undefined;
          if (channel) {
            this.channelHandlers.get(channel)?.forEach((h) => h(msg));
          }
        } catch {
          // ignore malformed JSON
        }
      }
    };

    ws.onclose = () => {
      this.ws = null;
      this.closeHandlers.forEach((h) => h());
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose will fire after onerror
    };

    this.ws = ws;
  }

  private scheduleReconnect(): void {
    if (!this.url) return;
    const delay =
      Math.min(WS_RECONNECT_INITIAL_MS * Math.pow(2, this.reconnectAttempts), WS_RECONNECT_MAX_MS) +
      Math.floor(Math.random() * 1000);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => this.doConnect(), delay);
  }

  private flushQueues(): void {
    for (const msg of this.textQueue) {
      this.ws?.send(msg);
    }
    this.textQueue = [];
    for (const msg of this.binaryQueue) {
      this.ws?.send(msg);
    }
    this.binaryQueue = [];
  }

  // ─── Send methods ───

  send(data: ArrayBuffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    } else {
      this.binaryQueue.push(data);
    }
  }

  sendChannel(channel: WsChannel, data: Record<string, unknown>): void {
    const text = JSON.stringify({ channel, ...data });
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(text);
    } else {
      this.textQueue.push(text);
    }
  }

  // ─── Subscribe methods ───

  onChannel(channel: string, handler: Handler<{ type: string; data: unknown }>): () => void {
    let handlers = this.channelHandlers.get(channel);
    if (!handlers) {
      handlers = new Set();
      this.channelHandlers.set(channel, handlers);
    }
    handlers.add(handler);
    return () => {
      handlers!.delete(handler);
      if (handlers!.size === 0) this.channelHandlers.delete(channel);
    };
  }

  onTerminal(sessionId: string, handler: Handler<ArrayBuffer>): () => void {
    let handlers = this.terminalHandlers.get(sessionId);
    if (!handlers) {
      handlers = new Set();
      this.terminalHandlers.set(sessionId, handlers);
    }
    handlers.add(handler);
    return () => {
      handlers!.delete(handler);
      if (handlers!.size === 0) this.terminalHandlers.delete(sessionId);
    };
  }

  onOpen(handler: Handler<void>): () => void {
    this.openHandlers.add(handler);
    return () => this.openHandlers.delete(handler);
  }

  onClose(handler: Handler<void>): () => void {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  disconnect(): void {
    this.url = null;
    if (this.connectTimeout) {
      clearTimeout(this.connectTimeout);
      this.connectTimeout = null;
    }
    if (this.stalenessTimer) {
      clearInterval(this.stalenessTimer);
      this.stalenessTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.binaryQueue = [];
    this.textQueue = [];
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private startStalenessCheck(): void {
    if (this.stalenessTimer) clearInterval(this.stalenessTimer);
    this.stalenessTimer = setInterval(() => {
      if (
        this.ws?.readyState === WebSocket.OPEN &&
        Date.now() - this.lastMessageAt > WS_STALENESS_TIMEOUT_MS
      ) {
        this.ws.close();
      }
    }, WS_STALENESS_CHECK_INTERVAL_MS);
  }

  // ─── Binary protocol helpers (terminal) ───

  sendAttach(sessionId: string, cols: number, rows: number): void {
    const encoder = new TextEncoder();
    const idBytes = encoder.encode(sessionId);
    const buf = new ArrayBuffer(1 + idBytes.length + 1 + 4);
    const view = new DataView(buf);
    const arr = new Uint8Array(buf);

    arr[0] = 0x01; // ATTACH
    arr.set(idBytes, 1);
    arr[1 + idBytes.length] = 0x00; // null separator
    view.setUint16(1 + idBytes.length + 1, cols, false);
    view.setUint16(1 + idBytes.length + 3, rows, false);

    this.send(buf);
  }

  sendInput(sessionId: string, data: string): void {
    const encoder = new TextEncoder();
    const sidBytes = encoder.encode(sessionId);
    const dataBytes = encoder.encode(data);
    const buf = new ArrayBuffer(1 + 1 + sidBytes.length + dataBytes.length);
    const arr = new Uint8Array(buf);

    arr[0] = 0x02; // INPUT
    arr[1] = sidBytes.length;
    arr.set(sidBytes, 2);
    arr.set(dataBytes, 2 + sidBytes.length);

    this.send(buf);
  }

  sendResize(sessionId: string, cols: number, rows: number): void {
    const encoder = new TextEncoder();
    const sidBytes = encoder.encode(sessionId);
    const buf = new ArrayBuffer(1 + 1 + sidBytes.length + 4);
    const view = new DataView(buf);
    const arr = new Uint8Array(buf);

    arr[0] = 0x03; // RESIZE
    arr[1] = sidBytes.length;
    arr.set(sidBytes, 2);
    view.setUint16(2 + sidBytes.length, cols, false);
    view.setUint16(2 + sidBytes.length + 2, rows, false);

    this.send(buf);
  }

  sendDetach(sessionId: string): void {
    const encoder = new TextEncoder();
    const sidBytes = encoder.encode(sessionId);
    const buf = new ArrayBuffer(1 + 1 + sidBytes.length);
    const arr = new Uint8Array(buf);

    arr[0] = 0x04; // DETACH
    arr[1] = sidBytes.length;
    arr.set(sidBytes, 2);

    this.send(buf);
  }
}

/** Single multiplexed WebSocket for the entire app */
export const appWs = new WebSocketManager();
