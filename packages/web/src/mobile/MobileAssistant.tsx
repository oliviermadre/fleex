import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStickToBottom } from '../hooks/useStickToBottom';
import { MarkdownRenderer } from '../components/scratchpad/MarkdownRenderer';

/**
 * Mobile client for the Fleex assistant — the same companion host that backs
 * the Chrome side panel extension (packages/sidepanel-host). Same WS protocol,
 * same prompt engine: the host builds the system prompt, injects
 * `--workspace <name>` into every CLI invocation, and gates mutating commands
 * behind an explicit confirmation round-trip (rendered here as an approval
 * sheet showing the exact `fleex …` command).
 *
 * Reachability: `/assistant/*` is proxied to the companion (default
 * localhost:4399) — by Vite in dev, or by a `tailscale serve --set-path`
 * mount in prod (see docs/mobile.md).
 */

const ASSISTANT_BASE = '/assistant';

type SessionStatus = 'idle' | 'working' | 'awaiting_input';

interface SessionSummary {
  id: string;
  title: string;
  workspace?: string;
  model?: string;
  status: SessionStatus;
}

interface WorkspaceInfo {
  name: string;
  isDefault: boolean;
  branch?: string | null;
}

type ChatItem =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; id?: string; name: string; argv: string[]; status: 'running' | 'ok' | 'fail' | 'denied'; text?: string };

interface ConfirmRequest {
  sessionId: string;
  id: string;
  name: string;
  argv: string[];
}

type ToolStatus = 'running' | 'ok' | 'fail' | 'denied';

function toolStatusBadge(status: ToolStatus): { label: string; className: string } {
  switch (status) {
    case 'running':
      return { label: '⏳', className: 'text-amber-400' };
    case 'ok':
      return { label: '✓', className: 'text-green-400' };
    case 'fail':
      return { label: '✗', className: 'text-red-400' };
    case 'denied':
      return { label: '⊘ refusé', className: 'text-zinc-400' };
  }
}

export function MobileAssistant() {
  const [connected, setConnected] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [confirmReq, setConfirmReq] = useState<ConfirmRequest | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showSessions, setShowSessions] = useState(false);
  const [draft, setDraft] = useState('');

  const wsRef = useRef<WebSocket | null>(null);
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;
  const { containerRef, maybeStick, scrollToBottom } = useStickToBottom<HTMLDivElement>();

  const sendMsg = useCallback((msg: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  // ── WebSocket lifecycle with reconnect ──
  useEffect(() => {
    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (disposed) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${window.location.host}${ASSISTANT_BASE}/chat`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (wsRef.current !== ws) return;
        setConnected(true);
        setErrorMsg(null);
        // Reload the open conversation after a reconnect
        if (activeIdRef.current) ws.send(JSON.stringify({ type: 'open_session', id: activeIdRef.current }));
      };
      ws.onclose = () => {
        // A stale socket (replaced by a StrictMode remount or a reconnect)
        // must not clobber the ref of the live one — its close arrives async.
        if (wsRef.current === ws) {
          wsRef.current = null;
          setConnected(false);
          if (!disposed) retryTimer = setTimeout(connect, 3000);
        }
      };
      ws.onmessage = (event) => {
        if (wsRef.current !== ws) return;
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(event.data as string);
        } catch {
          return;
        }
        handleServerMessage(msg);
      };
    };

    const handleServerMessage = (msg: Record<string, unknown>) => {
      const forActive = msg.sessionId === activeIdRef.current;
      switch (msg.type) {
        case 'sessions':
          setSessions((msg.sessions as SessionSummary[]) ?? []);
          break;
        case 'session_created':
          setActiveId(msg.id as string);
          setItems([]);
          sendMsg({ type: 'open_session', id: msg.id });
          break;
        case 'session_history': {
          if (msg.id !== activeIdRef.current) break;
          const transcript = (msg.transcript as unknown[]) ?? [];
          setItems(
            transcript.map((t): ChatItem => {
              const o = t as Record<string, unknown>;
              if (o.tool) {
                const tool = o.tool as { name: string; argv: string[]; status: ToolStatus; text?: string };
                return { kind: 'tool', name: tool.name, argv: tool.argv ?? [], status: tool.status, text: tool.text };
              }
              return { kind: o.role === 'user' ? 'user' : 'assistant', text: (o.text as string) ?? '' };
            }),
          );
          break;
        }
        case 'text': {
          if (!forActive) break;
          const delta = msg.text as string;
          setItems((prev) => {
            const last = prev[prev.length - 1];
            if (last?.kind === 'assistant') {
              return [...prev.slice(0, -1), { kind: 'assistant', text: last.text + delta }];
            }
            return [...prev, { kind: 'assistant', text: delta }];
          });
          break;
        }
        case 'tool_call': {
          if (!forActive) break;
          setItems((prev) => [
            ...prev,
            { kind: 'tool', id: msg.id as string, name: msg.name as string, argv: (msg.argv as string[]) ?? [], status: 'running' },
          ]);
          break;
        }
        case 'tool_result':
        case 'tool_denied': {
          if (!forActive) break;
          const status: ToolStatus = msg.type === 'tool_denied' ? 'denied' : (msg.ok as boolean) ? 'ok' : 'fail';
          setItems((prev) =>
            prev.map((it) =>
              it.kind === 'tool' && it.id === msg.id
                ? { ...it, status, text: (msg.text as string | undefined) ?? it.text }
                : it,
            ),
          );
          break;
        }
        case 'confirm_request':
          setConfirmReq({
            sessionId: msg.sessionId as string,
            id: msg.id as string,
            name: msg.name as string,
            argv: (msg.argv as string[]) ?? [],
          });
          break;
        case 'error':
          if (forActive || !msg.sessionId) setErrorMsg(msg.message as string);
          break;
        default:
          break;
      }
    };

    connect();
    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendMsg]);

  // Workspaces for the new-session picker (companion enriches with branch)
  useEffect(() => {
    fetch(`${ASSISTANT_BASE}/workspaces`)
      .then((r) => (r.ok ? r.json() : []))
      .then((ws: WorkspaceInfo[]) => setWorkspaces(Array.isArray(ws) ? ws : []))
      .catch(() => {});
  }, [connected]);

  useLayoutEffect(() => {
    maybeStick();
  }, [items, maybeStick]);

  const activeSession = sessions.find((s) => s.id === activeId) ?? null;
  const busy = activeSession ? activeSession.status !== 'idle' : false;

  const openSession = useCallback(
    (id: string) => {
      setActiveId(id);
      setItems([]);
      setShowSessions(false);
      sendMsg({ type: 'open_session', id });
    },
    [sendMsg],
  );

  const newSession = useCallback(
    (workspace?: string) => {
      sendMsg({ type: 'new_session', ...(workspace ? { workspace } : {}) });
      setShowSessions(false);
    },
    [sendMsg],
  );

  const handleSend = useCallback(() => {
    const text = draft.trim();
    if (!text || !activeId || busy) return;
    setItems((prev) => [...prev, { kind: 'user', text }]);
    sendMsg({ type: 'user', sessionId: activeId, text });
    setDraft('');
    setErrorMsg(null);
    scrollToBottom();
  }, [draft, activeId, busy, sendMsg, scrollToBottom]);

  const answerConfirm = useCallback(
    (approved: boolean) => {
      if (!confirmReq) return;
      sendMsg({ type: 'confirm', id: confirmReq.id, approved });
      setConfirmReq(null);
    },
    [confirmReq, sendMsg],
  );

  // ── Disconnected: setup hint ──
  if (!connected) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
        <p className="text-2xl">🤖</p>
        <p className="text-sm font-medium text-[var(--theme-text-primary)]">Assistant injoignable</p>
        <p className="text-xs leading-relaxed text-[var(--theme-text-muted)]">
          Le companion ne répond pas. Sur le laptop, lance{' '}
          <code className="rounded bg-[var(--theme-bg-secondary)] px-1.5 py-0.5">fleex companion start</code>{' '}
          (démarré automatiquement par <code className="rounded bg-[var(--theme-bg-secondary)] px-1.5 py-0.5">fleex start</code>),
          puis vérifie le proxy <code className="rounded bg-[var(--theme-bg-secondary)] px-1.5 py-0.5">/assistant</code> — voir docs/mobile.md.
        </p>
        <p className="text-[10px] text-[var(--theme-text-faint)]">Reconnexion automatique…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header: session switcher */}
      <header className="flex shrink-0 items-center gap-2 border-b border-[var(--theme-border)] px-3 py-2">
        <button
          onClick={() => setShowSessions(true)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md bg-[var(--theme-bg-secondary)] px-3 py-2 text-left"
        >
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--theme-text-primary)]">
            {activeSession ? activeSession.title : 'Conversations'}
          </span>
          {activeSession?.workspace && (
            <span className="shrink-0 rounded-full bg-[var(--theme-bg-hover)] px-2 py-0.5 text-[10px] text-[var(--theme-text-muted)]">
              {activeSession.workspace}
            </span>
          )}
          <span className="shrink-0 text-xs text-[var(--theme-text-faint)]">▾</span>
        </button>
        <button
          onClick={() => newSession()}
          className="shrink-0 rounded-md bg-[var(--theme-accent)] px-3 py-2 text-sm font-semibold text-white"
          aria-label="Nouvelle conversation"
        >
          +
        </button>
      </header>

      {/* Transcript */}
      <div ref={containerRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {!activeId ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm text-[var(--theme-text-muted)]">
              L'assistant pilote tes boards, tickets, epics et deliverables via le CLI fleex.
            </p>
            <button
              onClick={() => newSession()}
              className="rounded-lg bg-[var(--theme-accent)] px-4 py-2 text-sm font-medium text-white"
            >
              Nouvelle conversation
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {items.map((item, i) => {
              if (item.kind === 'user') {
                return (
                  <div key={i} className="ml-8 rounded-xl bg-[var(--theme-accent)]/10 p-3 text-sm text-[var(--theme-text-primary)]">
                    <div className="overflow-x-auto whitespace-pre-wrap break-words">{item.text}</div>
                  </div>
                );
              }
              if (item.kind === 'assistant') {
                return (
                  <div key={i} className="overflow-x-auto text-[13px]">
                    <MarkdownRenderer content={item.text} onToggleCheckbox={() => {}} />
                  </div>
                );
              }
              const badge = toolStatusBadge(item.status);
              return (
                <div
                  key={i}
                  className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-secondary)] px-3 py-2 font-mono text-[11px]"
                >
                  <span className={`mr-2 ${badge.className}`}>{badge.label}</span>
                  <span className="break-all text-[var(--theme-text-secondary)]">
                    fleex {item.argv.join(' ')}
                  </span>
                </div>
              );
            })}
            {busy && (
              <p className="animate-pulse px-1 text-xs text-[var(--theme-text-faint)]">
                {activeSession?.status === 'awaiting_input' ? 'En attente de ta confirmation…' : 'Réflexion…'}
              </p>
            )}
          </div>
        )}
        {errorMsg && (
          <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-400">
            {errorMsg}
          </p>
        )}
      </div>

      {/* Composer */}
      {activeId && (
        <div
          className="flex shrink-0 items-end gap-2 border-t border-[var(--theme-border)] px-3 pb-2 pt-2"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 8px)' }}
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={busy ? 'Assistant au travail…' : 'Demande quelque chose…'}
            rows={2}
            className="min-h-0 flex-1 resize-none rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg-secondary)] p-3 text-base leading-snug text-[var(--theme-text-primary)] outline-none focus:border-[var(--theme-accent)]"
          />
          <button
            onClick={handleSend}
            disabled={!draft.trim() || busy}
            className="shrink-0 rounded-xl bg-[var(--theme-accent)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            ➤
          </button>
        </div>
      )}

      {/* Confirmation of a mutating fleex command */}
      {confirmReq && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/60">
          <div
            className="w-full rounded-t-2xl border-t border-[var(--theme-border)] bg-[var(--theme-bg-base)] p-4"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}
          >
            <p className="mb-1 text-xs font-medium uppercase tracking-wider text-[var(--theme-text-muted)]">
              L'assistant veut exécuter
            </p>
            <pre className="mb-3 overflow-x-auto rounded-lg bg-[var(--theme-bg-secondary)] p-3 font-mono text-[11px] leading-relaxed text-[var(--theme-text-primary)]">
              fleex {confirmReq.argv.join(' ')}
            </pre>
            <div className="flex gap-2">
              <button
                onClick={() => answerConfirm(false)}
                className="flex-1 rounded-lg bg-[var(--theme-bg-hover)] px-4 py-3 text-sm font-medium text-[var(--theme-text-primary)]"
              >
                Refuser
              </button>
              <button
                onClick={() => answerConfirm(true)}
                className="flex-1 rounded-lg bg-[var(--theme-accent)] px-4 py-3 text-sm font-semibold text-white"
              >
                Approuver
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Session picker sheet */}
      {showSessions && (
        <div className="fixed inset-0 z-40 flex items-end bg-black/50" onClick={() => setShowSessions(false)}>
          <div
            className="max-h-[75dvh] w-full overflow-y-auto rounded-t-2xl border-t border-[var(--theme-border)] bg-[var(--theme-bg-base)] p-4"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--theme-text-muted)]">
              Nouvelle conversation
            </p>
            <div className="mb-4 flex flex-wrap gap-1.5">
              {workspaces.length === 0 ? (
                <button
                  onClick={() => newSession()}
                  className="rounded-full bg-[var(--theme-accent)] px-3 py-1.5 text-xs font-medium text-white"
                >
                  + Workspace par défaut
                </button>
              ) : (
                workspaces.map((w) => (
                  <button
                    key={w.name}
                    onClick={() => newSession(w.name)}
                    className="rounded-full border border-[var(--theme-border)] bg-[var(--theme-bg-secondary)] px-3 py-1.5 text-xs font-medium text-[var(--theme-text-primary)]"
                  >
                    + {w.name}
                    {w.isDefault ? ' ★' : ''}
                    {w.branch ? <span className="text-[var(--theme-text-faint)]"> ⎇{w.branch}</span> : null}
                  </button>
                ))
              )}
            </div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--theme-text-muted)]">
              Conversations
            </p>
            {sessions.length === 0 ? (
              <p className="py-4 text-center text-sm text-[var(--theme-text-faint)]">Aucune conversation</p>
            ) : (
              sessions.map((s) => (
                <div key={s.id} className="flex items-center gap-1">
                  <button
                    onClick={() => openSession(s.id)}
                    className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-3 text-left active:bg-[var(--theme-bg-hover)] ${
                      s.id === activeId ? 'bg-[var(--theme-bg-secondary)]' : ''
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-[var(--theme-text-primary)]">{s.title}</span>
                    {s.workspace && (
                      <span className="shrink-0 rounded-full bg-[var(--theme-bg-hover)] px-2 py-0.5 text-[10px] text-[var(--theme-text-muted)]">
                        {s.workspace}
                      </span>
                    )}
                    {s.status !== 'idle' && <span className="shrink-0 text-[10px] text-amber-400">●</span>}
                  </button>
                  <button
                    onClick={() => {
                      sendMsg({ type: 'delete_session', id: s.id });
                      if (s.id === activeId) {
                        setActiveId(null);
                        setItems([]);
                      }
                    }}
                    className="shrink-0 rounded-lg px-2 py-3 text-xs text-[var(--theme-text-faint)] active:text-[var(--theme-danger)]"
                    aria-label={`Supprimer ${s.title}`}
                  >
                    ✕
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
