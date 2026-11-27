import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NOOP } from './noop';
import { useStickToBottom } from '../hooks/useStickToBottom';
import { MarkdownRenderer } from '../components/scratchpad/MarkdownRenderer';
import { useAssistantStore, type AssistantChatItem } from '../stores/assistantStore';
import { tint, tintText } from '../lib/tints';
import { AssistantMessage, AssistantOutsideWriteCard, useFoldedItems } from '../components/assistant/AssistantTranscript';
import { MarkdownEditor } from '../components/markdown/MarkdownEditor';
import { useFileUpload } from '../hooks/useFileUpload';
import { MobilePageHeader } from './MobilePageHeader';
import { AssistantSuggestions, ASSISTANT_INTRO } from '../components/assistant/AssistantSuggestions';
import { AssistantIcon } from './MobileIcons';

/**
 * Mobile client for the Fleex assistant — same companion host as the Chrome
 * side panel and the desktop Assistant panel; the WS protocol lives in
 * assistantStore. Tool lines and artefact cards are the desktop ones; a file
 * write outside the conversation folder is approved from a bottom sheet.
 * Files live on the companion's machine: cards show a preview, never "Ouvrir".
 */

const EMPTY_ITEMS: AssistantChatItem[] = [];

/** The ticket open behind the sheet, passed to the companion as context. */
export type AssistantTicketContext = { id: string; displayId: number | string; title: string } | null;

export function MobileAssistant({ ticket = null }: { ticket?: AssistantTicketContext }) {
  const connected = useAssistantStore((s) => s.connected);
  const sessions = useAssistantStore((s) => s.sessions);
  const workspaces = useAssistantStore((s) => s.workspaces);
  const activeId = useAssistantStore((s) => s.activeId);
  const items = useAssistantStore((s) => (s.activeId ? s.itemsBySession[s.activeId] ?? EMPTY_ITEMS : EMPTY_ITEMS));
  const confirmReq = useAssistantStore((s) => s.confirmReqs[0] ?? null);
  const errorMsg = useAssistantStore((s) => s.errorMsg);
  const ensureConnected = useAssistantStore((s) => s.ensureConnected);
  const newSession = useAssistantStore((s) => s.newSession);
  const openSessionInStore = useAssistantStore((s) => s.openSession);
  const deleteSession = useAssistantStore((s) => s.deleteSession);
  const sendUser = useAssistantStore((s) => s.sendUser);
  const setOutsideWrites = useAssistantStore((s) => s.setOutsideWrites);
  const stop = useAssistantStore((s) => s.stop);
  const authMissing = useAssistantStore((s) => s.authMissing);

  const [showSessions, setShowSessions] = useState(false);
  const [draft, setDraft] = useState('');
  const draftRef = useRef<HTMLTextAreaElement>(null);
  // Same upload engine as the desktop assistant composer: paste or pick an image/file
  const fileUpload = useFileUpload({ textareaRef: draftRef, value: draft, onChange: setDraft });
  const { containerRef, maybeStick, scrollToBottom } = useStickToBottom<HTMLDivElement>();
  const folded = useFoldedItems(items);

  useEffect(() => {
    ensureConnected();
  }, [ensureConnected]);

  useLayoutEffect(() => {
    maybeStick();
  }, [items, maybeStick]);

  // Opening or switching conversation lands at its bottom, following.
  useLayoutEffect(() => {
    scrollToBottom();
  }, [activeId, scrollToBottom]);

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
    // The companion has no notion of the open screen: prefix the message.
    sendUser(ticket ? `[Contexte : ticket #${ticket.displayId} « ${ticket.title} » (id ${ticket.id})]\n${text}` : text);
    setDraft('');
    scrollToBottom();
  }, [draft, activeId, busy, sendUser, scrollToBottom, ticket]);

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
          puis vérifie le proxy <code className="rounded bg-[var(--theme-bg-secondary)] px-1.5 py-0.5">/companion</code> — voir docs/mobile.md.
        </p>
        <p className="text-[10px] text-[var(--theme-text-faint)]">Reconnexion automatique…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header: same layout as every screen; the session switcher sits on the second line */}
      <MobilePageHeader
        title="Assistant"
        icon={<AssistantIcon size={24} />}
        trailing={
          <>
            {/* Writes outside the folder allowed — visible while on, tap to remove */}
            {activeSession?.outsideWritesAllowed && (
              <button
                onClick={() => setOutsideWrites(activeSession.id, false)}
                className={`flex h-11 shrink-0 items-center rounded-full px-3 text-xs font-medium ${tint('yellow')}`}
                title="Écriture hors dossier autorisée — appuyer pour redemander"
              >
                ⚡ hors dossier
              </button>
            )}
            <button
              onClick={() => createSession()}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--theme-accent)] text-2xl font-semibold leading-none text-[var(--theme-accent-fg)]"
              aria-label="Nouvelle conversation"
            >
              +
            </button>
          </>
        }
        sub={
          <button
            onClick={() => setShowSessions(true)}
            className="flex h-11 min-w-0 items-center gap-2 rounded-[10px] bg-[var(--theme-bg-surface)] px-3 text-left"
          >
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--theme-text-primary)]">
              {activeSession ? activeSession.title : 'Conversations'}
            </span>
            {activeSession?.workspace && (
              <span className="shrink-0 rounded-full bg-[var(--theme-bg-hover)] px-2 py-0.5 text-[11px] text-[var(--theme-text-muted)]">
                {activeSession.workspace}
              </span>
            )}
            <span className="shrink-0 text-xs text-[var(--theme-text-faint)]">▾</span>
          </button>
        }
      />

      {ticket && (
        <div className="flex shrink-0 px-3 pt-2">
          <span className="max-w-full truncate rounded-full bg-[var(--theme-accent-muted)] px-2.5 py-1 text-[11.5px] text-[var(--theme-accent)]">
            Contexte : #{ticket.displayId} · {ticket.title}
          </span>
        </div>
      )}

      {/* Transcript */}
      <div ref={containerRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {!activeId ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm text-[var(--theme-text-muted)]">{ASSISTANT_INTRO}</p>
            <button
              onClick={() => createSession()}
              className="rounded-lg bg-[var(--theme-accent)] px-4 py-2 text-sm font-medium text-[var(--theme-accent-fg)]"
            >
              Nouvelle conversation
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {items.length === 0 && !busy && (
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <p className="text-sm text-[var(--theme-text-muted)]">{ASSISTANT_INTRO}</p>
                <AssistantSuggestions onPick={sendUser} className="flex w-full flex-col gap-1.5 text-xs" />
              </div>
            )}
            {folded.map((item, i) =>
              item.kind === 'more' ? (
                <p key={`more-${item.turnId}`} className="text-xs text-[var(--theme-text-faint)]">
                  + {item.hidden.length} autres fichiers
                </p>
              ) : item.kind === 'user' ? (
                <div key={i} className="ml-8 rounded-xl bg-[var(--theme-accent)]/10 p-3 text-sm text-[var(--theme-text-primary)]">
                  <div className="overflow-x-auto whitespace-pre-wrap break-words">{item.text}</div>
                </div>
              ) : item.kind === 'assistant' ? (
                <div key={i} className="overflow-x-auto text-[13px]">
                  <MarkdownRenderer content={item.text} onToggleCheckbox={NOOP} />
                </div>
              ) : (
                <AssistantMessage key={i} item={item} sessionId={activeId ?? ''} canOpen={false} />
              ),
            )}
            {busy && (
              <p className="animate-pulse px-1 text-xs text-[var(--theme-text-faint)]">
                {activeSession?.status === 'awaiting_input' ? 'En attente de ta confirmation…' : 'Réflexion…'}
              </p>
            )}
          </div>
        )}
        {(authMissing || errorMsg) && (
          <p className={`mt-3 rounded-lg border p-2 text-xs ${tint('red')}`}>
            {authMissing
              ? 'Aucune authentification Claude : connecte Claude Code sur la machine du companion, ou ajoute ANTHROPIC_API_KEY dans ~/.fleex/config.'
              : errorMsg}
          </p>
        )}
      </div>

      {/* Composer */}
      {activeId && (
        <div
          className="flex shrink-0 items-end gap-2 border-t border-[var(--theme-border)] px-3 pb-2 pt-2"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 8px)' }}
        >
          <MarkdownEditor
            variant="composer"
            surfaceKind="assistant_message"
            className="min-w-0 flex-1"
            value={draft}
            onChange={setDraft}
            minRows={2}
            textareaRef={draftRef}
            placeholder={busy ? 'Assistant au travail…' : 'Demande quelque chose…'}
            textareaProps={{
              onPaste: fileUpload.pasteHandler,
              className: 'rounded-xl bg-[var(--theme-bg-secondary)] p-3 text-base text-[var(--theme-text-primary)]',
            }}
          />
          <button
            type="button"
            onClick={fileUpload.openFilePicker}
            disabled={fileUpload.isUploading}
            aria-label="Joindre une image ou un fichier"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[var(--theme-text-muted)] disabled:opacity-50"
          >
            {fileUpload.isUploading ? '…' : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
              </svg>
            )}
          </button>
          {busy && activeId ? (
            <button
              onClick={() => stop(activeId)}
              aria-label="Arrêter"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--theme-border)] text-base font-semibold text-[var(--theme-text-primary)]"
            >
              ■
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!draft.trim() || fileUpload.isUploading}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--theme-accent)] text-base font-semibold text-[var(--theme-accent-fg)] disabled:opacity-50"
            >
              ➤
            </button>
          )}
        </div>
      )}

      {/* Confirmation of a file write outside the conversation folder */}
      {confirmReq && (
        <div className="fixed inset-0 z-[60] flex items-end bg-black/60">
          <div
            className="w-full rounded-t-2xl border-t border-[var(--theme-border)] bg-[var(--theme-bg-base)] p-4"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}
          >
            <AssistantOutsideWriteCard req={confirmReq} compact />
          </div>
        </div>
      )}

      {/* Session picker sheet */}
      {showSessions && (
        <div className="fixed inset-0 z-[55] flex items-end bg-black/50" onClick={() => setShowSessions(false)}>
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
                  className="rounded-full bg-[var(--theme-accent)] px-3 py-1.5 text-xs font-medium text-[var(--theme-accent-fg)]"
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
                    {s.status !== 'idle' && <span className={`shrink-0 animate-pulse text-[10px] ${tintText('yellow')}`}>●</span>}
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
