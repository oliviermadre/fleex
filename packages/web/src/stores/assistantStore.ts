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
  /** The conversation folder, once its first message created it. */
  workDir?: string;
  /** "Always allow writes outside the folder" is on for this conversation. */
  outsideWritesAllowed?: boolean;
  /** A conversation from before the SDK, not resumed yet. */
  legacy?: boolean;
}

export interface AssistantWorkspace {
  name: string;
  isDefault: boolean;
  branch?: string | null;
}

export type AssistantToolStatus = 'running' | 'ok' | 'fail' | 'denied' | 'stopped' | 'interrupted';
export type AssistantAccess = 'read' | 'write' | 'destructive';

export type AssistantArtifactPreview =
  | { type: 'csv'; rows: string[][] }
  | { type: 'markdown'; text: string }
  | { type: 'html'; html: string }
  | { type: 'text'; text: string }
  | { type: 'image'; dataUrl: string };

export interface AssistantArtifact {
  path: string;
  relPath: string;
  name: string;
  kind: 'script' | 'full';
  mime: string;
  sizeBytes: number;
  preview?: AssistantArtifactPreview;
  attachable: boolean;
  attachments: Array<{ ticketId: string; displayId: string; url?: string }>;
  modifiedSince?: boolean;
  turnId: string;
}

export type AssistantNotice = 'max_turns' | 'continued' | 'legacy_resumed' | 'context_reloaded';

export interface AssistantToolItem {
  kind: 'tool';
  id?: string;
  name: string;
  /** Pre-SDK lines: the fleex argv that ran. */
  argv?: string[];
  toolKind?: string;
  target?: string;
  access?: AssistantAccess;
  outsideWorkDir?: boolean;
  outsideAutoAllowed?: boolean;
  status: AssistantToolStatus;
  text?: string;
  exitCode?: number;
  truncated?: boolean;
  /** Pre-SDK lines: ran without a confirmation. */
  autoApproved?: boolean;
  /** Client clock when the call started (live lines only), for the chrono. */
  startedAt?: number;
}

export type AssistantChatItem =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | AssistantToolItem
  | { kind: 'artifact'; artifact: AssistantArtifact }
  | { kind: 'notice'; notice: AssistantNotice; limit?: number };

/** `fleex_ticket_create` → `ticket create`, for labels a human can read. */
export function toolLabel(name: string): string {
  return name.replace(/^fleex_/, '').replace(/_/g, ' ');
}

/** "outil · cible" of a tool line. */
export function toolLineLabel(item: AssistantToolItem): string {
  if (item.argv) return `fleex ${item.argv.join(' ')}`;
  return item.target ? `${item.name} · ${item.target}` : item.name;
}

/** A write outside the conversation folder, waiting for the user. */
export interface AssistantConfirmRequest {
  sessionId: string;
  id: string;
  tool: string;
  path: string;
  diff: string;
  isNewFile: boolean;
}

export type AssistantConfirmDecision = 'allow' | 'deny' | 'always';

export interface AssistantMcpServer {
  name: string;
  status: 'connected' | 'needs-auth' | 'failed' | 'pending';
  error?: string;
}

export interface AssistantTicketOption {
  id: string;
  displayId: string;
  title: string;
  status: string;
}

export interface AssistantTicketPicker {
  sessionId: string;
  tickets: AssistantTicketOption[];
  /** Last ticket cited in the conversation (display id or UUID). */
  preselect: string | null;
}

interface AssistantState {
  connected: boolean;
  sessions: AssistantSession[];
  activeId: string | null;
  itemsBySession: Record<string, AssistantChatItem[]>;
  /** Writes outside a conversation folder waiting for the user. */
  confirmReqs: AssistantConfirmRequest[];
  errorMsg: string | null;
  workspaces: AssistantWorkspace[];
  /** MCP servers as the last turn of each conversation saw them. */
  mcpBySession: Record<string, AssistantMcpServer[]>;
  /** Neither a Claude Code login nor an API key: where to set one up. */
  authMissing: boolean;
  /** Tickets for the "attach to a ticket" picker, once listed. */
  ticketPicker: AssistantTicketPicker | null;

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
  /** `always` also lets every later outside write of this conversation through. */
  answerConfirm: (id: string, decision: AssistantConfirmDecision) => void;
  /** The ⚡ chip: turn "always allow writes outside the folder" off (or on). */
  setOutsideWrites: (sessionId: string, allowed: boolean) => void;
  /** Interrupt the running turn (a pending confirmation counts as refused). */
  stop: (sessionId: string) => void;
  /** Go on after the turn budget ran out. */
  continueTurn: (sessionId: string) => void;
  openPath: (sessionId: string, path: string) => void;
  revealFolder: (sessionId: string) => void;
  listTickets: (sessionId: string, query?: string) => void;
  closeTicketPicker: () => void;
  attachArtifact: (sessionId: string, path: string, ticket: AssistantTicketOption) => void;
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

function isAccess(v: unknown): v is AssistantAccess {
  return v === 'read' || v === 'write' || v === 'destructive';
}

function isToolStatus(v: unknown): v is AssistantToolStatus {
  return v === 'running' || v === 'ok' || v === 'fail' || v === 'denied' || v === 'stopped' || v === 'interrupted';
}

/** One persisted transcript entry → a chat item. */
export function fromTranscript(t: unknown): AssistantChatItem {
  const o = t as Record<string, unknown>;
  if (o.tool) {
    const tool = o.tool as Omit<AssistantToolItem, 'kind'>;
    return {
      kind: 'tool',
      ...tool,
      status: isToolStatus(tool.status) ? tool.status : 'interrupted',
      autoApproved: tool.autoApproved === true,
    };
  }
  if (o.artifact) return { kind: 'artifact', artifact: o.artifact as AssistantArtifact };
  if (o.notice) return { kind: 'notice', notice: o.notice as AssistantNotice, ...(typeof o.limit === 'number' ? { limit: o.limit } : {}) };
  return { kind: o.role === 'user' ? 'user' : 'assistant', text: (o.text as string) ?? '' };
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

  function updateItems(sessionId: string, f: (it: AssistantChatItem) => AssistantChatItem): void {
    set((s) => ({
      itemsBySession: { ...s.itemsBySession, [sessionId]: (s.itemsBySession[sessionId] ?? []).map(f) },
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
        const items = transcript.map(fromTranscript);
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
          ...(Array.isArray(msg.argv) ? { argv: msg.argv as string[] } : {}),
          ...(typeof msg.toolKind === 'string' ? { toolKind: msg.toolKind } : {}),
          ...(typeof msg.target === 'string' ? { target: msg.target } : {}),
          ...(isAccess(msg.access) ? { access: msg.access } : {}),
          ...(msg.outsideWorkDir === true ? { outsideWorkDir: true } : {}),
          status: 'running',
          startedAt: Date.now(),
        });
        break;
      case 'tool_result':
      case 'tool_denied': {
        if (!sessionId) break;
        const status: AssistantToolStatus =
          msg.type === 'tool_denied'
            ? 'denied'
            : isToolStatus(msg.status)
              ? msg.status
              : (msg.ok as boolean)
                ? 'ok'
                : 'fail';
        updateItems(sessionId, (it) =>
          it.kind === 'tool' && it.id === msg.id
            ? {
                ...it,
                status,
                text: (msg.text as string | undefined) ?? it.text,
                ...(typeof msg.exitCode === 'number' ? { exitCode: msg.exitCode } : {}),
                ...(msg.truncated === true ? { truncated: true } : {}),
                ...(msg.outsideAutoAllowed === true ? { outsideAutoAllowed: true } : {}),
              }
            : it,
        );
        break;
      }
      case 'artifact': {
        if (!sessionId) break;
        const artifact = { ...(msg.card as Omit<AssistantArtifact, 'turnId'>), turnId: msg.turnId as string };
        const items = get().itemsBySession[sessionId] ?? [];
        const same = (it: AssistantChatItem) =>
          it.kind === 'artifact' && it.artifact.path === artifact.path && it.artifact.turnId === artifact.turnId;
        if (items.some(same)) updateItems(sessionId, (it) => (same(it) ? { kind: 'artifact', artifact } : it));
        else appendItem(sessionId, { kind: 'artifact', artifact });
        break;
      }
      case 'artifact_modified':
        if (!sessionId) break;
        updateItems(sessionId, (it) =>
          it.kind === 'artifact' && it.artifact.path === msg.path ? { kind: 'artifact', artifact: { ...it.artifact, modifiedSince: true } } : it,
        );
        break;
      case 'artifact_attach_failed':
        set({ errorMsg: `Attache impossible : ${String(msg.message ?? '')}` });
        break;
      case 'notice':
        if (sessionId) appendItem(sessionId, { kind: 'notice', notice: msg.notice as AssistantNotice });
        break;
      case 'max_turns':
        if (sessionId) appendItem(sessionId, { kind: 'notice', notice: 'max_turns', limit: msg.limit as number });
        break;
      case 'mcp_status':
        if (sessionId) set((s) => ({ mcpBySession: { ...s.mcpBySession, [sessionId]: (msg.servers as AssistantMcpServer[]) ?? [] } }));
        break;
      case 'auth_missing':
        set({ authMissing: true });
        break;
      case 'tickets':
        if (sessionId) {
          set({
            ticketPicker: {
              sessionId,
              tickets: (msg.tickets as AssistantTicketOption[]) ?? [],
              preselect: (msg.preselect as string | null) ?? null,
            },
          });
        }
        break;
      case 'confirm_request': {
        const req: AssistantConfirmRequest = {
          sessionId: sessionId ?? '',
          id: msg.id as string,
          tool: (msg.tool as string) ?? 'Write',
          path: (msg.path as string) ?? '',
          diff: (msg.diff as string) ?? '',
          isNewFile: msg.isNewFile === true,
        };
        set((s) => ({
          confirmReqs: s.confirmReqs.some((r) => r.id === req.id) ? s.confirmReqs : [...s.confirmReqs, req],
        }));
        break;
      }
      case 'done':
        // A confirmation never outlives its turn: Stop or the end refused it.
        if (sessionId) set((s) => ({ confirmReqs: s.confirmReqs.filter((r) => r.sessionId !== sessionId) }));
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
        // Pending confirmations survive on the companion and come back with
        // the conversation's history on reconnect.
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
    mcpBySession: {},
    authMissing: false,
    ticketPicker: null,

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

    answerConfirm: (id, decision) => {
      if (!get().confirmReqs.some((r) => r.id === id)) return;
      // The server applies "always" to the pending call's own conversation.
      sendMsg({ type: 'confirm', id, decision }, false);
      set((s) => ({ confirmReqs: s.confirmReqs.filter((r) => r.id !== id) }));
    },

    setOutsideWrites: (sessionId, allowed) => {
      sendMsg({ type: 'set_outside_writes', sessionId, allowed });
    },

    stop: (sessionId) => {
      sendMsg({ type: 'stop', sessionId }, false);
    },

    continueTurn: (sessionId) => {
      set({ errorMsg: null });
      sendMsg({ type: 'continue', sessionId });
    },

    openPath: (sessionId, path) => sendMsg({ type: 'open_path', sessionId, path }, false),

    revealFolder: (sessionId) => sendMsg({ type: 'reveal_folder', sessionId }, false),

    listTickets: (sessionId, query) => sendMsg({ type: 'list_tickets', sessionId, ...(query ? { query } : {}) }, false),

    closeTicketPicker: () => set({ ticketPicker: null }),

    attachArtifact: (sessionId, path, ticket) => {
      sendMsg({ type: 'attach_artifact', sessionId, path, ticketId: ticket.id, displayId: ticket.displayId }, false);
      set({ ticketPicker: null });
    },

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
