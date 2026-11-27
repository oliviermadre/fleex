import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { useStickToBottom } from '../../hooks/useStickToBottom';
import { ModelSelect } from '../agents/ModelSelect';
import { useAssistantStore, type AssistantChatItem, type AssistantMcpServer } from '../../stores/assistantStore';
import { AssistantStatusDot } from './AssistantSidebar';
import { AssistantTranscript, AssistantOutsideWriteCard } from './AssistantTranscript';
import { AssistantComposer } from './AssistantComposer';
import { AssistantSuggestions, ASSISTANT_INTRO } from './AssistantSuggestions';
import { cn } from '../../lib/cn';
import { tint, tintText, tintClasses, tintSolid } from '../../lib/tints';

const NO_MCP: AssistantMcpServer[] = [];

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
  const authMissing = useAssistantStore((s) => s.authMissing);
  const mcp = useAssistantStore((s) => (s.activeId ? s.mcpBySession[s.activeId] ?? NO_MCP : NO_MCP));
  const ensureConnected = useAssistantStore((s) => s.ensureConnected);
  const newSession = useAssistantStore((s) => s.newSession);
  const openSession = useAssistantStore((s) => s.openSession);
  const setOutsideWrites = useAssistantStore((s) => s.setOutsideWrites);
  const revealFolder = useAssistantStore((s) => s.revealFolder);
  const setModel = useAssistantStore((s) => s.setModel);
  const sendUser = useAssistantStore((s) => s.sendUser);

  const [mcpOpen, setMcpOpen] = useState(false);
  const { containerRef, maybeStick, scrollToBottom } = useStickToBottom<HTMLDivElement>();

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

  // Stable by construction (`scrollToBottom` only depends on the memoized `containerRef`), so the
  // composer never re-renders because of this prop.
  const handleSent = useCallback(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  const session = sessions.find((s) => s.id === activeId) ?? null;
  const busy = session ? session.status !== 'idle' : false;
  const mcpToAuth = mcp.filter((m) => m.status === 'needs-auth');
  const mcpFailed = mcp.filter((m) => m.status === 'failed');

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
        <p className="max-w-md text-sm text-[var(--theme-text-muted)]">{ASSISTANT_INTRO}</p>
        <AssistantSuggestions />
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
        {/* MCP servers that need attention — the conversation still works. */}
        {(mcpToAuth.length > 0 || mcpFailed.length > 0) && (
          <div className="relative shrink-0">
            <button
              onClick={() => setMcpOpen((o) => !o)}
              className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', tint(mcpFailed.length ? 'red' : 'yellow'))}
            >
              {mcpToAuth.length > 0 ? `${mcpToAuth.length} MCP à authentifier` : `${mcpFailed.length} MCP en échec`}
            </button>
            {mcpOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setMcpOpen(false)} />
                <div className="absolute right-0 top-full z-30 mt-1 w-72 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-3 text-xs shadow-lg">
                  {mcpToAuth.map((m) => (
                    <p key={m.name} className="font-mono">
                      {m.name} <span className={tintText('yellow')}>à authentifier</span>
                    </p>
                  ))}
                  {mcpFailed.map((m) => (
                    <p key={m.name} className="font-mono text-[var(--theme-text-faint)]">
                      {m.name} <span className={tintText('red')}>{m.error ?? 'échec de connexion'}</span>
                    </p>
                  ))}
                  {mcpToAuth.length > 0 && (
                    <p className="mt-2 text-[var(--theme-text-muted)]">
                      Autorise-les avec <code>claude mcp</code> (ou /mcp dans Claude Code). Les autres outils restent utilisables.
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        )}
        {/* "Always allow writes outside the folder" — visible while on, removable. */}
        {session.outsideWritesAllowed && (
          <button
            onClick={() => setOutsideWrites(session.id, false)}
            title="Retirer : les écritures hors du dossier redemanderont confirmation"
            className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium', tintClasses('yellow').borderColor, tintText('yellow'))}
          >
            ⚡ écriture hors dossier ✕
          </button>
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

      {session.workDir && <WorkDirBar path={session.workDir} onReveal={() => revealFolder(session.id)} />}

      {/* Transcript */}
      <div ref={containerRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {/* `vide`: a fresh conversation shows what the assistant can now do. */}
        {items.length === 0 && !busy && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="max-w-md text-sm text-[var(--theme-text-muted)]">{ASSISTANT_INTRO}</p>
            <AssistantSuggestions onPick={sendUser} />
          </div>
        )}
        <AssistantTranscript
          sessionId={session.id}
          items={items}
          busy={busy}
          statusLabel={session.status === 'awaiting_input' ? 'En attente de ta confirmation…' : 'Réflexion…'}
          errorMsg={
            authMissing
              ? "Aucune authentification Claude : connecte Claude Code (`claude` puis /login) ou ajoute ANTHROPIC_API_KEY dans ~/.fleex/config."
              : errorMsg
          }
        />
      </div>

      {/* Write outside the folder — pinned OUTSIDE the scroll area so it can
          never sit unnoticed below the fold while the assistant waits. */}
      {confirmReqs
        .filter((r) => r.sessionId === session.id)
        .map((req) => (
          <div key={req.id} className="shrink-0 border-t border-[var(--theme-accent)]/40 bg-[var(--theme-bg-surface)] px-6 py-3">
            <div className="mx-auto max-w-3xl">
              <AssistantOutsideWriteCard req={req} />
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
                Une écriture attend ta confirmation dans «{' '}
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

      <AssistantComposer sessionId={session.id} busy={busy} onSent={handleSent} />
    </div>
  );
}

/** The conversation folder: copy its path, reveal it in the Finder. */
function WorkDirBar({ path, onReveal }: { path: string; onReveal: () => void }) {
  const short = path.replace(/^.*\/(workspaces\/[^/]+)$/, '…/$1');
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-[var(--theme-border)] px-4 py-1 text-[11px] text-[var(--theme-text-muted)]">
      <span>📁</span>
      <code className="min-w-0 flex-1 truncate" title={path}>
        {short}
      </code>
      <button onClick={() => void navigator.clipboard?.writeText(path)} className="shrink-0 hover:text-[var(--theme-text-primary)]">
        Copier le chemin
      </button>
      <button onClick={onReveal} className="shrink-0 hover:text-[var(--theme-text-primary)]">
        Ouvrir dans le Finder
      </button>
    </div>
  );
}
