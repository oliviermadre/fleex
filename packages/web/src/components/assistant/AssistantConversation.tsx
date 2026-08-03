import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { useCapabilities } from '../../hooks/useCapabilities';
import { useFileUpload } from '../../hooks/useFileUpload';
import { useStickToBottom } from '../../hooks/useStickToBottom';
import { cn } from '../../lib/cn';
import { MentionTypeIcon } from '../../lib/primitives';
import { tint, tintText, tintClasses, tintSolid } from '../../lib/tints';
import { useAgentPersonaStore } from '../../stores/agentPersonaStore';
import {
  useAssistantStore,
  toolLabel,
  type AssistantChatItem,
  type AssistantToolStatus,
} from '../../stores/assistantStore';
import { usePanelStore } from '../../stores/panelStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useSkillStore } from '../../stores/skillStore';
import { useTicketStore } from '../../stores/ticketStore';
import { useWorkflowTemplateStore } from '../../stores/workflowTemplateStore';
import { ModelSelect } from '../agents/ModelSelect';
import { MarkdownRenderer } from '../scratchpad/MarkdownRenderer';

import { AssistantStatusDot } from './AssistantSidebar';

const EMPTY_ITEMS: AssistantChatItem[] = [];

// Same option model as the ticket composer: every mention target the
// assistant can act on — agents, panels, skills, workflows, human, tickets.
interface MentionOption {
  insertText: string;
  label: string;
  type: 'agent' | 'human' | 'panel' | 'skill' | 'workflow' | 'ticket';
}

const MAX_TICKET_SUGGESTIONS = 8;

const TOOL_BADGE: Record<AssistantToolStatus, { label: string; className: string }> = {
  running: { label: '⏳ running', className: tintText('yellow') },
  ok: { label: '✓ ok', className: tintText('green') },
  fail: { label: '✗ failed', className: tintText('red') },
  denied: { label: '⊘ denied', className: tintText('gray') },
};

export function AssistantConversation() {
  const connected = useAssistantStore((s) => s.connected);
  const sessions = useAssistantStore((s) => s.sessions);
  const activeId = useAssistantStore((s) => s.activeId);
  const items = useAssistantStore((s) =>
    s.activeId ? (s.itemsBySession[s.activeId] ?? EMPTY_ITEMS) : EMPTY_ITEMS,
  );
  const confirmReqs = useAssistantStore((s) => s.confirmReqs);
  const errorMsg = useAssistantStore((s) => s.errorMsg);
  const autoApproveNotice = useAssistantStore((s) => s.autoApproveNotice);
  const ensureConnected = useAssistantStore((s) => s.ensureConnected);
  const newSession = useAssistantStore((s) => s.newSession);
  const openSession = useAssistantStore((s) => s.openSession);
  const sendUser = useAssistantStore((s) => s.sendUser);
  const answerConfirm = useAssistantStore((s) => s.answerConfirm);
  const setAutoApprove = useAssistantStore((s) => s.setAutoApprove);
  const clearAutoApproveNotice = useAssistantStore((s) => s.clearAutoApproveNotice);
  const setModel = useAssistantStore((s) => s.setModel);

  const [draft, setDraft] = useState('');
  const [autoApproveOpen, setAutoApproveOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { containerRef, maybeStick, scrollToBottom } = useStickToBottom<HTMLDivElement>();

  useEffect(() => {
    ensureConnected();
  }, [ensureConnected]);

  useLayoutEffect(() => {
    maybeStick();
  }, [items, maybeStick]);

  const session = sessions.find((s) => s.id === activeId) ?? null;
  const busy = session ? session.status !== 'idle' : false;
  // Undefined when the companion predates the feature — nothing is approved.
  const autoApprove = session?.autoApprove;

  // ── Image / file upload — same engine as everywhere else ──
  const { isUploading, isDragOver, pasteHandler, dragProps, openFilePicker } = useFileUpload({
    textareaRef,
    value: draft,
    onChange: setDraft,
  });

  // ── Mention autocomplete ──
  const personas = useAgentPersonaStore((s) => s.personas);
  const panels = usePanelStore((s) => s.panels);
  const panelsLoaded = usePanelStore((s) => s.loaded);
  const loadPanels = usePanelStore((s) => s.loadPanels);
  const skills = useSkillStore((s) => s.skills);
  const skillsLoaded = useSkillStore((s) => s.loaded);
  const loadSkills = useSkillStore((s) => s.loadSkills);
  const workflowTemplates = useWorkflowTemplateStore((s) => s.templates);
  const refreshWorkflowTemplates = useWorkflowTemplateStore((s) => s.refresh);
  const humanMentionName = useSettingsStore(
    (s) =>
      (s.settings as unknown as Record<string, unknown>)['humanMentionName'] as string | undefined,
  );
  const allTickets = useTicketStore((s) => s.tickets);
  const fetchTickets = useTicketStore((s) => s.fetchTickets);
  const { workflowsAvailable } = useCapabilities();

  useEffect(() => {
    if (!panelsLoaded) loadPanels();
    if (!skillsLoaded) loadSkills();
    if (workflowTemplates.length === 0) void refreshWorkflowTemplates();
    if (allTickets.length === 0) void fetchTickets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelsLoaded, loadPanels, skillsLoaded, loadSkills]);

  const [acOpen, setAcOpen] = useState(false);
  const [acQuery, setAcQuery] = useState('');
  const [acIndex, setAcIndex] = useState(0);
  const [acTriggerPos, setAcTriggerPos] = useState(-1);

  const allMentionOptions = useMemo<MentionOption[]>(() => {
    const opts: MentionOption[] = personas.map((p) => ({
      insertText: `@agent:${p.name}`,
      label: p.displayName || p.name,
      type: 'agent' as const,
    }));
    for (const panel of panels) {
      if (panel.enabled)
        opts.push({
          insertText: `@panel:${panel.name}`,
          label: panel.displayName || panel.name,
          type: 'panel',
        });
    }
    for (const skill of skills) {
      if (skill.enabled)
        opts.push({
          insertText: `@skill:${skill.commandName}`,
          label: skill.displayName || skill.commandName,
          type: 'skill',
        });
    }
    // Workflows are dropped (not disabled) when the driver can't run them — a
    // dead row in an autocomplete is noise, not signal.
    if (workflowsAvailable) {
      for (const wf of workflowTemplates) {
        if (wf.enabled)
          opts.push({
            insertText: `@workflow:${wf.slug}`,
            label: wf.emoji ? `${wf.emoji} ${wf.name}` : wf.name,
            type: 'workflow',
          });
      }
    }
    if (humanMentionName)
      opts.push({ insertText: `@${humanMentionName}`, label: humanMentionName, type: 'human' });
    for (const t of allTickets) {
      opts.push({
        insertText: `@ticket:${t.displayId}`,
        label: `#${t.displayId} ${t.title}`,
        type: 'ticket',
      });
    }
    return opts;
  }, [
    personas,
    panels,
    skills,
    workflowTemplates,
    workflowsAvailable,
    humanMentionName,
    allTickets,
  ]);

  const filteredOptions = useMemo(() => {
    if (!acOpen) return [];
    const q = acQuery.toLowerCase();
    const matches = (o: MentionOption) =>
      o.label.toLowerCase().includes(q) || o.insertText.toLowerCase().includes(q);
    const nonTicket = allMentionOptions.filter((o) => o.type !== 'ticket' && matches(o));
    if (q.length === 0) return nonTicket;
    const tickets = allMentionOptions
      .filter((o) => o.type === 'ticket' && matches(o))
      .slice(0, MAX_TICKET_SUGGESTIONS);
    return [...nonTicket, ...tickets];
  }, [acOpen, acQuery, allMentionOptions]);

  const closeMentionAc = useCallback(() => {
    setAcOpen(false);
    setAcQuery('');
    setAcIndex(0);
    setAcTriggerPos(-1);
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const val = e.target.value;
      const cursor = e.target.selectionStart;
      setDraft(val);
      const textBeforeCursor = val.slice(0, cursor);
      const atIdx = textBeforeCursor.lastIndexOf('@');
      if (atIdx >= 0 && (atIdx === 0 || /\s/.test(textBeforeCursor[atIdx - 1]!))) {
        const fragment = textBeforeCursor.slice(atIdx + 1);
        if (!/\s/.test(fragment)) {
          setAcOpen(true);
          setAcTriggerPos(atIdx);
          setAcQuery(fragment.replace(/^(agent|panel|skill|workflow|ticket):/, ''));
          setAcIndex(0);
          return;
        }
      }
      closeMentionAc();
    },
    [closeMentionAc],
  );

  const acceptMention = useCallback(
    (opt: MentionOption) => {
      const ta = textareaRef.current;
      if (!ta || acTriggerPos < 0) return;
      const before = draft.slice(0, acTriggerPos);
      const after = draft.slice(ta.selectionStart);
      const newDraft = before + opt.insertText + ' ' + after;
      setDraft(newDraft);
      closeMentionAc();
      const newCursor = acTriggerPos + opt.insertText.length + 1;
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(newCursor, newCursor);
      });
    },
    [draft, acTriggerPos, closeMentionAc],
  );

  const handleSend = useCallback(() => {
    const text = draft.trim();
    if (!text || !activeId || busy || isUploading) return;
    sendUser(text);
    setDraft('');
    closeMentionAc();
    scrollToBottom();
  }, [draft, activeId, busy, isUploading, sendUser, closeMentionAc, scrollToBottom]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (acOpen && filteredOptions.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setAcIndex((i) => (i + 1) % filteredOptions.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setAcIndex((i) => (i - 1 + filteredOptions.length) % filteredOptions.length);
          return;
        }
        if (e.key === 'Tab' || e.key === 'Enter') {
          e.preventDefault();
          acceptMention(filteredOptions[acIndex]!);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          closeMentionAc();
          return;
        }
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [acOpen, filteredOptions, acIndex, acceptMention, closeMentionAc, handleSend],
  );

  // ── Empty states ──
  if (!connected) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-[var(--theme-bg-primary)] px-8 text-center">
        <p className="text-3xl">🤖</p>
        <p className="text-sm font-medium text-[var(--theme-text-primary)]">
          Companion injoignable
        </p>
        <p className="max-w-md text-xs leading-relaxed text-[var(--theme-text-muted)]">
          L'assistant s'appuie sur le companion (<code>fleex companion start</code>, démarré
          automatiquement par <code>fleex start</code>). Reconnexion automatique…
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
                <button
                  type="button"
                  aria-label="Fermer"
                  className="fixed inset-0 z-20 cursor-default"
                  onClick={() => setAutoApproveOpen(false)}
                />
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
                        <li
                          key={t}
                          className="font-mono text-[11px] text-[var(--theme-text-secondary)]"
                        >
                          • {toolLabel(t)}
                        </li>
                      ))}
                    </ul>
                  )}
                  <label className="flex cursor-pointer items-center gap-2 border-t border-[var(--theme-border)] pt-2 text-xs text-[var(--theme-text-primary)]">
                    <input
                      type="checkbox"
                      checked={autoApprove.all}
                      onChange={(e) =>
                        setAutoApprove(session.id, { all: e.target.checked, tools: [] })
                      }
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
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {items.map((item, i) => {
            if (item.kind === 'user') {
              return (
                <div
                  key={i}
                  className="ml-12 rounded-xl bg-[var(--theme-accent)]/10 px-4 py-3 text-sm"
                >
                  <MarkdownRenderer content={item.text} onToggleCheckbox={() => {}} />
                </div>
              );
            }
            if (item.kind === 'assistant') {
              return (
                <div key={i} className="overflow-x-auto text-sm">
                  <MarkdownRenderer content={item.text} onToggleCheckbox={() => {}} />
                </div>
              );
            }
            const badge = TOOL_BADGE[item.status];
            return (
              <details
                key={i}
                className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-3 py-2"
              >
                <summary className="cursor-pointer font-mono text-[11px]">
                  {item.autoApproved && (
                    <span className={cn('mr-1', tintText('yellow'))} title="Auto-approuvé">
                      ⚡
                    </span>
                  )}
                  <span className={cn('mr-2', badge.className)}>{badge.label}</span>
                  <span className="break-all text-[var(--theme-text-secondary)]">
                    fleex {item.argv.join(' ')}
                  </span>
                </summary>
                {item.text && (
                  <pre className="mt-2 max-h-64 overflow-auto rounded bg-[var(--theme-bg-overlay)] p-2 text-[10px] leading-relaxed text-[var(--theme-text-secondary)]">
                    {item.text}
                  </pre>
                )}
              </details>
            );
          })}
          {busy && (
            <p className="animate-pulse text-xs text-[var(--theme-text-faint)]">
              {session.status === 'awaiting_input'
                ? 'En attente de ta confirmation…'
                : 'Réflexion…'}
            </p>
          )}
          {errorMsg && <p className={cn('rounded-lg p-2.5 text-xs', tint('red'))}>{errorMsg}</p>}
        </div>
      </div>

      {/* Mutating command approval — pinned OUTSIDE the scroll area so it can
          never sit unnoticed below the fold while the assistant waits. */}
      {confirmReqs
        .filter((r) => r.sessionId === session.id)
        .map((req) => (
          <div
            key={req.id}
            className="shrink-0 border-t border-[var(--theme-accent)]/40 bg-[var(--theme-bg-surface)] px-6 py-3"
          >
            <div className="mx-auto max-w-3xl">
              <p className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-[var(--theme-text-muted)]">
                <span
                  className={cn(
                    'inline-block h-2 w-2 animate-pulse rounded-full',
                    tintSolid('yellow'),
                  )}
                />
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
          <div
            key={req.id}
            className={cn(
              'shrink-0 border-t px-6 py-2',
              tintClasses('yellow').borderColor,
              tintClasses('yellow').bg,
            )}
          >
            <div className="mx-auto flex max-w-3xl items-center gap-2 text-xs text-[var(--theme-text-primary)]">
              <span
                className={cn(
                  'inline-block h-2 w-2 shrink-0 animate-pulse rounded-full',
                  tintSolid('yellow'),
                )}
              />
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
        <div
          className={cn(
            'shrink-0 border-t px-6 py-2',
            tintClasses('yellow').borderColor,
            tintClasses('yellow').bg,
          )}
        >
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

      {/* Composer */}
      <div className="shrink-0 border-t border-[var(--theme-border)] px-6 py-3">
        <div className="relative mx-auto max-w-3xl">
          {/* Autocomplete dropdown */}
          {acOpen && filteredOptions.length > 0 && (
            <div className="absolute bottom-full left-0 z-30 mb-1 max-h-56 min-w-[280px] overflow-y-auto rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] py-1 shadow-xl">
              {filteredOptions.map((opt, i) => (
                <button
                  key={opt.insertText}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    acceptMention(opt);
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors',
                    i === acIndex
                      ? 'bg-[var(--theme-accent)]/15 text-[var(--theme-text-primary)]'
                      : 'text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]',
                  )}
                >
                  <MentionTypeIcon type={opt.type} />
                  <span className="min-w-0 flex-1 truncate font-medium">{opt.label}</span>
                  <span className="shrink-0 text-[10px] text-[var(--theme-text-faint)]">
                    {opt.type}
                  </span>
                </button>
              ))}
            </div>
          )}
          <div
            className={cn(
              'flex items-end gap-2 rounded-xl border bg-[var(--theme-bg-surface)] p-2',
              isDragOver ? 'border-[var(--theme-accent)]' : 'border-[var(--theme-border)]',
            )}
            {...dragProps}
          >
            <button
              onClick={openFilePicker}
              className="shrink-0 rounded-md p-2 text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]"
              title="Joindre une image ou un fichier"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onPaste={pasteHandler}
              onBlur={() => setTimeout(closeMentionAc, 200)}
              placeholder={
                busy
                  ? 'Assistant au travail…'
                  : 'Demande quelque chose… (@ pour référencer agents, skills, panels, workflows, tickets — ⇧⏎ pour une nouvelle ligne)'
              }
              rows={2}
              className="min-h-0 flex-1 resize-none bg-transparent px-1 py-1.5 text-sm leading-relaxed text-[var(--theme-text-primary)] outline-none placeholder:text-[var(--theme-text-faint)]"
            />
            <button
              onClick={handleSend}
              disabled={!draft.trim() || busy || isUploading}
              className="shrink-0 rounded-lg bg-[var(--theme-accent)] px-4 py-2 text-sm font-semibold text-[var(--theme-accent-fg)] transition-colors hover:bg-[var(--theme-accent-hover)] disabled:opacity-50"
            >
              {isUploading ? '…' : '➤'}
            </button>
          </div>
          {isUploading && (
            <p className="mt-1 text-[10px] text-[var(--theme-text-faint)]">Upload en cours…</p>
          )}
        </div>
      </div>
    </div>
  );
}
