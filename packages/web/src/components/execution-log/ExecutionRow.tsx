import { memo, useState, useCallback, useRef, useEffect } from 'react';
import type { ExecutionLogEntry, TicketType, PanelMemberSummary, WorkflowStepSummary } from '@fleex/shared';
import { cancelExecution } from '../../services/api';
import { FloatingExecutionPanel } from '../tickets/ExecutionModal';
import { useTicketStore } from '../../stores/ticketStore';
import { useUIStore } from '../../stores/uiStore';
import { cn } from '../../lib/cn';
import { TYPE_COLORS as TICKET_TYPE_COLORS } from '../tickets/TicketTypeBadge';
import { tint, tintText, tintSolid, tintClasses } from '../../lib/tints';
import { PrimitiveIcon, type PrimitiveKind } from '../../lib/primitives';

// ── Type badge ──

// An execution's `type` maps onto a primitive kind ('agent' is the log-side
// name for a persona run). Both the glyph and its hue come from the
// `primitives.tsx` referential, so the Logs stay coherent with the sidebar.
const EXEC_TYPE_TO_KIND: Record<ExecutionLogEntry['type'], PrimitiveKind> = {
  agent: 'persona',
  panel: 'panel',
  skill: 'skill',
  workflow: 'workflow',
};

function TypeBadge({ type }: { type: ExecutionLogEntry['type'] }) {
  return (
    <div className="flex w-[80px] flex-shrink-0 items-center gap-1.5">
      <PrimitiveIcon kind={EXEC_TYPE_TO_KIND[type]} size={14} />
      <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--theme-text-secondary)]">{type}</span>
    </div>
  );
}

// ── Priority-colored ticket icon (same as session view) ──

const PRIORITY_COLORS: Record<string, string> = {
  none: 'text-[var(--theme-text-muted)]',
  low: tintText('blue'),
  medium: tintText('yellow'),
  high: tintText('red'),
};

function TicketIcon({ priority }: { priority: string | null }) {
  const color = PRIORITY_COLORS[priority ?? 'none'] ?? PRIORITY_COLORS['none'];
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={cn('flex-shrink-0', color)}>
      <rect x="2" y="2" width="12" height="12" rx="2" />
      <path d="M5 6h6M5 9h4" />
    </svg>
  );
}

// ── Mode badge ──

function ModeBadge({ mode }: { mode: string | null | undefined }) {
  if (!mode) return null;
  const config: Record<string, { label: string; bg: string; text: string; border: string }> = {
    edit: { label: 'EDIT', bg: tintClasses('green').bg, text: tintText('green'), border: tintClasses('green').borderColor },
    plan: { label: 'PLAN', bg: tintClasses('blue').bg, text: tintText('blue'), border: tintClasses('blue').borderColor },
    talk: { label: 'TALK', bg: tintClasses('gray').bg, text: tintText('gray'), border: tintClasses('gray').borderColor },
  };
  const c = config[mode];
  if (!c) return null;

  return (
    <span className={cn('inline-flex items-center gap-1 rounded border px-1.5 py-px text-[10px] font-semibold', c.bg, c.text, c.border)}>
      {mode === 'edit' && (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
        </svg>
      )}
      {mode === 'plan' && (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="3" />
        </svg>
      )}
      {mode === 'talk' && (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      )}
      {c.label}
    </span>
  );
}

// ── Ticket type label ──

const TICKET_TYPE_LABELS: Record<string, string> = {
  build: 'Build', fix: 'Fix', review: 'Review', ops: 'Ops', lead: 'Lead', think: 'Think',
};

// ── Status badge ──

function StatusBadge({
  status,
  workflowSubStatus,
}: {
  status: ExecutionLogEntry['status'];
  workflowSubStatus?: 'needs_review' | 'blocked';
}) {
  // Workflow sub-status overrides the default badge — a workflow run in
  // `needs_review`/`blocked` reports `status='running'` (it's still alive),
  // but the user needs to see the amber "needs your attention" signal.
  if (workflowSubStatus === 'needs_review') {
    return (
      <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-semibold', tint('yellow'))}>
        <span className="relative flex h-1.5 w-1.5">
          <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-75', tintSolid('yellow'))} />
          <span className={cn('relative inline-flex h-1.5 w-1.5 rounded-full', tintSolid('yellow'))} />
        </span>
        Needs Review
      </span>
    );
  }
  if (workflowSubStatus === 'blocked') {
    return (
      <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-semibold', tint('orange'))}>
        <span className={cn('relative inline-flex h-1.5 w-1.5 rounded-full', tintSolid('orange'))} />
        Blocked
      </span>
    );
  }

  const config: Record<string, { label: string; dot: string; text: string; bg: string; border: string; pulse?: boolean }> = {
    running: { label: 'Running', dot: tintSolid('green'), text: tintText('green'), bg: tintClasses('green').bg, border: tintClasses('green').borderColor, pulse: true },
    completed: { label: 'Completed', dot: tintSolid('green'), text: tintText('green'), bg: tintClasses('green').bg, border: tintClasses('green').borderColor },
    failed: { label: 'Failed', dot: tintSolid('red'), text: tintText('red'), bg: tintClasses('red').bg, border: tintClasses('red').borderColor },
    interrupted: { label: 'Interrupted', dot: tintSolid('orange'), text: tintText('orange'), bg: tintClasses('orange').bg, border: tintClasses('orange').borderColor },
  };
  const c = config[status] ?? config['completed']!;

  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-semibold', c.bg, c.text, c.border)}>
      <span className="relative flex h-1.5 w-1.5">
        {c.pulse && <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-75', c.dot)} />}
        <span className={cn('relative inline-flex h-1.5 w-1.5 rounded-full', c.dot)} />
      </span>
      {c.label}
    </span>
  );
}

// ── Workflow step progress dots ──

const STEP_DOT_CLASSES: Record<WorkflowStepSummary['status'], string> = {
  pending: 'bg-[var(--theme-bg-surface)] border border-[var(--theme-text-faint)]/50',
  queued: 'bg-[var(--theme-bg-surface)] border border-[var(--theme-text-faint)]/70',
  running: `${tintSolid('blue')} border ${tintClasses('blue').borderColor} shadow-[0_0_6px_rgba(96,165,250,0.6)] animate-pulse`,
  completed: `${tintSolid('green')} border ${tintClasses('green').borderColor}`,
  failed: `${tintSolid('red')} border ${tintClasses('red').borderColor}`,
  needs_review: `${tintSolid('yellow')} border ${tintClasses('yellow').borderColor}`,
  cancelled: 'bg-[var(--theme-text-faint)]/30 border border-[var(--theme-text-faint)]/40',
  skipped: 'bg-[var(--theme-text-faint)]/30 border border-[var(--theme-text-faint)]/40',
};

// Connector line color: matches the incoming step (the one the line leads
// INTO), so the chain "lights up" as the workflow advances.
const STEP_LINE_CLASSES: Record<WorkflowStepSummary['status'], string> = {
  pending: 'bg-[var(--theme-text-faint)]/25',
  queued: 'bg-[var(--theme-text-faint)]/30',
  running: tintSolid('blue'),
  completed: tintSolid('green'),
  failed: tintSolid('red'),
  needs_review: tintSolid('yellow'),
  cancelled: 'bg-[var(--theme-text-faint)]/25',
  skipped: 'bg-[var(--theme-text-faint)]/25',
};

function WorkflowStepDots({ progress }: { progress: WorkflowStepSummary[] }) {
  // Cap visible chain — beyond this we collapse to a "+N" indicator. The
  // full DAG is one click away on the Workflow tab.
  const MAX_VISIBLE = 9;
  const visible = progress.slice(0, MAX_VISIBLE);
  const overflow = progress.length - visible.length;

  return (
    <div className="flex items-center justify-end">
      {visible.map((s, i) => (
        <span key={s.stepId} className="flex flex-shrink-0 items-center">
          {i > 0 && (
            <span
              className={cn('h-[2px] w-2.5 flex-shrink-0', STEP_LINE_CLASSES[s.status])}
              aria-hidden
            />
          )}
          <span
            title={`${s.name} — ${s.status}${s.isCurrent ? ' (current)' : ''}`}
            className={cn(
              'h-3 w-3 flex-shrink-0 rounded-full',
              STEP_DOT_CLASSES[s.status],
              s.isCurrent && `ring-2 ${tintClasses('green').ring} ring-offset-1 ring-offset-[var(--theme-bg-base)]`,
            )}
          />
        </span>
      ))}
      {overflow > 0 && (
        <span className="ml-1 text-[10px] tabular-nums text-[var(--theme-text-faint)]" title={`+${overflow} more steps`}>
          +{overflow}
        </span>
      )}
    </div>
  );
}

// ── Duration display ──

function formatDuration(ms: number): string {
  if (ms < 1000) return '<1s';
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

function LiveDuration({ startedAt }: { startedAt: string }) {
  const [now, setNow] = useState(Date.now());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    intervalRef.current = setInterval(() => setNow(Date.now()), 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);
  const ms = now - new Date(startedAt).getTime();
  return (
    <span className="font-mono text-xs text-[var(--theme-text-muted)]" title={new Date(startedAt).toLocaleString()}>
      {formatDuration(ms)}
    </span>
  );
}

// ── Relative time ("X ago") ──

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

function formatFullDatetime(iso: string): string {
  return new Date(iso).toLocaleString();
}

// ── Token display ──

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

// ── CTA icons ──

function CommentIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
      <path d="M2 3.5A1.5 1.5 0 013.5 2h9A1.5 1.5 0 0114 3.5v7a1.5 1.5 0 01-1.5 1.5H5l-3 2.5V3.5z" />
    </svg>
  );
}

function DeliverableIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="1.5" width="10" height="13" rx="1.5" />
      <path d="M5.5 5h5M5.5 8h5M5.5 11h3" />
    </svg>
  );
}

function TicketLinkIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="12" height="12" rx="2" />
      <path d="M5 6h6M5 9h4" />
    </svg>
  );
}

function ExecutionLogIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="6" r="1" />
      <path d="M9 6h11" />
      <circle cx="5" cy="12" r="1" />
      <path d="M9 12h9" />
      <circle cx="5" cy="18" r="1" />
      <path d="M9 18h11" />
    </svg>
  );
}

// ── Participant stack (for panel rows) ──

const MEMBER_STATUS_CLASSES: Record<PanelMemberSummary['status'], string> = {
  pending: 'border border-dashed border-[var(--theme-text-faint)] opacity-60',
  running: `border-2 ${tintClasses('blue').borderColor} animate-pulse`,
  completed: `border-2 ${tintClasses('green').borderColor}`,
  failed: `border-2 ${tintClasses('red').borderColor}`,
  interrupted: `border-2 ${tintClasses('orange').borderColor}`,
};

const MEMBER_STATUS_LABELS: Record<PanelMemberSummary['status'], string> = {
  pending: 'pending',
  running: 'running',
  completed: 'done',
  failed: 'failed',
  interrupted: 'interrupted',
};

function ParticipantStack({
  members,
  onOpen,
}: {
  members: PanelMemberSummary[];
  onOpen: (executionId: string) => void;
}) {
  return (
    <div className="flex items-center justify-end gap-1 overflow-visible">
      {members.map((m) => {
        const isPending = m.status === 'pending';
        const statusClasses = MEMBER_STATUS_CLASSES[m.status];
        const baseLabel = m.isOrchestrator
          ? `${m.displayName} · orchestrator`
          : m.displayName;
        const title = isPending
          ? `${baseLabel} · ${MEMBER_STATUS_LABELS[m.status]}`
          : `${baseLabel} · ${MEMBER_STATUS_LABELS[m.status]} — view execution`;
        return (
          <button
            key={m.executionId}
            type="button"
            disabled={isPending}
            onClick={(e) => {
              e.stopPropagation();
              if (isPending) return;
              onOpen(m.executionId);
            }}
            title={title}
            className={cn(
              'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold transition-transform',
              tintClasses('purple').bg,
              statusClasses,
              isPending
                ? 'cursor-default'
                : 'cursor-pointer hover:scale-110',
              m.isOrchestrator
                ? `ring-1 ${tintClasses('yellow').ring} ring-offset-1 ring-offset-[var(--theme-bg-base)] ${tintText('yellow')}`
                : tintText('purple'),
            )}
          >
            {m.initials}
          </button>
        );
      })}
    </div>
  );
}

// ── Main row component ──

export const ExecutionRow = memo(function ExecutionRow({
  entry,
  live,
}: {
  entry: ExecutionLogEntry;
  live: boolean;
}) {
  const [openExecutionId, setOpenExecutionId] = useState<string | null>(null);
  const [cancelState, setCancelState] = useState<'idle' | 'confirming' | 'cancelling'>('idle');
  const cancelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectTicket = useTicketStore((s) => s.selectTicket);
  const setTicketTab = useTicketStore((s) => s.setTicketTab);
  const setActivePanel = useUIStore((s) => s.setActivePanel);

  const handleCancel = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (cancelState === 'idle') {
        setCancelState('confirming');
        cancelTimerRef.current = setTimeout(() => setCancelState('idle'), 1500);
      } else if (cancelState === 'confirming') {
        if (cancelTimerRef.current) clearTimeout(cancelTimerRef.current);
        setCancelState('cancelling');
        try { await cancelExecution(entry.id); } catch { /* ignore */ }
        setCancelState('idle');
      }
    },
    [cancelState, entry.id],
  );

  const navigateToTicket = useCallback((e: React.MouseEvent, tab?: 'comments' | 'deliverables' | 'workflow') => {
    e.stopPropagation();
    selectTicket(entry.ticketId);
    if (tab) setTicketTab(tab);
    setActivePanel('tickets');
  }, [entry.ticketId, selectTicket, setTicketTab, setActivePanel]);

  const isPanelRun = entry.type === 'panel' && !!entry.panelMembers && entry.panelMembers.length > 0;
  const isWorkflow = entry.type === 'workflow';
  const title = entry.ticketTitle || entry.executorName;
  const referenceTime = live ? entry.startedAt : (entry.completedAt ?? entry.startedAt);

  // Subtitle: mode · ticketType (ticketType colored per Kanban palette)
  const ticketTypeLabel = entry.ticketType ? (TICKET_TYPE_LABELS[entry.ticketType] ?? entry.ticketType) : null;
  const ticketTypeColor = entry.ticketType ? TICKET_TYPE_COLORS[entry.ticketType as TicketType] : '';

  return (
    <>
      <div
        className="group flex w-full items-center gap-3 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-base)] px-4 py-3 transition-colors hover:bg-[var(--theme-bg-hover)]"
      >
        {/* Col 1: Type badge */}
        <TypeBadge type={entry.type} />

        {/* Col 2: Title block (ticket icon + title / mode + agent + ticket type) */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <TicketIcon priority={entry.ticketPriority} />
            <span className="truncate text-sm font-semibold text-[var(--theme-text-primary)]">{title}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 pl-[18px] text-xs text-[var(--theme-text-faint)]">
            {isWorkflow ? (
              <>
                <span className={cn('flex-shrink-0 font-medium', tintText('orange'))}>
                  {entry.executorName}
                </span>
                <span className="text-[var(--theme-text-faint)]">·</span>
                <span className="truncate" title={entry.workflowCurrentStepName ?? undefined}>
                  {entry.workflowSubStatus === 'needs_review'
                    ? `Awaiting decision on "${entry.workflowCurrentStepName ?? '?'}"`
                    : entry.status === 'completed'
                      ? `Completed · ${entry.workflowTotalSteps ?? 0} steps`
                      : entry.status === 'failed'
                        ? `Failed at "${entry.workflowCurrentStepName ?? '?'}"`
                        : entry.workflowCurrentStepName
                          ? `Step ${(entry.workflowCompletedSteps ?? 0) + 1}/${entry.workflowTotalSteps ?? 0} · ${entry.workflowCurrentStepName}`
                          : `${entry.workflowCompletedSteps ?? 0}/${entry.workflowTotalSteps ?? 0} steps`}
                </span>
              </>
            ) : (
              <>
                <ModeBadge mode={entry.effectiveMode} />
                {ticketTypeLabel && (
                  <span className={cn('font-medium', ticketTypeColor)}>{ticketTypeLabel}</span>
                )}
              </>
            )}
          </div>
        </div>

        {/* Col 3: Agent detail — panel name + clickable participants, or name+model,
             OR (for workflows) step dots + completed/total counter. The wider
             width on workflow rows (220 vs 180) is needed to fit the chain of
             dots + connectors at MAX_VISIBLE=9 without squeezing. */}
        <div
          className={cn(
            'hidden flex-shrink-0 text-right lg:block',
            isWorkflow ? 'w-[220px]' : 'w-[180px]',
            isPanelRun || isWorkflow ? 'overflow-visible' : 'overflow-hidden',
          )}
        >
          {isWorkflow ? (
            <>
              <div className="mb-1">
                {entry.workflowStepProgress && entry.workflowStepProgress.length > 0 ? (
                  <WorkflowStepDots progress={entry.workflowStepProgress} />
                ) : (
                  <span className="text-[10px] text-[var(--theme-text-faint)]">no steps</span>
                )}
              </div>
              <div className="text-[10px] tabular-nums text-[var(--theme-text-faint)]">
                {entry.workflowCompletedSteps ?? 0}/{entry.workflowTotalSteps ?? 0} steps
              </div>
            </>
          ) : isPanelRun ? (
            <>
              <div className="truncate text-xs font-medium text-[var(--theme-text-secondary)]">
                {entry.panelDisplayName}
              </div>
              <div className="mt-0.5">
                <ParticipantStack
                  members={entry.panelMembers!}
                  onOpen={(id) => setOpenExecutionId(id)}
                />
              </div>
            </>
          ) : (
            <>
              <div className="truncate text-xs font-medium text-[var(--theme-text-secondary)]">{entry.executorName}</div>
              {entry.runByName ? (
                <div className="truncate text-[10px] text-[var(--theme-text-faint)]">by {entry.runByName}</div>
              ) : (
                entry.model && (
                  <div className="truncate text-[10px] text-[var(--theme-text-faint)]">
                    {entry.model}
                    {entry.effort ? ` · ${entry.effort} effort` : ''}
                    {entry.fast ? ' · ⚡ fast' : ''}
                  </div>
                )
              )}
            </>
          )}
        </div>

        {/* Col 4: Status */}
        <div className="w-[110px] flex-shrink-0 text-center">
          <StatusBadge status={entry.status} workflowSubStatus={entry.workflowSubStatus} />
        </div>

        {/* Col 5: Execution detail (tokens + cost) */}
        <div className="hidden w-[150px] flex-shrink-0 text-right text-[11px] tabular-nums text-[var(--theme-text-faint)] xl:block">
          {(entry.inputTokens != null || entry.outputTokens != null) ? (
            <div>
              {entry.inputTokens != null && <span>in: {formatTokens(entry.inputTokens)}</span>}
              {entry.inputTokens != null && entry.outputTokens != null && <span> · </span>}
              {entry.outputTokens != null && <span>out: {formatTokens(entry.outputTokens)}</span>}
            </div>
          ) : null}
          {entry.costUsd != null && entry.costUsd > 0 && (
            <div>${entry.costUsd.toFixed(2)}</div>
          )}
        </div>

        {/* Col 6: Duration */}
        <div
          className="w-[70px] flex-shrink-0 text-right tabular-nums"
          title={
            live
              ? `Started: ${formatFullDatetime(entry.startedAt)}`
              : entry.completedAt
                ? `Started: ${formatFullDatetime(entry.startedAt)}\nCompleted: ${formatFullDatetime(entry.completedAt)}`
                : `Started: ${formatFullDatetime(entry.startedAt)}`
          }
        >
          {live ? (
            <LiveDuration startedAt={entry.startedAt} />
          ) : entry.durationMs != null ? (
            <span className="font-mono text-xs text-[var(--theme-text-muted)]">{formatDuration(entry.durationMs)}</span>
          ) : null}
        </div>

        {/* Col 7: "X ago" */}
        <div
          className="w-[60px] flex-shrink-0 text-right text-xs tabular-nums text-[var(--theme-text-faint)]"
          title={formatFullDatetime(referenceTime)}
        >
          {relativeTime(referenceTime)}
        </div>

        {/* Cancel slot — fixed width, reserved on every row so columns
             align between live and history; only renders the button on live. */}
        <div className="flex w-[78px] flex-shrink-0 items-center justify-end">
          {live && (
            <button
              onClick={handleCancel}
              className={cn(
                'flex h-7 w-[78px] cursor-pointer items-center justify-center rounded-md border text-[10px] font-semibold shadow-sm transition-colors active:translate-y-px',
                cancelState === 'idle' && cn(tintClasses('red').borderColor, tintClasses('red').bg, tintText('red'), tintClasses('red').hoverBg),
                cancelState === 'confirming' && cn(tintClasses('red').borderColor, tintSolid('red'), tintClasses('red').onSolid),
                cancelState === 'cancelling' && cn('cursor-wait', tintClasses('red').borderColor, tintClasses('red').bg, tintText('red')),
              )}
              title={cancelState === 'idle' ? 'Cancel this execution' : ''}
            >
              {cancelState === 'idle' && 'Cancel'}
              {cancelState === 'confirming' && 'Confirm?'}
              {cancelState === 'cancelling' && 'Stopping…'}
            </button>
          )}
        </div>

        {/* Col 8: CTAs — comments / deliverables / ticket / execution log */}
        <div className="flex w-[188px] flex-shrink-0 items-center justify-end gap-1.5">
          {/* Comment CTA */}
          <button
            onClick={(e) => navigateToTicket(e, 'comments')}
            className="flex h-7 w-[48px] cursor-pointer items-center justify-center gap-1 rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] text-[11px] tabular-nums text-[var(--theme-text-secondary)] shadow-sm transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-primary)] active:translate-y-px"
            title={`${entry.commentCount} comments — open ticket`}
          >
            <CommentIcon />
            <span className="min-w-[12px] text-left">{entry.commentCount > 0 ? entry.commentCount : ''}</span>
          </button>

          {/* Deliverable CTA */}
          <button
            onClick={(e) => navigateToTicket(e, 'deliverables')}
            className="flex h-7 w-[48px] cursor-pointer items-center justify-center gap-1 rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] text-[11px] tabular-nums text-[var(--theme-text-secondary)] shadow-sm transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-primary)] active:translate-y-px"
            title={`${entry.deliverableCount} deliverables — open ticket`}
          >
            <DeliverableIcon />
            <span className="min-w-[12px] text-left">{entry.deliverableCount > 0 ? entry.deliverableCount : ''}</span>
          </button>

          {/* Ticket CTA — for workflow rows, land on the Workflow tab. */}
          <button
            onClick={(e) => navigateToTicket(e, isWorkflow ? 'workflow' : undefined)}
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] text-[var(--theme-text-secondary)] shadow-sm transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-primary)] active:translate-y-px"
            title={isWorkflow ? 'Open ticket — Workflow tab' : 'Open ticket'}
          >
            <TicketLinkIcon />
          </button>

          {/* Execution log CTA (open floating panel) — workflow runs are
              aggregates over multiple agent executions, so there's no single
              event timeline to surface; the Workflow tab on the ticket is
              the right entry point. */}
          {!isWorkflow && (
            <button
              onClick={(e) => { e.stopPropagation(); setOpenExecutionId(entry.id); }}
              className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] text-[var(--theme-text-secondary)] shadow-sm transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-primary)] active:translate-y-px"
              title="View execution log"
            >
              <ExecutionLogIcon />
            </button>
          )}
        </div>
      </div>

      {openExecutionId && (
        <FloatingExecutionPanel
          executionId={openExecutionId}
          title={
            openExecutionId === entry.id
              ? `${entry.executorName} — ${title}`
              : (entry.panelMembers?.find((m) => m.executionId === openExecutionId)?.displayName ?? 'Execution')
          }
          onClose={() => setOpenExecutionId(null)}
        />
      )}
    </>
  );
});
