import { useEffect, useState } from 'react';
import { TICKET_STATUSES, TICKET_STATUS_LABELS } from '@fleex/shared';
import type { Ticket, TicketStatus } from '@fleex/shared';
import { useTicketStore } from '../stores/ticketStore';
import { useAgentEventStore } from '../stores/agentEventStore';
import { useWorkflowRunStore, ACTIVE_STATUSES } from '../stores/workflowRunStore';
import { appWs } from '../services/websocket';
import { MarkdownRenderer } from '../components/scratchpad/MarkdownRenderer';
import { MobileConversation } from './MobileConversation';
import { MobileExecutions } from './MobileExecutions';
import { MobileTicketRepos } from './MobileTicketRepos';
import { MobileWorkflow } from './MobileWorkflow';
import { MobileDeliverables } from './MobileDeliverables';
import { MobileTicketMeta } from './MobileTicketMeta';

type Tab = 'description' | 'conversation' | 'deliverables' | 'runs' | 'workflow';

export function MobileTicketDetail({ ticket }: { ticket: Ticket }) {
  const selectTicket = useTicketStore((s) => s.selectTicket);
  const moveTicket = useTicketStore((s) => s.moveTicket);

  const subscribeTicket = useAgentEventStore((s) => s.subscribeTicket);
  const unsubscribeTicket = useAgentEventStore((s) => s.unsubscribeTicket);
  const loadExecutionsForTicket = useAgentEventStore((s) => s.loadExecutionsForTicket);
  const runningCount = useAgentEventStore(
    (s) => (s.executionsByTicket[ticket.id] ?? []).filter((e) => e.status === 'running').length,
  );

  const loadWorkflowRuns = useWorkflowRunStore((s) => s.loadForTicket);
  const workflowRuns = useWorkflowRunStore((s) => s.runsByTicket[ticket.id]);
  const activeWorkflowRun = workflowRuns?.find((r) => ACTIVE_STATUSES.has(r.status));
  // A gate or a question is waiting on the user → badge the tab
  const workflowNeedsHuman =
    activeWorkflowRun?.status === 'needs_review' || activeWorkflowRun?.status === 'blocked';

  const [tab, setTab] = useState<Tab>('conversation');
  const [showMeta, setShowMeta] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(ticket.title);
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState(ticket.description);
  const updateTicket = useTicketStore((s) => s.updateTicket);

  const saveTitle = () => {
    const title = titleDraft.trim();
    setEditingTitle(false);
    if (title && title !== ticket.title) updateTicket(ticket.id, { title }).catch(() => {});
  };

  const saveDescription = () => {
    setEditingDesc(false);
    if (descDraft !== ticket.description) {
      updateTicket(ticket.id, { description: descDraft }).catch(() => {});
    }
  };

  // Live agent activity for this ticket (new executions stream in via WS)
  useEffect(() => {
    loadExecutionsForTicket(ticket.id);
    subscribeTicket(ticket.id);
    return () => unsubscribeTicket(ticket.id);
  }, [ticket.id, loadExecutionsForTicket, subscribeTicket, unsubscribeTicket]);

  // Workflow runs: loaded at detail level so the tab badge works without
  // opening the tab; workflow:* WS events keep the store fresh (same wiring
  // as the desktop TicketDetail).
  useEffect(() => {
    void loadWorkflowRuns(ticket.id);
    const unsub = appWs.onChannel('tickets', (raw) => {
      if (!raw.type.startsWith('workflow:')) return;
      const data = raw.data as { ticketId?: string };
      if (data?.ticketId === ticket.id) {
        useWorkflowRunStore.getState().applyEvent({
          type: raw.type,
          ticketId: ticket.id,
          payload: raw.data as Record<string, unknown>,
        });
      }
    });
    return unsub;
  }, [ticket.id, loadWorkflowRuns]);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'description', label: 'Description' },
    { id: 'conversation', label: 'Conversation' },
    { id: 'deliverables', label: 'Deliverables' },
    { id: 'runs', label: runningCount > 0 ? `Runs ●` : 'Runs' },
    ...(workflowRuns && workflowRuns.length > 0
      ? [{ id: 'workflow' as const, label: workflowNeedsHuman ? 'Workflow ✋' : 'Workflow' }]
      : []),
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header */}
      <header className="flex shrink-0 items-center gap-2 border-b border-[var(--theme-border)] px-2 py-2">
        <button
          onClick={() => selectTicket(null)}
          className="shrink-0 rounded-md px-2 py-1.5 text-xl leading-none text-[var(--theme-text-muted)]"
          aria-label="Retour au board"
        >
          ‹
        </button>
        <span className="shrink-0 font-mono text-xs text-[var(--theme-text-faint)]">
          #{ticket.displayId}
        </span>
        <div className="min-w-0 flex-1" />
        <select
          value={ticket.status}
          onChange={(e) => moveTicket(ticket.id, e.target.value as TicketStatus)}
          className="shrink-0 appearance-none rounded-md bg-[var(--theme-bg-secondary)] px-3 py-1.5 text-xs font-medium text-[var(--theme-text-primary)]"
        >
          {(TICKET_STATUSES as readonly TicketStatus[]).map((s) => (
            <option key={s} value={s}>
              {TICKET_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <button
          onClick={() => setShowMeta(true)}
          className="shrink-0 rounded-md bg-[var(--theme-bg-secondary)] px-2.5 py-1.5 text-sm leading-none text-[var(--theme-text-muted)]"
          aria-label="Détails du ticket"
        >
          ⋯
        </button>
      </header>

      {/* Title (tap to edit) */}
      <div className="shrink-0 px-4 pb-1 pt-3">
        {editingTitle ? (
          <textarea
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                saveTitle();
              }
              if (e.key === 'Escape') {
                setTitleDraft(ticket.title);
                setEditingTitle(false);
              }
            }}
            rows={2}
            className="w-full resize-none rounded-lg border border-[var(--theme-accent)] bg-[var(--theme-bg-secondary)] p-2 text-base font-semibold leading-snug text-[var(--theme-text-primary)] outline-none"
          />
        ) : (
          <h1
            className="text-base font-semibold leading-snug text-[var(--theme-text-primary)]"
            onClick={() => {
              setTitleDraft(ticket.title);
              setEditingTitle(true);
            }}
          >
            {ticket.title}
          </h1>
        )}
      </div>

      {/* Repository links — required for worktrees and agent context */}
      <MobileTicketRepos ticket={ticket} />

      {/* Tabs */}
      <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-[var(--theme-border)] px-3 pt-2 [scrollbar-width:none]">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`shrink-0 rounded-t-md px-3 py-2 text-xs font-medium ${
              tab === t.id
                ? 'border-b-2 border-[var(--theme-accent)] text-[var(--theme-text-primary)]'
                : 'text-[var(--theme-text-muted)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {/* Content */}
      {tab === 'description' && (
        <div className="flex min-h-0 flex-1 flex-col">
          {editingDesc ? (
            <>
              <textarea
                autoFocus
                value={descDraft}
                onChange={(e) => setDescDraft(e.target.value)}
                placeholder="Description (markdown)…"
                className="min-h-0 flex-1 resize-none bg-[var(--theme-bg-base)] px-4 py-3 font-mono text-[13px] leading-relaxed text-[var(--theme-text-primary)] outline-none"
              />
              <div
                className="flex shrink-0 justify-end gap-2 border-t border-[var(--theme-border)] px-3 py-2"
                style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 8px)' }}
              >
                <button
                  onClick={() => {
                    setDescDraft(ticket.description);
                    setEditingDesc(false);
                  }}
                  className="rounded-lg px-4 py-2 text-sm text-[var(--theme-text-muted)]"
                >
                  Annuler
                </button>
                <button
                  onClick={saveDescription}
                  className="rounded-lg bg-[var(--theme-accent)] px-4 py-2 text-sm font-semibold text-white"
                >
                  Enregistrer
                </button>
              </div>
            </>
          ) : (
            <div className="relative min-h-0 flex-1 overflow-y-auto px-4 py-3 text-sm">
              {ticket.description ? (
                <MarkdownRenderer content={ticket.description} onToggleCheckbox={() => {}} />
              ) : (
                <p className="py-8 text-center text-sm text-[var(--theme-text-faint)]">
                  Pas de description
                </p>
              )}
              <button
                onClick={() => {
                  setDescDraft(ticket.description);
                  setEditingDesc(true);
                }}
                className="absolute bottom-4 right-4 rounded-full border border-[var(--theme-border)] bg-[var(--theme-bg-secondary)] px-4 py-2.5 text-sm font-medium text-[var(--theme-text-primary)] shadow-lg"
              >
                ✎ Modifier
              </button>
            </div>
          )}
        </div>
      )}
      {tab === 'conversation' && <MobileConversation ticket={ticket} />}
      {tab === 'deliverables' && <MobileDeliverables ticketId={ticket.id} />}
      {tab === 'runs' && <MobileExecutions ticketId={ticket.id} />}
      {tab === 'workflow' && <MobileWorkflow ticketId={ticket.id} />}

      {showMeta && <MobileTicketMeta ticket={ticket} onClose={() => setShowMeta(false)} />}
    </div>
  );
}
