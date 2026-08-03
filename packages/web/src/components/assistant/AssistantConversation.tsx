import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { useStickToBottom } from '../../hooks/useStickToBottom';
import { ModelSelect } from '../agents/ModelSelect';
import { useAssistantStore, toolLabel, type AssistantChatItem } from '../../stores/assistantStore';
import { AssistantStatusDot } from './AssistantSidebar';
import { AssistantTranscript } from './AssistantTranscript';
import { AssistantComposer } from './AssistantComposer';
import { cn } from '../../lib/cn';
import { tint, tintText, tintClasses, tintSolid } from '../../lib/tints';

const EMPTY_ITEMS: AssistantChatItem[] = [];

/**
 * Orchestrator for the assistant panel: empty states, header, approval
 * banners — and nothing else.
 *
 * It deliberately does NOT hold the composer's draft (#518). Doing so used to
 * re-render the whole transcript on every keystroke. If you are tempted to lift
 * state back up here, run `AssistantComposer.render.test.tsx` first.
 */
export function AssistantConversation() {
  const connected = useAssistantStore((s) => s.connected);
  const sessions = useAssistantStore((s) => s.sessions);
  const activeId = useAssistantStore((s) => s.activeId);
  const items = useAssistantStore((s) => (s.activeId ? s.itemsBySession[s.activeId] ?? EMPTY_ITEMS : EMPTY_ITEMS));
  const confirmReqs = useAssistantStore((s) => s.confirmReqs);
  const errorMsg = useAssistantStore((s) => s.errorMsg);
  const autoApproveNotice = useAssistantStore((s) => s.autoApproveNotice);
  const ensureConnected = useAssistantStore((s) => s.ensureConnected);
  const newSession = useAssistantStore((s) => s.newSession);
  const openSession = useAssistantStore((s) => s.openSession);
  const answerConfirm = useAssistantStore((s) => s.answerConfirm);
  const setAutoApprove = useAssistantStore((s) => s.setAutoApprove);
  const clearAutoApproveNotice = useAssistantStore((s) => s.clearAutoApproveNotice);
  const setModel = useAssistantStore((s) => s.setModel);

  const [autoApproveOpen, setAutoApproveOpen] = useState(false);
  const { containerRef, maybeStick, scrollToBottom } = useStickToBottom<HTMLDivElement>();

  useEffect(() => {
    ensureConnected();
  }, [ensureConnected]);

  useLayoutEffect(() => {
    maybeStick();
  }, [items, maybeStick]);

  // Stable by construction (`scrollToBottom` is a `useCallback([])`), so the
  // composer never re-renders because of this prop.
  const handleSent = useCallback(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  const session = sessions.find((s) => s.id === activeId) ?? null;
  const busy = session ? session.status !== 'idle' : false;
  // Undefined when the companion predates the feature — nothing is approved.
  const autoApprove = session?.autoApprove;

  // ── Empty states ──
  if (!connected) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-[var(--theme-bg-primary)] px-8 text-center">
        <p className="text-3xl">🤖</p>
        <p className="text-sm font-medium text-[var(--theme-text-primary)]">Companion injoignable</p>
        <p className="max-w-md text-xs leading-relaxed text-[var(--theme-text-muted)]">
          L'assistant s'appuie sur le companion (<code>fleex companion start</code>, démarré automatiquement
          par <code>fleex start</code>). Reconnexion automatique…
        </p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-[var(--theme-bg-primary)] px-8 text-center">
        <p className="text-3xl">✦</p>
        <p className="text-sm text-[var(--theme-text-muted)]">
          L'assistant pilote tes boards, tickets, epics et deliverables via le CLI fleex.
        </p>
        <p className="max-w-md text-xs text-[var(--theme-text-faint)]">
          Exemple : «&nbsp;sur le ticket <code>@ticket:123</code>, déclenche le workflow{' '}
          <code>@workflow:spec-dev-qa</code>&nbsp;»
        </p>
        <button
          onClick={() => newSession()}
          className="rounded-md bg-[var(--theme-accent)] px-4 py-2 text-sm font-medium text-[var(--theme-accent-fg)] transition-colors hover:bg-[var(--theme-accent-hover)]"
        >
          Nouvelle conversation
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--theme-bg-primary)]">
      {/* Header: title + status + model picker */}
      <div
        className="flex shrink-0 items-center gap-3 border-b border-[var(--theme-border)] px-4"
        style={{ height: 'var(--header-height)' }}
      >
        <AssistantStatusDot status={session.status} size={9} />
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--theme-text-primary)]">
          {session.title}
        </h1>
        {session.workspace && (
          <span className="shrink-0 rounded-full bg-[var(--theme-bg-overlay)] px-2 py-0.5 text-[10px] text-[var(--theme-text-muted)]">
            {session.workspace}
          </span>
        )}
        {/* Standing approvals for this conversation — always visible while
            armed, so auto-run commands are never a surprise. */}
        {autoApprove && (autoApprove.all || autoApprove.tools.length > 0) && (
          <div className="relative shrink-0">
            <button
              onClick={() => setAutoApproveOpen((o) => !o)}
              className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', tint('yellow'))}
              title="Commandes auto-approuvées dans cette conversation"
            >
              ⚡ {autoApprove.all ? 'tout' : `${autoApprove.tools.length} auto`}
            </button>
            {autoApproveOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setAutoApproveOpen(false)} />
                <div className="absolute right-0 top-full z-30 mt-1 w-72 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-3 shadow-xl">
                  <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-[var(--theme-text-muted)]">
                    Auto-approuvé dans cette conversation
                  </p>
                  {autoApprove.all ? (
                    <p className="mb-2 text-xs text-[var(--theme-text-secondary)]">
                      Toutes les commandes de modification.
                    </p>
                  ) : (
                    <ul className="mb-2 flex flex-col gap-0.5">
                      {autoApprove.tools.map((t) => (
                        <li key={t} className="font-mono text-[11px] text-[var(--theme-text-secondary)]">
                          • {toolLabel(t)}
                        </li>
                      ))}
                    </ul>
                  )}
                  <label className="flex cursor-pointer items-center gap-2 border-t border-[var(--theme-border)] pt-2 text-xs text-[var(--theme-text-primary)]">
                    <input
                      type="checkbox"
                      checked={autoApprove.all}
                      onChange={(e) => setAutoApprove(session.id, { all: e.target.checked, tools: [] })}
                    />
                    Tout auto-approuver
                  </label>
                  <button
                    onClick={() => {
                      setAutoApprove(session.id, { all: false, tools: [] });
                      setAutoApproveOpen(false);
                    }}
                    className="mt-2 w-full rounded-md border border-[var(--theme-border)] px-3 py-1.5 text-xs font-medium text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]"
                  >
                    Tout réinitialiser
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        {/* Per-conversation model — same principle as the ticket composer */}
        <ModelSelect
          variant="inline"
          icon="🤖"
          value={session.model ?? ''}
          onChange={(v) => setModel(session.id, v || undefined)}
          leadingOption={{ value: '', label: 'Model: default' }}
          title="Modèle de cette conversation. Défaut = modèle du companion."
          ariaLabel="Conversation model"
          className="shrink-0"
        />
      </div>

      {/* Transcript */}
      <div ref={containerRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <AssistantTranscript
          items={items}
          busy={busy}
          statusLabel={session.status === 'awaiting_input' ? 'En attente de ta confirmation…' : 'Réflexion…'}
          errorMsg={errorMsg}
        />
      </div>

      {/* Mutating command approval — pinned OUTSIDE the scroll area so it can
          never sit unnoticed below the fold while the assistant waits. */}
      {confirmReqs
        .filter((r) => r.sessionId === session.id)
        .map((req) => (
          <div key={req.id} className="shrink-0 border-t border-[var(--theme-accent)]/40 bg-[var(--theme-bg-surface)] px-6 py-3">
            <div className="mx-auto max-w-3xl">
              <p className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-[var(--theme-text-muted)]">
                <span className={cn('inline-block h-2 w-2 animate-pulse rounded-full', tintSolid('yellow'))} />
                L'assistant attend ta confirmation
              </p>
              <pre className="mb-3 max-h-32 overflow-auto rounded-lg bg-[var(--theme-bg-overlay)] p-3 font-mono text-xs leading-relaxed text-[var(--theme-text-primary)]">
                fleex {req.argv.join(' ')}
              </pre>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => answerConfirm(req.id, false)}
                  className="rounded-md border border-[var(--theme-border)] px-4 py-1.5 text-xs font-medium text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]"
                >
                  Refuser
                </button>
                {/* Scoped to this command name: approving "ticket create" 50
                    times in a row is data entry, not a security decision. */}
                <button
                  onClick={() => answerConfirm(req.id, true, 'tool')}
                  title={`Toutes les commandes « ${toolLabel(req.name)} » de cette conversation`}
                  className={cn(
                    'rounded-md border px-4 py-1.5 text-xs font-medium',
                    tintClasses('yellow').borderColor,
                    tintText('yellow'),
                    'hover:bg-[var(--theme-bg-hover)]',
                  )}
                >
                  ⚡ Toujours autoriser «&nbsp;{toolLabel(req.name)}&nbsp;»
                </button>
                <button
                  onClick={() => answerConfirm(req.id, true)}
                  className="rounded-md bg-[var(--theme-accent)] px-4 py-1.5 text-xs font-semibold text-[var(--theme-accent-fg)] hover:bg-[var(--theme-accent-hover)]"
                >
                  Approuver
                </button>
              </div>
            </div>
          </div>
        ))}

      {/* Confirmations pending in OTHER conversations — surface them here too */}
      {confirmReqs
        .filter((r) => r.sessionId !== session.id)
        .map((req) => (
          <div key={req.id} className={cn('shrink-0 border-t px-6 py-2', tintClasses('yellow').borderColor, tintClasses('yellow').bg)}>
            <div className="mx-auto flex max-w-3xl items-center gap-2 text-xs text-[var(--theme-text-primary)]">
              <span className={cn('inline-block h-2 w-2 shrink-0 animate-pulse rounded-full', tintSolid('yellow'))} />
              <span className="min-w-0 flex-1 truncate">
                Une commande attend ta confirmation dans «{' '}
                {sessions.find((s) => s.id === req.sessionId)?.title ?? 'autre conversation'} »
              </span>
              <button
                onClick={() => openSession(req.sessionId)}
                className="shrink-0 rounded-md bg-[var(--theme-accent)] px-3 py-1 text-xs font-semibold text-[var(--theme-accent-fg)] hover:bg-[var(--theme-accent-hover)]"
              >
                Ouvrir
              </button>
            </div>
          </div>
        ))}

      {/* Auto-approval was disarmed server-side (untrusted page attached) */}
      {autoApproveNotice && (
        <div className={cn('shrink-0 border-t px-6 py-2', tintClasses('yellow').borderColor, tintClasses('yellow').bg)}>
          <div className="mx-auto flex max-w-3xl items-center gap-2 text-xs text-[var(--theme-text-primary)]">
            <span className="min-w-0 flex-1">{autoApproveNotice}</span>
            <button
              onClick={clearAutoApproveNotice}
              className="shrink-0 rounded px-2 py-0.5 text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)]"
              aria-label="Masquer"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      <AssistantComposer sessionId={session.id} busy={busy} onSent={handleSent} />
    </div>
  );
}
