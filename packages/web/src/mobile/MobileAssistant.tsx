import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { useStickToBottom } from '../hooks/useStickToBottom';
import { MarkdownRenderer } from '../components/scratchpad/MarkdownRenderer';
import {
  useAssistantStore,
  type AssistantChatItem,
  type AssistantToolStatus,
} from '../stores/assistantStore';

/**
 * Mobile client for the Fleex assistant — same companion host as the Chrome
 * side panel and the desktop Assistant panel; the WS protocol lives in
 * assistantStore. Mutating fleex commands are approved from a bottom sheet
 * showing the exact command.
 */

const EMPTY_ITEMS: AssistantChatItem[] = [];

function toolStatusBadge(status: AssistantToolStatus): { label: string; className: string } {
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
  const connected = useAssistantStore((s) => s.connected);
  const sessions = useAssistantStore((s) => s.sessions);
  const workspaces = useAssistantStore((s) => s.workspaces);
  const activeId = useAssistantStore((s) => s.activeId);
  const items = useAssistantStore((s) => (s.activeId ? s.itemsBySession[s.activeId] ?? EMPTY_ITEMS : EMPTY_ITEMS));
  const confirmReq = useAssistantStore((s) => s.confirmReq);
  const errorMsg = useAssistantStore((s) => s.errorMsg);
  const ensureConnected = useAssistantStore((s) => s.ensureConnected);
  const newSession = useAssistantStore((s) => s.newSession);
  const openSessionInStore = useAssistantStore((s) => s.openSession);
  const deleteSession = useAssistantStore((s) => s.deleteSession);
  const sendUser = useAssistantStore((s) => s.sendUser);
  const answerConfirm = useAssistantStore((s) => s.answerConfirm);

  const [showSessions, setShowSessions] = useState(false);
  const [draft, setDraft] = useState('');
  const { containerRef, maybeStick, scrollToBottom } = useStickToBottom<HTMLDivElement>();

  useEffect(() => {
    ensureConnected();
  }, [ensureConnected]);

  useLayoutEffect(() => {
    maybeStick();
  }, [items, maybeStick]);

  const activeSession = sessions.find((s) => s.id === activeId) ?? null;
  const busy = activeSession ? activeSession.status !== 'idle' : false;

  const openSession = useCallback(
    (id: string) => {
      openSessionInStore(id);
      setShowSessions(false);
    },
    [openSessionInStore],
  );

  const createSession = useCallback(
    (workspace?: string) => {
      newSession(workspace);
      setShowSessions(false);
    },
    [newSession],
  );

  const handleSend = useCallback(() => {
    const text = draft.trim();
    if (!text || !activeId || busy) return;
    sendUser(text);
    setDraft('');
    scrollToBottom();
  }, [draft, activeId, busy, sendUser, scrollToBottom]);

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
          onClick={() => createSession()}
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
              onClick={() => createSession()}
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
                  onClick={() => createSession()}
                  className="rounded-full bg-[var(--theme-accent)] px-3 py-1.5 text-xs font-medium text-white"
                >
                  + Workspace par défaut
                </button>
              ) : (
                workspaces.map((w) => (
                  <button
                    key={w.name}
                    onClick={() => createSession(w.name)}
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
                    {s.status !== 'idle' && <span className="shrink-0 animate-pulse text-[10px] text-amber-400">●</span>}
                  </button>
                  <button
                    onClick={() => deleteSession(s.id)}
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
