// ── Tunnel binary frame codec ──
//
// Encodes / decodes frames for the gateway reverse-tunnel protocol.
// Works in both Node.js (Buffer) and Bun (Uint8Array) environments.
// The consuming packages (server, host-gateway) provide Buffer at runtime.

import {
  TUNNEL_HEADER_SIZE,
  type TunnelMsgType,
} from './types/gateway-tunnel.js';

declare const Buffer: {
  from(input: string, encoding: string): Uint8Array;
  from(input: ArrayBuffer | ArrayBufferLike, byteOffset?: number, length?: number): { toString(encoding: string): string };
} | undefined;

export interface TunnelFrame {
  channelId: number;
  msgType: TunnelMsgType;
  payload: Uint8Array;
}

function stringToBytes(str: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(str, 'utf-8');
  }
  const arr: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i);
    if (code < 0x80) {
      arr.push(code);
    } else if (code < 0x800) {
      arr.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else {
      arr.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return new Uint8Array(arr);
}

function bytesToString(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('utf-8');
  }
  let result = '';
  for (let i = 0; i < bytes.length; i++) {
    result += String.fromCharCode(bytes[i]!);
  }
  return result;
}

/**
 * Encode a frame with a JSON payload.
 */
export function encodeTunnelJson(
  channelId: number,
  msgType: TunnelMsgType,
  data: unknown,
): Uint8Array {
  const json = JSON.stringify(data);
  const textBytes = stringToBytes(json);
  return encodeTunnelRaw(channelId, msgType, textBytes);
}

/**
 * Encode a frame with raw binary payload.
 */
export function encodeTunnelRaw(
  channelId: number,
  msgType: TunnelMsgType,
  payload: Uint8Array,
): Uint8Array {
  const frame = new Uint8Array(TUNNEL_HEADER_SIZE + payload.byteLength);
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  view.setUint32(0, channelId, false); // BE
  frame[4] = msgType;
  frame.set(payload, TUNNEL_HEADER_SIZE);
  return frame;
}

/**
 * Encode a header-only frame (no payload), e.g. PING / PONG.
 */
export function encodeTunnelEmpty(
  channelId: number,
  msgType: TunnelMsgType,
): Uint8Array {
  const frame = new Uint8Array(TUNNEL_HEADER_SIZE);
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  view.setUint32(0, channelId, false);
  frame[4] = msgType;
  return frame;
}

/**
 * Decode a raw binary message into a TunnelFrame.
 * Accepts Buffer or Uint8Array.
 */
export function decodeTunnelFrame(raw: Uint8Array | ArrayBuffer): TunnelFrame {
  const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  if (bytes.byteLength < TUNNEL_HEADER_SIZE) {
    throw new Error(`Tunnel frame too short: ${bytes.byteLength} bytes`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const channelId = view.getUint32(0, false);
  const msgType = bytes[4] as TunnelMsgType;
  const payload = bytes.subarray(TUNNEL_HEADER_SIZE);
  return { channelId, msgType, payload };
}

/**
 * Parse the payload of a frame as JSON.
 */
export function parseTunnelJson<T = unknown>(payload: Uint8Array): T {
  const text = bytesToString(payload);
  return JSON.parse(text) as T;
}
