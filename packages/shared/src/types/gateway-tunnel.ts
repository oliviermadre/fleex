// ── Gateway Tunnel Binary Protocol ──
//
// Frame format:  [channelId: u32 BE][msgType: u8][payload: ...]
// Total header = 5 bytes.
//
// channelId=0 is reserved for the control channel (handshake, exec, fs, ping/pong).
// channelId>0 is used for multiplexed PTY streams.

// ── Control Channel Message Types (channelId=0) ──

export enum TunnelMsgType {
  // Handshake (gateway → server)
  HELLO           = 0x01,
  // Handshake response (server → gateway)
  HELLO_ACK       = 0x02,
  // Challenge sent by server after WS open
  CHALLENGE       = 0x03,

  // Exec request/response
  EXEC_REQ        = 0x10,
  EXEC_RES        = 0x11,

  // Filesystem request/response
  FS_REQ          = 0x20,
  FS_RES          = 0x21,

  // PTY lifecycle (channelId > 0)
  PTY_OPEN        = 0x30,
  PTY_OPENED      = 0x31,
  PTY_DATA        = 0x32,
  PTY_RESIZE      = 0x33,
  PTY_CLOSE       = 0x34,
  PTY_EXIT        = 0x35,
  PTY_ERROR       = 0x36,

  // Keep-alive
  PING            = 0xFE,
  PONG            = 0xFF,

  // Error on control channel
  ERROR           = 0xF0,
}

// ── JSON payloads carried inside frames ──

export interface TunnelHelloPayload {
  gatewayId: string;
  signature: string;   // hex-encoded Ed25519 signature of the challenge
  name?: string;
  hostname?: string;
}

export interface TunnelHelloAckPayload {
  ok: true;
}

export interface TunnelChallengePayload {
  challenge: string;   // hex-encoded random 32 bytes
}

export interface TunnelExecReqPayload {
  reqId: string;       // correlation ID (UUID or counter)
  command: string;
  args: string[];
  cwd?: string;
  timeout?: number;
  maxBuffer?: number;
  shell?: boolean;
}

export interface TunnelExecResPayload {
  reqId: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  error?: string;
}

export interface TunnelFsReqPayload {
  reqId: string;
  op: string;
  path: string;
  content?: string;
  bytes?: number;
  recursive?: boolean;
}

export interface TunnelFsResPayload {
  reqId: string;
  data?: unknown;
  error?: string;
}

export interface TunnelPtyOpenPayload {
  tmuxSessionName: string;
  cols: number;
  rows: number;
}

export interface TunnelPtyOpenedPayload {
  ok: true;
}

export interface TunnelPtyResizePayload {
  cols: number;
  rows: number;
}

export interface TunnelPtyExitPayload {
  exitCode: number;
}

export interface TunnelPtyErrorPayload {
  message: string;
}

export interface TunnelErrorPayload {
  message: string;
}

// ── Constants ──

export const TUNNEL_HEADER_SIZE = 5; // 4 (channelId) + 1 (msgType)
export const TUNNEL_CONTROL_CHANNEL = 0;
export const WS_GATEWAY_TUNNEL_PATH = '/ws/gateway-tunnel';

export const TUNNEL_PING_INTERVAL_MS = 15_000;
export const TUNNEL_PONG_TIMEOUT_MS = 10_000;
export const TUNNEL_RECONNECT_INITIAL_MS = 1_000;
export const TUNNEL_RECONNECT_MAX_MS = 30_000;
