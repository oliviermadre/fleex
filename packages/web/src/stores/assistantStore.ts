import { create } from 'zustand';
import { useSettingsStore } from './settingsStore';

/**
 * Shared client for the Fleex assistant companion (packages/sidepanel-host) —
 * the same backend as the Chrome side panel. One WebSocket, multiple persisted
 * conversations multiplexed by sessionId. Consumed by both the mobile
 * Assistant tab and the desktop Assistant panel.
 *
 * Reachability: `/companion/*` is proxied to the companion (default
 * localhost:4399) — by Vite in dev, or a `tailscale serve --set-path` mount in
 * prod (see docs/mobile.md). The prefix is deliberately NOT `/assistant`,
 * which is the desktop SPA route and would shadow it.
 */

export const ASSISTANT_BASE = '/companion';

export type AssistantSessionStatus = 'idle' | 'working' | 'awaiting_input';

/** Mutating commands this conversation runs without asking again. */
export interface AssistantAutoApprove {
  all: boolean;
  tools: string[];
}

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
  /** Absent when served by an older companion — treat as nothing approved. */
  autoApprove?: AssistantAutoApprove;
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
  | {
      kind: 'tool';
      id?: string;
      name: string;
      argv: string[];
      status: AssistantToolStatus;
      text?: string;
      /** Ran without a confirmation — surfaced in the transcript for audit. */
      autoApproved?: boolean;
    };

/** `fleex_ticket_create` → `ticket create`, for labels a human can read. */
export function toolLabel(name: string): string {
  return name.replace(/^fleex_/, '').replace(/_/g, ' ');
}

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
  /** Pending mutating-command approvals — one per session can be in flight. */
  confirmReqs: AssistantConfirmRequest[];
  errorMsg: string | null;
  workspaces: AssistantWorkspace[];
  /** Set when the server disarmed auto-approval on its own; null = nothing to say. */
  autoApproveNotice: string | null;

  /** Connect once and keep the socket for the app's lifetime (idempotent). */
  ensureConnected: () => void;
  newSession: (workspace?: string) => void;
  /**
   * File an exchange that happened elsewhere into a conversation.
   *
   * Every question the command palette answers from memory is kept, so asking
   * something is never a thing you lose. Repeated calls with the same `id` append
   * to the same thread; the caller mints the id so a run of follow-ups stays
   * together without waiting for a reply between them.
   *
   * Records only — it does not activate or open the conversation, because using
   * the palette must not yank the assistant view around.
   */
  recordExchange: (id: string, question: string, answer: string) => void;
  /**
   * Show a conversation, optionally asking it something on arrival.
   *
   * `prompt` is for a surface that has a question in hand — the Ask Memory panel
   * hands over what was typed there, which used to be dropped on navigation and
   * had to be retyped here.
   */
  openSession: (id: string, prompt?: string) => void;
  deleteSession: (id: string) => void;
  renameSession: (id: string, title: string) => void;
  setModel: (id: string, model: string | undefined) => void;
  sendUser: (text: string) => void;
  /** `always` upgrades an approval into a standing one for this conversation. */
  answerConfirm: (id: string, approved: boolean, always?: 'tool' | 'session') => void;
  setAutoApprove: (sessionId: string, next: AssistantAutoApprove) => void;
  clearAutoApproveNotice: () => void;
  clearError: () => void;
}

// Socket lives outside the store: reconnects must not re-render on their own.
let ws: WebSocket | null = null;


let started = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Commands issued while the socket was down, replayed in order once it opens.
 *
 * Only the assistant panel opens the socket, and it is mounted only while it is
 * on screen. Ask Memory lives at the app root: on a page load where that panel
 * had never been visited, every exchange it recorded was dropped in silence —
 * and "Continue in Assistant" then opened a conversation the companion had never
 * been told about, which is an empty panel.
 *
 * Bounded: with the companion down the retry loop never drains this, and a queue
 * that grows all afternoon is a leak rather than a fix. The oldest goes first.
 */
const outbox: Array<Record<string, unknown>> = [];
const OUTBOX_MAX = 100;

/**
 * A question handed over from another surface, waiting for its history to land.
 *
 * Dispatched on `session_history` rather than straight away: that frame replaces
 * the conversation's items wholesale, so a turn appended before it arrives is
 * wiped off the screen while the model answers it anyway.
 */
let carried: { id: string; text: string } | null = null;

/**
 * @param queue false for a command that must not outlive the socket it was meant
 * for — an approval, which the server has already unwound as denied.
 */
function sendMsg(msg: Record<string, unknown>, queue = true): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
    return;
  }
  if (!queue) return;
  if (outbox.length >= OUTBOX_MAX) outbox.shift();
  outbox.push(msg);
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
            const tool = o.tool as {
              name: string;
              argv: string[];
              status: AssistantToolStatus;
              text?: string;
              autoApproved?: boolean;
            };
            return {
              kind: 'tool',
              name: tool.name,
              argv: tool.argv ?? [],
              status: tool.status,
              text: tool.text,
              autoApproved: tool.autoApproved === true,
            };
          }
          return { kind: o.role === 'user' ? 'user' : 'assistant', text: (o.text as string) ?? '' };
        });
        set((s) => ({ itemsBySession: { ...s.itemsBySession, [id]: items } }));
        // The history is on screen, so the question carried in can join it
        // without being replaced a moment later. Cleared first: a re-sent history
        // must not ask it twice.
        if (carried?.id === id) {
          const { text } = carried;
          carried = null;
          appendItem(id, { kind: 'user', text });
          sendMsg({ type: 'user', sessionId: id, text });
        }
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
          autoApproved: msg.autoApproved === true,
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
      case 'confirm_request': {
        const req: AssistantConfirmRequest = {
          sessionId: sessionId ?? '',
          id: msg.id as string,
          name: msg.name as string,
          argv: (msg.argv as string[]) ?? [],
        };
        set((s) => ({
          confirmReqs: s.confirmReqs.some((r) => r.id === req.id) ? s.confirmReqs : [...s.confirmReqs, req],
        }));
        break;
      }
      case 'auto_approve_disarmed':
        set({
          autoApproveNotice:
            "Auto-approbation désactivée : une page web a été jointe à la conversation.",
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
      // Queued commands go first and in order: a recorded exchange has to reach
      // the companion before the open_session that goes looking for it.
      const queued = outbox.splice(0);
      for (const msg of queued) socket.send(JSON.stringify(msg));
      // Re-open the conversation in view after a reconnect — unless the queue
      // just did, since a second history reply would wipe the turn the first one
      // let through.
      const activeId = get().activeId;
      const alreadyOpened = queued.some((m) => m.type === 'open_session' && m.id === activeId);
      if (activeId && !alreadyOpened) {
        socket.send(JSON.stringify({ type: 'open_session', id: activeId }));
      }
      fetch(`${ASSISTANT_BASE}/workspaces`)
        .then((r) => (r.ok ? r.json() : []))
        .then((list: AssistantWorkspace[]) => set({ workspaces: Array.isArray(list) ? list : [] }))
        .catch(() => {});
    };
    socket.onclose = () => {
      // A stale socket (replaced by a reconnect) must not clobber the live one.
      if (ws === socket) {
        ws = null;
        // The server unwinds pending confirmations as denied on disconnect.
        set({ connected: false, confirmReqs: [] });
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
    confirmReqs: [],
    errorMsg: null,
    workspaces: [],
    autoApproveNotice: null,

    ensureConnected: () => {
      if (started) return;
      started = true;
      connect();
    },

    newSession: (workspace) => {
      // The companion is a machine-wide singleton; without a workspace it pins
      // the configured *default*, not the one the user is viewing. Fall back to
      // the app's active workspace (surfaced by the server via /config) so a new
      // session reasons and runs tools against the current workspace.
      const active = workspace || useSettingsStore.getState().settings.workspace || undefined;
      sendMsg({ type: 'new_session', ...(active ? { workspace: active } : {}) });
    },

    recordExchange: (id, question, answer) => {
      // Nothing else here opens the socket: the panels that do are mounted only
      // while the assistant is on screen, and Ask Memory is reachable from
      // anywhere. Recording used to depend on having visited that panel first.
      get().ensureConnected();
      // Same workspace reasoning as newSession: the companion is machine-wide and
      // would otherwise pin the configured default rather than the one in view.
      const active = useSettingsStore.getState().settings.workspace || undefined;
      sendMsg({ type: 'record_exchange', id, question, answer, ...(active ? { workspace: active } : {}) });
    },

    openSession: (id, prompt) => {
      get().ensureConnected();
      set({ activeId: id, errorMsg: null });
      // Held until the history lands, and reset either way so a question handed
      // over and then abandoned is not asked of the next conversation opened.
      const text = prompt?.trim();
      carried = text ? { id, text } : null;
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

    answerConfirm: (id, approved, always) => {
      if (!get().confirmReqs.some((r) => r.id === id)) return;
      // The server derives WHICH session/tool `always` applies to from its own
      // pending-confirm entry, so we only send the scope.
      sendMsg({ type: 'confirm', id, approved, ...(always ? { always } : {}) }, false);
      set((s) => ({ confirmReqs: s.confirmReqs.filter((r) => r.id !== id) }));
    },

    setAutoApprove: (sessionId, next) => {
      sendMsg({ type: 'set_auto_approve', id: sessionId, all: next.all, tools: next.tools });
    },

    clearAutoApproveNotice: () => set({ autoApproveNotice: null }),

    clearError: () => set({ errorMsg: null }),
  };
});

// Test-only escape hatch: reset the module-level socket state.
export function __resetAssistantSocketForTests(): void {
  outbox.length = 0;
  carried = null;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  if (ws) {
    ws.onclose = null;
    ws.close();
  }
  ws = null;
  started = false;
}
