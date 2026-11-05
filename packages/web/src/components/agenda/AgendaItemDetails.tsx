import { AgendaEventActions } from './AgendaEventActions';
import { AgendaMeetingLinks } from './AgendaMeetingLinks';
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AgendaItem, Ticket, TicketDeliverable } from '@fleex/shared';
import * as api from '../../services/api';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Spinner';
import { DeliverableTypeBadge } from '../ui/DeliverableTypeBadge';
import { PrBadgeGroup } from '../ui/PrBadgeGroup';
import { FocusStatusBadge } from '../focus/FocusTicketLead';
import { PriorityIndicator, PRIORITY_LABELS } from '../tickets/PriorityIndicator';
import { ComplexityBadge } from '../tickets/ComplexityBadge';
import { ExternalLinkIcon, HandIcon, DocumentIcon } from '../ui/icons/AgendaIcons';
import { useRoutineStore } from '../../stores/routineStore';
import { useTicketStore } from '../../stores/ticketStore';
import { useAgendaStore } from '../../stores/agendaStore';
import { useUIStore } from '../../stores/uiStore';
import { linkedPrs } from '../../lib/prRef';
import { cn } from '../../lib/cn';
import { LABEL_BY_TYPE, statusHue, dotStyle, hatchStyle } from './agendaLabels';
import { LabelIcon, WaitIcon } from './AgendaChip';
import { dayKey, formatDuration, openWait, workflowShortName } from './agendaLayout';

const fmtTime = (d: Date) => d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const fmtDay = (d: Date) => d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const fmtDate = (iso: string) => {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00`) : new Date(iso);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

function whenLine(item: AgendaItem, now: Date): string {
  if (item.shape === 'allDay') {
    const [y, m, d] = item.start.split('-').map(Number) as [number, number, number];
    return `${fmtDay(new Date(y, m - 1, d))} · all day`;
  }
  const start = new Date(item.start);
  if (item.shape === 'point') return `${fmtDay(start)} · ${fmtTime(start)}`;
  const end = item.end ? new Date(item.end) : null;
  const sameDay = end && end.toDateString() === start.toDateString();
  const endTxt = end ? (sameDay ? fmtTime(end) : `${fmtDay(end)} ${fmtTime(end)}`) : 'now';
  return `${fmtDay(start)} ${fmtTime(start)} - ${endTxt} · ${formatDuration((end ?? now).getTime() - start.getTime())}${end ? '' : ' so far'}`;
}

type Load<T> = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ok'; data: T };

/**
 * Fetch on open. The call goes through `Promise.resolve().then` so that a
 * synchronous throw (a test double without this function) becomes an error
 * state instead of a crash.
 */
function useLoad<T>(key: string | null, load: () => Promise<T>): Load<T> | null {
  const [res, setRes] = useState<Load<T> | null>(key ? { state: 'loading' } : null);
  useEffect(() => {
    if (!key) {
      setRes(null);
      return;
    }
    let live = true;
    setRes({ state: 'loading' });
    Promise.resolve()
      .then(load)
      .then((data) => live && setRes({ state: 'ok', data }))
      .catch((e: unknown) => live && setRes({ state: 'error', message: e instanceof Error ? e.message : String(e) }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return res;
}

function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="space-y-1 border-t border-[var(--theme-border)] pt-2">
      <div className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--theme-text-muted)]">
        <span className="flex-1">{title}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

/** One "label: value" line of the metadata grid. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <span className="text-[var(--theme-text-muted)]">{label}</span>
      <span className="flex min-w-0 flex-wrap items-center gap-1 text-[var(--theme-text-secondary)]">{children}</span>
    </>
  );
}

const Pill = ({ children }: { children: ReactNode }) => (
  <span className="rounded border border-[var(--theme-border)] bg-[var(--theme-bg-overlay)] px-1.5 text-[10.5px] text-[var(--theme-text-secondary)]">{children}</span>
);

/** Deliverables, each opening the reading overlay. */
function DeliverableList({ load, title, exclude, onClose, hideWhenEmpty }: {
  load: Load<TicketDeliverable[]> | null;
  title: string;
  exclude?: Set<string>;
  onClose: () => void;
  /** A run without deliverables (or a server without the endpoint) shows nothing. */
  hideWhenEmpty?: boolean;
}) {
  if (!load) return null;
  if (load.state === 'loading') {
    return (
      <Section title={title}>
        <div className="flex items-center gap-1.5 text-[var(--theme-text-muted)]"><Spinner size={11} /> Loading deliverables</div>
      </Section>
    );
  }
  if (load.state === 'error') {
    if (hideWhenEmpty) return null;
    return (
      <Section title={title}>
        <div className="text-[var(--tint-red-text)]">Could not load the deliverables.</div>
      </Section>
    );
  }
  const list = load.data.filter((d) => !exclude?.has(d.id));
  if (!list.length) {
    if (hideWhenEmpty) return null;
    return (
      <Section title={title}>
        <div className="text-[var(--theme-text-muted)]">No deliverable yet.</div>
      </Section>
    );
  }
  return (
    <Section title={title} right={<span className="tabular-nums">{list.length}</span>}>
      <ul className="space-y-0.5">
        {list.map((d) => (
          <li key={d.id}>
            <button
              type="button"
              onClick={() => {
                onClose();
                useUIStore.getState().openDeliverableOverlay(d);
              }}
              className="flex w-full min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-[var(--theme-bg-overlay)]"
              title={d.title}
            >
              <DocumentIcon size={12} className="shrink-0 text-[var(--theme-text-muted)]" />
              <span className="min-w-0 flex-1 truncate text-[var(--theme-text-primary)]">{d.title}</span>
              <DeliverableTypeBadge type={d.type} />
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** Everything about the item's ticket: status, priority, board, epics, dates, PRs. */
function TicketMeta({ item, ticket }: { item: AgendaItem; ticket: Load<Ticket> | null }) {
  const ref = item.ticket!;
  const boards = useTicketStore((s) => s.boards);
  const agendaEpics = useAgendaStore((s) => s.data?.epics);
  const t = ticket?.state === 'ok' ? ticket.data : null;
  const board = boards.find((b) => b.id === (t?.boardId ?? ref.boardId));
  const status = (t?.status ?? ref.status) as Ticket['status'];
  const epics = t?.epics?.map((e) => `${e.emoji ? `${e.emoji} ` : ''}${e.name}`)
    ?? (ref.epicIds ?? []).map((id) => agendaEpics?.find((e) => e.id === id)?.name).filter((n): n is string => !!n);
  const tags = t?.tags ?? ref.tags;
  const overdue = !!t?.dueDate && t.status !== 'done' && t.status !== 'cancelled' && t.dueDate.slice(0, 10) < dayKey(new Date());
  const prs = t ? linkedPrs(t.links) : [];

  return (
    <Section title="Ticket" right={ticket?.state === 'loading' ? <Spinner size={10} /> : null}>
      <div className="grid grid-cols-[84px_1fr] items-center gap-x-2 gap-y-1">
        <Field label="Status"><FocusStatusBadge ticket={{ status }} /></Field>
        {t && (
          <Field label="Priority">
            <PriorityIndicator priority={t.priority} />
            {PRIORITY_LABELS[t.priority] ?? t.priority}
          </Field>
        )}
        {t?.complexity && <Field label="Complexity"><ComplexityBadge complexity={t.complexity} /></Field>}
        {board && <Field label="Board">{board.emoji ? `${board.emoji} ` : ''}{board.name}</Field>}
        {epics.length > 0 && <Field label={epics.length > 1 ? 'Epics' : 'Epic'}>{epics.map((e) => <Pill key={e}>{e}</Pill>)}</Field>}
        {tags.length > 0 && <Field label="Tags">{tags.map((tag) => <Pill key={tag}>{tag}</Pill>)}</Field>}
        {t?.assignee && <Field label="Assignee">{t.assignee}</Field>}
        {t?.dueDate && (
          <Field label="Due">
            <span className={cn(overdue && 'font-semibold text-[var(--tint-red-text)]')}>{fmtDate(t.dueDate)}{overdue ? ' (overdue)' : ''}</span>
          </Field>
        )}
        {t && <Field label="Created">{fmtDate(t.createdAt)}</Field>}
        {t && <Field label="Updated">{fmtDate(t.updatedAt)}</Field>}
        {prs.length > 0 && <Field label="Pull requests"><PrBadgeGroup prs={prs} density="card" /></Field>}
      </div>
      {ticket?.state === 'error' && <div className="text-[var(--tint-red-text)]">Could not load the ticket details.</div>}
    </Section>
  );
}

/** Status, trigger, step, duration and the human-wait breakdown of a run. */
function RunMeta({ item, now }: { item: AgendaItem; now: Date }) {
  const segs = item.segments ?? [];
  const total = item.shape === 'block' ? (item.end ? new Date(item.end) : now).getTime() - new Date(item.start).getTime() : 0;
  const waitMs = (kind: 'gate' | 'question') =>
    segs.filter((s) => s.kind === kind).reduce((a, s) => a + ((s.end ? new Date(s.end) : now).getTime() - new Date(s.start).getTime()), 0);
  const wait = openWait(item);
  const manual = !!item.triggeredFrom && item.triggeredFrom !== 'schedule';

  return (
    <Section title={item.type === 'workflow.run' ? 'Workflow run' : 'Run'}>
      <div className="grid grid-cols-[84px_1fr] items-center gap-x-2 gap-y-1">
        {item.status && (
          <Field label="Status">
            <span className={cn('h-2 w-2 rounded-full', item.status === 'running' && 'animate-pulse')} style={dotStyle(statusHue(item.status))} />
            {item.status.replace('_', ' ')}
          </Field>
        )}
        {item.workflowName && <Field label="Workflow"><b>{workflowShortName(item.workflowName)}</b></Field>}
        {item.type === 'routine.run' && (
          <Field label="Trigger">
            {manual ? <><HandIcon size={12} /> Launched manually</> : 'Schedule'}
          </Field>
        )}
        {item.type === 'workflow.run' && item.triggeredFrom && <Field label="Trigger">{item.triggeredFrom}</Field>}
        {(wait || item.currentStep) && (
          <Field label="Step">
            {wait ? (
              <span className={wait.kind === 'gate' ? 'text-[var(--tint-yellow-text)]' : undefined}>
                <WaitIcon kind={wait.kind} size={11} className="mr-1 align-[-1px]" />
                {wait.kind === 'gate' ? 'waiting at' : 'agent question in'} {wait.stepName} for {formatDuration(now.getTime() - new Date(wait.start).getTime())}
              </span>
            ) : item.currentStep}
          </Field>
        )}
        {total > 0 && <Field label="Duration">{formatDuration(total)}{item.end ? '' : ' so far'}</Field>}
      </div>
      {segs.length > 0 && total > 0 && (
        <>
          <div className="grid grid-cols-[auto_1fr] gap-x-3 pt-1 text-[var(--theme-text-secondary)]">
            <span>Agents working</span><span>{formatDuration(total - waitMs('gate') - waitMs('question'))}</span>
            <span>Waiting at gates</span><span>{formatDuration(waitMs('gate'))} ({Math.round((waitMs('gate') / total) * 100)} %)</span>
            <span>Waiting on questions</span><span>{formatDuration(waitMs('question'))} ({Math.round((waitMs('question') / total) * 100)} %)</span>
          </div>
          <div className="max-h-28 space-y-0.5 overflow-y-auto">
            {segs.map((s, i) => (
              <div key={i} className="flex items-center gap-1.5 text-[var(--theme-text-muted)]">
                <span className="inline-block h-2.5 w-3 rounded-sm" style={hatchStyle(s.kind)} />
                {s.stepName} · {fmtTime(new Date(s.start))} - {s.end ? fmtTime(new Date(s.end)) : 'now'}
              </div>
            ))}
          </div>
        </>
      )}
    </Section>
  );
}

/** Free events and Google meetings: the basics, for now. */
function CalendarMeta({ item }: { item: AgendaItem }) {
  const ev = item.event;
  const ext = item.external;
  if (!ev && !ext) return null;
  return (
    <Section title={item.type === 'external' ? 'Google Calendar' : 'Event'}>
      <div className="grid grid-cols-[84px_1fr] items-center gap-x-2 gap-y-1">
        {ev?.recurrence && <Field label="Repeats">{ev.recurrence}{ev.recurrenceUntil ? ` until ${fmtDate(ev.recurrenceUntil)}` : ''}</Field>}
        {ext?.location && <Field label="Location">{ext.location}</Field>}
        {ext && ext.attendees > 0 && <Field label="Attendees">{ext.attendees}</Field>}
      </div>
      {ev?.description && <div className="whitespace-pre-wrap text-[var(--theme-text-secondary)]">{ev.description}</div>}
      {ext && ext.links.length > 0 && (
        <ul className="space-y-0.5">
          {ext.links.map((l) => (
            <li key={l.id} className="flex items-center gap-1.5 text-[var(--theme-text-secondary)]">
              <DocumentIcon size={12} className="shrink-0 text-[var(--theme-text-muted)]" />
              <span className="truncate">{l.deliverableTitle}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/**
 * What a click on an agenda item shows: a rich card with the ticket's
 * metadata and the deliverables of the ticket or of the run. The agenda only
 * shows and redirects: decisions, retries and launches happen on the ticket or
 * the routine.
 */
export function AgendaItemDetails({ item, now, onClose }: { item: AgendaItem; now: Date; onClose: () => void }) {
  const navigate = useNavigate();
  const selectRoutine = useRoutineStore((s) => s.select);
  const label = LABEL_BY_TYPE[item.type];
  const ticketId = item.ticket?.id ?? null;
  const isRun = item.type === 'routine.run' || item.type === 'workflow.run';
  const runId = isRun ? item.runId ?? null : null;

  const ticket = useLoad(ticketId, () => api.fetchTicket(ticketId!));
  const ticketDelivs = useLoad(ticketId && `${ticketId}:d`, () => api.fetchTicketDeliverables(ticketId!));
  const runDelivs = useLoad(runId, () => api.fetchAgendaRunDeliverables(runId!));
  const runIds = new Set(runDelivs?.state === 'ok' ? runDelivs.data.map((d) => d.id) : []);

  const openTicket = () => {
    if (!item.ticket) return;
    onClose();
    navigate(`/work/${item.ticket.id}`);
  };
  const openRoutine = () => {
    if (!item.routine) return;
    onClose();
    void selectRoutine(item.routine.id);
    navigate('/routines');
  };
  const externalUrl = item.prRef
    ? (() => { const [repo, num] = item.prRef.split('#'); return `https://github.com/${repo}/pull/${num}`; })()
    : item.external?.htmlLink ?? null;

  return (
    <div className="max-h-[min(70vh,560px)] w-[380px] space-y-2 overflow-y-auto p-3 text-xs">
      <div className="flex items-start gap-2">
        <LabelIcon type={item.type} overdue={item.overdue} size={18} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold leading-5 text-[var(--theme-text-primary)]">
            {item.ticket && item.type !== 'pr.merged' ? <span className="mr-1 tabular-nums text-[var(--theme-text-muted)]">#{item.ticket.displayId}</span> : null}
            {item.title}
          </div>
          <div className="text-[var(--theme-text-muted)]">
            {label.label}
            {item.routine ? ` · ${item.routine.name}` : ''}
          </div>
        </div>
      </div>

      <div className="text-[var(--theme-text-secondary)]">{whenLine(item, now)}</div>

      {item.type === 'routine.upcoming' && item.cron && (
        <div className="text-[var(--theme-text-muted)]">cron <code>{item.cron}</code>{item.timezone ? ` · ${item.timezone}` : ''}</div>
      )}
      {item.type === 'routine.skipped' && (
        <div className="text-[var(--theme-text-muted)]">Skipped: the previous run was still running (overlap).</div>
      )}
      {item.type === 'routine.missed' && (
        <div className="text-[var(--theme-text-muted)]">
          Missed: {item.missedReason === 'scheduler_down' ? 'the scheduler was not running at that time.' : 'this slot never ran.'}
        </div>
      )}
      {item.type === 'ticket.due' && item.overdue && (
        <div className="text-[var(--tint-red-text)]">Overdue: the ticket is still {item.ticket?.status}</div>
      )}
      {item.type === 'pr.merged' && item.prRef && (
        <div className="text-[var(--theme-text-muted)]">{item.prRef}</div>
      )}

      {isRun && <RunMeta item={item} now={now} />}
      <DeliverableList load={runDelivs} title="Deliverables of this run" onClose={onClose} hideWhenEmpty />
      {item.ticket && <TicketMeta item={item} ticket={ticket} />}
      <DeliverableList load={ticketDelivs} title="Ticket deliverables" exclude={runIds} onClose={onClose} />
      <CalendarMeta item={item} />
      {item.type === 'event' && <AgendaEventActions item={item} onClose={onClose} />}
      {item.type === 'external' && <AgendaMeetingLinks item={item} onClose={onClose} />}

      <div className="flex flex-wrap gap-2 border-t border-[var(--theme-border)] pt-2">
        {item.ticket && <Button size="sm" variant="primary" onClick={openTicket}>Open ticket</Button>}
        {item.routine && <Button size="sm" variant={item.ticket ? 'secondary' : 'primary'} onClick={openRoutine}>Open routine</Button>}
        {externalUrl && (
          <Button
            size="sm"
            className="inline-flex items-center gap-1"
            onClick={() => window.open(externalUrl, '_blank', 'noopener')}
          >
            {item.prRef ? 'Open on GitHub' : 'Open in Google Calendar'}
            <ExternalLinkIcon size={12} />
          </Button>
        )}
      </div>
    </div>
  );
}
