import { useEffect, useRef, useState } from 'react';
import { NOOP } from './noop';
import { TICKET_STATUSES, TICKET_STATUS_LABELS } from '@fleex/shared';
import type { Ticket, TicketStatus } from '@fleex/shared';
import { useTicketStore } from '../stores/ticketStore';
import { useAgentEventStore } from '../stores/agentEventStore';
import { useWorkflowRunStore, ACTIVE_STATUSES } from '../stores/workflowRunStore';
import { appWs } from '../services/websocket';
import * as api from '../services/api';
import { cn } from '../lib/cn';
import { tintClasses } from '../lib/tints';
import { MobileSheet, SheetOption } from './MobileSheet';
import { useMobileNavStore, type MobileDetailTab } from './mobileNavStore';
import { PRIORITY_COLOR } from './MobileTicketCard';
import { MobilePageHeader, HeaderIconButton } from './MobilePageHeader';
import { AssistantIcon, StarIcon } from './MobileIcons';
import { MarkdownRenderer } from '../components/scratchpad/MarkdownRenderer';
import { MobileConversation } from './MobileConversation';
import { MobileExecutions } from './MobileExecutions';
import { MobileTicketRepos } from './MobileTicketRepos';
import { MobileWorkflow } from './MobileWorkflow';
import { MobileDeliverables } from './MobileDeliverables';
import { MobileTicketMeta } from './MobileTicketMeta';
import { MarkdownEditor } from '../components/markdown/MarkdownEditor';

type Tab = MobileDetailTab;

const STATUS_DOT: Record<TicketStatus, string> = {
  backlog: tintClasses('gray').solid,
  todo: tintClasses('orange').solid,
  doing: tintClasses('blue').solid,
  reviewing: tintClasses('purple').solid,
  done: tintClasses('green').solid,
  cancelled: tintClasses('gray').solid,
};

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
  const [showStatus, setShowStatus] = useState(false);
  const [deliverableCount, setDeliverableCount] = useState<number | null>(null);
  const setAssistantOpen = useMobileNavStore((s) => s.setAssistantOpen);
  const requestedTab = useMobileNavStore((s) => s.requestedDetailTab);

  // A Focus card can ask for a specific tab (Workflow for a gate, Runs for an
  // error's logs); the request is consumed once per opened ticket.
  const appliedFor = useRef<string | null>(null);
  useEffect(() => {
    if (appliedFor.current === ticket.id) return;
    appliedFor.current = ticket.id;
    setTab(requestedTab ?? 'conversation');
    useMobileNavStore.getState().setDetailTab(requestedTab ?? 'conversation');
    useMobileNavStore.setState({ requestedDetailTab: null });
  }, [ticket.id, requestedTab]);

  useEffect(() => {
    api.fetchTicketDeliverables(ticket.id).then((d) => setDeliverableCount(d.length)).catch(() => {});
  }, [ticket.id, tab]);
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
    { id: 'conversation', label: 'Conversation' },
    { id: 'context', label: 'Contexte' },
    { id: 'deliverables', label: deliverableCount ? `Deliverables ${deliverableCount}` : 'Deliverables' },
    { id: 'runs', label: runningCount > 0 ? `Runs ●` : 'Runs' },
    ...(workflowRuns && workflowRuns.length > 0
      ? [{ id: 'workflow' as const, label: workflowNeedsHuman ? 'Workflow ✋' : 'Workflow' }]
      : []),
  ];

  const repoChips = ticket.links.filter((l) => l.type === 'repository' || l.type === 'worktree');

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header: same layout as every screen */}
      <MobilePageHeader
        title="Ticket"
        count={<span className="font-mono">#{ticket.displayId}</span>}
        onBack={() => selectTicket(null)}
        trailing={
          <>
            <HeaderIconButton
              label={ticket.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
              active={ticket.favorite}
              onClick={() => updateTicket(ticket.id, { favorite: !ticket.favorite }).catch(() => {})}
            >
              <span className={ticket.favorite ? tintClasses('yellow').solidText : undefined}>
                <StarIcon filled={ticket.favorite} />
              </span>
            </HeaderIconButton>
            <HeaderIconButton label="Ouvrir l’assistant sur ce ticket" onClick={() => setAssistantOpen(true)} active>
              <AssistantIcon size={22} />
            </HeaderIconButton>
          </>
        }
      />

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
            className="w-full resize-none rounded-lg border border-[var(--theme-accent)] bg-[var(--theme-bg-secondary)] p-2 text-[17px] font-semibold leading-snug text-[var(--theme-text-primary)] outline-none"
          />
        ) : (
          <h1
            className="text-[17px] font-semibold leading-[1.35] text-[var(--theme-text-primary)]"
            onClick={() => {
              setTitleDraft(ticket.title);
              setEditingTitle(true);
            }}
          >
            {ticket.priority !== 'none' && (
              <span className={cn('mr-2 inline-block h-2 w-2 rounded-full align-middle', PRIORITY_COLOR[ticket.priority])} />
            )}
            {ticket.title}
          </h1>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <button
            onClick={() => setShowStatus(true)}
            className="flex h-11 shrink-0 items-center gap-2 rounded-[10px] bg-[var(--theme-bg-surface)] px-3.5 text-sm font-medium"
          >
            <span className={cn('h-2 w-2 rounded-full', STATUS_DOT[ticket.status])} />
            {TICKET_STATUS_LABELS[ticket.status]} <span className="text-xs text-[var(--theme-text-muted)]">▾</span>
          </button>
          {repoChips.map((l) => (
            <span key={l.id} className="truncate font-mono text-[11px] text-[var(--theme-text-muted)]">
              {l.type === 'worktree' ? `${l.ref.split(':')[0]} ⎇ ${l.ref.split(':')[1] ?? ''}` : l.ref}
            </span>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-[var(--theme-border)] px-3 [scrollbar-width:none]">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setTab(t.id);
              useMobileNavStore.getState().setDetailTab(t.id);
            }}
            className={`min-h-11 shrink-0 whitespace-nowrap px-3 text-[13px] font-medium ${
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
      {tab === 'context' && (
        <div className="flex min-h-0 flex-1 flex-col">
          {editingDesc ? (
            <>
              {/* Own surface kind, defaulting to `write`: this is a dedicated
                  edit screen, so it must never inherit the desktop `split`
                  preference — narrow viewports degrade that to `preview`, and
                  the screen would open with a Save button and no field. */}
              <MarkdownEditor
                surfaceKind="ticket_description_mobile"
                defaultMode="write"
                className="px-4 py-3"
                value={descDraft}
                onChange={setDescDraft}
                placeholder="Description (markdown)…"
                textareaProps={{ autoFocus: true }}
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
                  className="min-h-11 rounded-lg px-4 text-sm text-[var(--theme-text-muted)]"
                >
                  Annuler
                </button>
                <button
                  onClick={saveDescription}
                  className="min-h-11 rounded-lg bg-[var(--theme-accent)] px-4 text-sm font-semibold text-[var(--theme-accent-fg)]"
                >
                  Enregistrer
                </button>
              </div>
            </>
          ) : (
            <div className="relative min-h-0 flex-1 overflow-y-auto px-4 py-3 text-sm" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 24px)' }}>
              <h2 className="pb-1.5 text-[10.5px] font-semibold tracking-[0.06em] text-[var(--theme-text-muted)]">DÉTAILS</h2>
              <button
                type="button"
                onClick={() => setShowMeta(true)}
                className="mb-4 w-full rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] text-left text-[14px]"
              >
                <ContextRow label="Priorité" value={ticket.priority} />
                <ContextRow label="Type" value={ticket.type ?? '—'} />
                <ContextRow label="Tags" value={ticket.tags.join(', ') || '—'} />
                <ContextRow label="Favori" value={ticket.favorite ? 'Oui' : 'Non'} />
                <ContextRow label="Bloqué" value={ticket.blocked ? 'Oui' : 'Non'} last />
              </button>
              <h2 className="pb-1.5 text-[10.5px] font-semibold tracking-[0.06em] text-[var(--theme-text-muted)]">REPOS LIÉS</h2>
              <div className="mb-4 -mx-4">
                <MobileTicketRepos ticket={ticket} />
              </div>
              <h2 className="pb-1.5 text-[10.5px] font-semibold tracking-[0.06em] text-[var(--theme-text-muted)]">DESCRIPTION</h2>
              {ticket.description ? (
                <MarkdownRenderer content={ticket.description} onToggleCheckbox={NOOP} />
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
                className="mt-4 min-h-11 rounded-full border border-[var(--theme-border)] bg-[var(--theme-bg-secondary)] px-4 py-2.5 text-sm font-medium text-[var(--theme-text-primary)] shadow-lg"
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
      {showStatus && (
        <MobileSheet title="Statut" onClose={() => setShowStatus(false)}>
          {(TICKET_STATUSES as readonly TicketStatus[]).map((st) => (
            <SheetOption
              key={st}
              label={TICKET_STATUS_LABELS[st]}
              active={ticket.status === st}
              leading={<span className={cn('h-2 w-2 rounded-full', STATUS_DOT[st])} />}
              onClick={() => {
                setShowStatus(false);
                if (st !== ticket.status) moveTicket(ticket.id, st).catch(() => {});
              }}
            />
          ))}
        </MobileSheet>
      )}
    </div>
  );
}

function ContextRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <span className={cn('flex min-h-11 items-center justify-between px-3', !last && 'border-b border-[var(--theme-border-subtle)]')}>
      <span className="text-[var(--theme-text-muted)]">{label}</span>
      <span className="max-w-[60%] truncate text-[var(--theme-text-primary)]">{value}</span>
    </span>
  );
}
