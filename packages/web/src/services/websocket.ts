import {
  WS_RECONNECT_INITIAL_MS,
  WS_RECONNECT_MAX_MS,
  WS_RECONNECT_MAX_ATTEMPTS,
} from '@fleex/shared';

// Binary protocol:
// Client -> Server:
//   ATTACH:  [0x01][sessionId (UTF-8)][0x00][cols u16BE][rows u16BE]
//   INPUT:   [0x02][data (UTF-8)]
//   RESIZE:  [0x03][cols u16BE][rows u16BE]
//   DETACH:  [0x04]
// Server -> Client:
//   ATTACHED: [0x01]
//   OUTPUT:   [0x02][data (UTF-8)]
//   EXIT:     [0x03][code u8]
//   ERROR:    [0x04][message (UTF-8)]

type Handler<T> = (data: T) => void;

export class WebSocketManager {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private url: string | null = null;
  private messageQueue: ArrayBuffer[] = [];
  private messageHandlers = new Set<Handler<ArrayBuffer>>();
  private openHandlers = new Set<Handler<void>>();
  private closeHandlers = new Set<Handler<void>>();

  connect(url: string): void {
    this.url = url;
    this.reconnectAttempts = 0;
    this.doConnect();
  }

  private doConnect(): void {
    if (!this.url) return;

    const ws = new WebSocket(this.url);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.flushQueue();
      this.openHandlers.forEach((h) => h());
    };

    ws.onmessage = (event: MessageEvent) => {
      let buf: ArrayBuffer;
      if (event.data instanceof ArrayBuffer) {
        buf = event.data;
      } else if (typeof event.data === 'string') {
        buf = new TextEncoder().encode(event.data).buffer as ArrayBuffer;
      } else {
        return;
      }
      this.messageHandlers.forEach((h) => h(buf));
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
    if (this.reconnectAttempts >= WS_RECONNECT_MAX_ATTEMPTS) return;

    const delay = Math.min(
      WS_RECONNECT_INITIAL_MS * Math.pow(2, this.reconnectAttempts),
      WS_RECONNECT_MAX_MS
    );
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => this.doConnect(), delay);
  }

  private flushQueue(): void {
    for (const msg of this.messageQueue) {
      this.ws?.send(msg);
    }
    this.messageQueue = [];
  }

  send(data: ArrayBuffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    } else {
      this.messageQueue.push(data);
    }
  }

  sendJson(data: unknown): void {
    const encoded = new TextEncoder().encode(JSON.stringify(data));
    this.send(encoded.buffer as ArrayBuffer);
  }

  onMessage(handler: Handler<ArrayBuffer>): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
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
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.messageQueue = [];
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  // --- Binary protocol helpers ---

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

  sendInput(data: string): void {
    const encoder = new TextEncoder();
    const dataBytes = encoder.encode(data);
    const buf = new ArrayBuffer(1 + dataBytes.length);
    const arr = new Uint8Array(buf);

    arr[0] = 0x02; // INPUT
    arr.set(dataBytes, 1);

    this.send(buf);
  }

  sendResize(cols: number, rows: number): void {
    const buf = new ArrayBuffer(5);
    const view = new DataView(buf);
    const arr = new Uint8Array(buf);

    arr[0] = 0x03; // RESIZE
    view.setUint16(1, cols, false);
    view.setUint16(3, rows, false);

    this.send(buf);
  }

  sendDetach(): void {
    const buf = new ArrayBuffer(1);
    new Uint8Array(buf)[0] = 0x04; // DETACH
    this.send(buf);
  }
}

export const terminalWs = new WebSocketManager();
export const dashboardWs = new WebSocketManager();
export const repositoryWs = new WebSocketManager();
export const ticketWs = new WebSocketManager();
export const personaWs = new WebSocketManager();
export const skillWs = new WebSocketManager();
export const agentEventWs = new WebSocketManager();
