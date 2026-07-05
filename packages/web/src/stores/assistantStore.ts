import { create } from 'zustand';

/**
 * Shared client for the Fleex assistant companion (packages/sidepanel-host) —
 * the same backend as the Chrome side panel. One WebSocket, multiple persisted
 * conversations multiplexed by sessionId. Consumed by both the mobile
 * Assistant tab and the desktop Assistant panel.
 *
 * Reachability: `/assistant/*` is proxied to the companion (default
 * localhost:4399) — by Vite in dev, or a `tailscale serve --set-path` mount in
 * prod (see docs/mobile.md).
 */

export const ASSISTANT_BASE = '/assistant';

export type AssistantSessionStatus = 'idle' | 'working' | 'awaiting_input';

export interface AssistantSession {
  id: string;
  title: string;
  workspace?: string;
  model?: string;
  status: AssistantSessionStatus;
  messageCount: number;
  createdAt: string;
  /** Absent on sessions persisted by an older companion. */
  lastMessageAt?: string;
}

export interface AssistantWorkspace {
  name: string;
  isDefault: boolean;
  branch?: string | null;
}

export type AssistantToolStatus = 'running' | 'ok' | 'fail' | 'denied';

export type AssistantChatItem =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; id?: string; name: string; argv: string[]; status: AssistantToolStatus; text?: string };

export interface AssistantConfirmRequest {
  sessionId: string;
  id: string;
  name: string;
  argv: string[];
}

interface AssistantState {
  connected: boolean;
  sessions: AssistantSession[];
  activeId: string | null;
  itemsBySession: Record<string, AssistantChatItem[]>;
  confirmReq: AssistantConfirmRequest | null;
  errorMsg: string | null;
  workspaces: AssistantWorkspace[];

  /** Connect once and keep the socket for the app's lifetime (idempotent). */
  ensureConnected: () => void;
  newSession: (workspace?: string) => void;
  openSession: (id: string) => void;
  deleteSession: (id: string) => void;
  renameSession: (id: string, title: string) => void;
  setModel: (id: string, model: string | undefined) => void;
  sendUser: (text: string) => void;
  answerConfirm: (approved: boolean) => void;
  clearError: () => void;
}

// Socket lives outside the store: reconnects must not re-render on their own.
let ws: WebSocket | null = null;
let started = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function sendMsg(msg: Record<string, unknown>): void {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

export const useAssistantStore = create<AssistantState>((set, get) => {
  function appendItem(sessionId: string, item: AssistantChatItem): void {
    set((s) => ({
      itemsBySession: {
        ...s.itemsBySession,
        [sessionId]: [...(s.itemsBySession[sessionId] ?? []), item],
      },
    }));
  }

  function handleServerMessage(msg: Record<string, unknown>): void {
    const sessionId = msg.sessionId as string | undefined;
    switch (msg.type) {
      case 'sessions':
        set({ sessions: (msg.sessions as AssistantSession[]) ?? [] });
        break;
      case 'session_created': {
        const id = msg.id as string;
        set({ activeId: id });
        sendMsg({ type: 'open_session', id });
        break;
      }
      case 'session_history': {
        const id = msg.id as string;
        const transcript = (msg.transcript as unknown[]) ?? [];
        const items = transcript.map((t): AssistantChatItem => {
          const o = t as Record<string, unknown>;
          if (o.tool) {
            const tool = o.tool as { name: string; argv: string[]; status: AssistantToolStatus; text?: string };
            return { kind: 'tool', name: tool.name, argv: tool.argv ?? [], status: tool.status, text: tool.text };
          }
          return { kind: o.role === 'user' ? 'user' : 'assistant', text: (o.text as string) ?? '' };
        });
        set((s) => ({ itemsBySession: { ...s.itemsBySession, [id]: items } }));
        break;
      }
      case 'text': {
        if (!sessionId) break;
        const delta = msg.text as string;
        set((s) => {
          const items = s.itemsBySession[sessionId] ?? [];
          const last = items[items.length - 1];
          const next =
            last?.kind === 'assistant'
              ? [...items.slice(0, -1), { kind: 'assistant' as const, text: last.text + delta }]
              : [...items, { kind: 'assistant' as const, text: delta }];
          return { itemsBySession: { ...s.itemsBySession, [sessionId]: next } };
        });
        break;
      }
      case 'tool_call':
        if (!sessionId) break;
        appendItem(sessionId, {
          kind: 'tool',
          id: msg.id as string,
          name: msg.name as string,
          argv: (msg.argv as string[]) ?? [],
          status: 'running',
        });
        break;
      case 'tool_result':
      case 'tool_denied': {
        if (!sessionId) break;
        const status: AssistantToolStatus =
          msg.type === 'tool_denied' ? 'denied' : (msg.ok as boolean) ? 'ok' : 'fail';
        set((s) => ({
          itemsBySession: {
            ...s.itemsBySession,
            [sessionId]: (s.itemsBySession[sessionId] ?? []).map((it) =>
              it.kind === 'tool' && it.id === msg.id
                ? { ...it, status, text: (msg.text as string | undefined) ?? it.text }
                : it,
            ),
          },
        }));
        break;
      }
      case 'confirm_request':
        set({
          confirmReq: {
            sessionId: sessionId ?? '',
            id: msg.id as string,
            name: msg.name as string,
            argv: (msg.argv as string[]) ?? [],
          },
        });
        break;
      case 'error':
        if (!sessionId || sessionId === get().activeId) {
          set({ errorMsg: msg.message as string });
        }
        break;
      default:
        break;
    }
  }

  function connect(): void {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${proto}//${window.location.host}${ASSISTANT_BASE}/chat`);
    ws = socket;

    socket.onopen = () => {
      if (ws !== socket) return;
      set({ connected: true, errorMsg: null });
      const activeId = get().activeId;
      if (activeId) socket.send(JSON.stringify({ type: 'open_session', id: activeId }));
      fetch(`${ASSISTANT_BASE}/workspaces`)
        .then((r) => (r.ok ? r.json() : []))
        .then((list: AssistantWorkspace[]) => set({ workspaces: Array.isArray(list) ? list : [] }))
        .catch(() => {});
    };
    socket.onclose = () => {
      // A stale socket (replaced by a reconnect) must not clobber the live one.
      if (ws === socket) {
        ws = null;
        set({ connected: false });
        retryTimer = setTimeout(connect, 3000);
      }
    };
    socket.onmessage = (event) => {
      if (ws !== socket) return;
      try {
        handleServerMessage(JSON.parse(event.data as string));
      } catch {
        // ignore malformed frames
      }
    };
  }

  return {
    connected: false,
    sessions: [],
    activeId: null,
    itemsBySession: {},
    confirmReq: null,
    errorMsg: null,
    workspaces: [],

    ensureConnected: () => {
      if (started) return;
      started = true;
      connect();
    },

    newSession: (workspace) => {
      sendMsg({ type: 'new_session', ...(workspace ? { workspace } : {}) });
    },

    openSession: (id) => {
      set({ activeId: id, errorMsg: null });
      sendMsg({ type: 'open_session', id });
    },

    deleteSession: (id) => {
      sendMsg({ type: 'delete_session', id });
      set((s) => {
        const { [id]: _dropped, ...rest } = s.itemsBySession;
        return {
          itemsBySession: rest,
          activeId: s.activeId === id ? null : s.activeId,
        };
      });
    },

    renameSession: (id, title) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      sendMsg({ type: 'rename_session', id, title: trimmed });
    },

    setModel: (id, model) => {
      sendMsg({ type: 'set_model', id, model: model || undefined });
    },

    sendUser: (text) => {
      const activeId = get().activeId;
      const trimmed = text.trim();
      if (!activeId || !trimmed) return;
      set((s) => ({
        errorMsg: null,
        itemsBySession: {
          ...s.itemsBySession,
          [activeId]: [...(s.itemsBySession[activeId] ?? []), { kind: 'user', text: trimmed }],
        },
      }));
      sendMsg({ type: 'user', sessionId: activeId, text: trimmed });
    },

    answerConfirm: (approved) => {
      const req = get().confirmReq;
      if (!req) return;
      sendMsg({ type: 'confirm', id: req.id, approved });
      set({ confirmReq: null });
    },

    clearError: () => set({ errorMsg: null }),
  };
});

// Test-only escape hatch: reset the module-level socket state.
export function __resetAssistantSocketForTests(): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  if (ws) {
    ws.onclose = null;
    ws.close();
  }
  ws = null;
  started = false;
}
