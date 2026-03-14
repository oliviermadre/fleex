import type { SessionGroup } from './session.js';
import type { ClaudeUsage } from './claude-usage.js';

// Binary protocol message types (byte[0] prefix)
export const ClientMessageType = {
  ATTACH: 0x01,
  INPUT: 0x02,
  RESIZE: 0x03,
  DETACH: 0x04,
} as const;
export type ClientMessageType = (typeof ClientMessageType)[keyof typeof ClientMessageType];

export const ServerMessageType = {
  ATTACHED: 0x01,
  OUTPUT: 0x02,
  EXIT: 0x03,
  ERROR: 0x04,
} as const;
export type ServerMessageType = (typeof ServerMessageType)[keyof typeof ServerMessageType];

// Dashboard WebSocket (JSON text frames)
export type DashboardMessage =
  | SessionsUpdatedMessage
  | SessionCreatedMessage
  | SessionRemovedMessage
  | UsageUpdatedMessage;

export interface SessionsUpdatedMessage {
  readonly type: 'sessions:updated';
  readonly data: SessionGroup[];
}

export interface SessionCreatedMessage {
  readonly type: 'session:created';
  readonly data: { sessionId: string };
}

export interface SessionRemovedMessage {
  readonly type: 'session:removed';
  readonly data: { sessionId: string };
}

export interface UsageUpdatedMessage {
  readonly type: 'usage:updated';
  readonly data: ClaudeUsage;
}
