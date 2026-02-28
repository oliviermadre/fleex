/**
 * Wire protocol for the gateway ↔ server WebSocket tunnel.
 *
 * All frames are binary (Uint8Array). The first byte identifies the frame type:
 *
 *   0x01  JSON  – request/response, auth, control messages
 *   0x02  PTY data – binary terminal I/O, prefixed with channelId
 *   0x03  PTY control – JSON lifecycle events, prefixed with type byte
 *
 * Encoding helpers use only Uint8Array / DataView / TextEncoder (no Node Buffer)
 * so this module works in both browser and Node environments.
 */

// ── Frame type constants ──────────────────────────────────────────

export const TunnelFrame = {
  /** JSON request/response envelope (existing tunnel protocol). */
  JSON: 0x01,
  /** Binary PTY data: [0x02][uint32BE channelId][...payload]. */
  PTY_DATA: 0x02,
  /** JSON PTY control: [0x03][JSON bytes]. */
  PTY_CTRL: 0x03,
} as const;

export type TunnelFrameType = (typeof TunnelFrame)[keyof typeof TunnelFrame];

// ── Auth messages (sent as JSON frames) ───────────────────────────

export interface TunnelAuthMessage {
  type: 'auth';
  secret: string;
  name: string;
  hostname: string;
}

export interface TunnelAuthOkMessage {
  type: 'auth_ok';
}

export interface TunnelAuthErrorMessage {
  type: 'auth_error';
  reason: string;
}

// ── JSON request/response (sent as JSON frames) ──────────────────

export interface TunnelRequest {
  id: string;
  method: string;
  path: string;
  body?: unknown;
}

export interface TunnelResponse {
  id: string;
  status: number;
  body?: unknown;
  error?: string;
}

// ── PTY control messages (sent as PTY_CTRL frames) ───────────────

export interface PtyOpenMessage {
  channelId: number;
  action: 'open';
  tmuxSessionName: string;
  cols: number;
  rows: number;
}

export interface PtyOpenedMessage {
  channelId: number;
  action: 'opened';
}

export interface PtyResizeMessage {
  channelId: number;
  action: 'resize';
  cols: number;
  rows: number;
}

export interface PtyExitMessage {
  channelId: number;
  action: 'exit';
  exitCode: number;
}

export interface PtyErrorMessage {
  channelId: number;
  action: 'error';
  message: string;
}

export interface PtyCloseMessage {
  channelId: number;
  action: 'close';
}

export type PtyControlMessage =
  | PtyOpenMessage
  | PtyOpenedMessage
  | PtyResizeMessage
  | PtyExitMessage
  | PtyErrorMessage
  | PtyCloseMessage;

// ── Shared encoder/decoder instances ─────────────────────────────
// TextEncoder/TextDecoder are available in all modern runtimes (Node, Bun, browsers)
// but not included in TS lib: ["ES2022"]. Declare them to avoid a DOM lib dependency.

declare const TextEncoder: { new (): { encode(input: string): Uint8Array } };
declare const TextDecoder: { new (): { decode(input: Uint8Array): string } };

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

// ── Frame encoding helpers ───────────────────────────────────────

/** Encode a JSON message into a tunnel frame (0x01 prefix). */
export function encodeJsonFrame(msg: unknown): Uint8Array {
  const json = textEncoder.encode(JSON.stringify(msg));
  const buf = new Uint8Array(1 + json.length);
  buf[0] = TunnelFrame.JSON;
  buf.set(json, 1);
  return buf;
}

/** Encode binary PTY data into a tunnel frame (0x02 prefix + channelId). */
export function encodePtyDataFrame(channelId: number, data: Uint8Array): Uint8Array {
  const buf = new Uint8Array(1 + 4 + data.length);
  buf[0] = TunnelFrame.PTY_DATA;
  new DataView(buf.buffer).setUint32(1, channelId, false); // big-endian
  buf.set(data, 5);
  return buf;
}

/** Encode a PTY control message into a tunnel frame (0x03 prefix). */
export function encodePtyCtrlFrame(msg: PtyControlMessage): Uint8Array {
  const json = textEncoder.encode(JSON.stringify(msg));
  const buf = new Uint8Array(1 + json.length);
  buf[0] = TunnelFrame.PTY_CTRL;
  buf.set(json, 1);
  return buf;
}

/** Parse the frame type from raw data. Returns null if data is too short. */
export function parseFrameType(data: Uint8Array): TunnelFrameType | null {
  if (data.length < 1) return null;
  const type = data[0] as number;
  if (type === TunnelFrame.JSON || type === TunnelFrame.PTY_DATA || type === TunnelFrame.PTY_CTRL) {
    return type;
  }
  return null;
}

/** Extract JSON payload from a JSON frame (after 0x01 byte). */
export function parseJsonPayload<T = unknown>(data: Uint8Array): T {
  return JSON.parse(textDecoder.decode(data.subarray(1)));
}

/** Extract channelId and binary payload from a PTY data frame. */
export function parsePtyDataPayload(data: Uint8Array): { channelId: number; payload: Uint8Array } {
  const channelId = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(1, false);
  const payload = data.subarray(5);
  return { channelId, payload };
}

/** Extract PTY control message from a PTY ctrl frame. */
export function parsePtyCtrlPayload(data: Uint8Array): PtyControlMessage {
  return JSON.parse(textDecoder.decode(data.subarray(1)));
}
