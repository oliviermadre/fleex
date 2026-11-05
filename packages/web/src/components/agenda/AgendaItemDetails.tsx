import { AgendaEventActions } from './AgendaEventActions';
import { AgendaMeetingDetails } from './AgendaMeetingDetails';
import { AgendaEventLinks, AgendaMeetingLinks } from './AgendaMeetingLinks';
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { TICKET_TYPE_LABELS, type AgendaItem, type Ticket, type TicketDeliverable } from '@fleex/shared';
import * as api from '../../services/api';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Spinner';
import { DeliverableTypeBadge } from '../ui/DeliverableTypeBadge';
import { PrBadgeGroup } from '../ui/PrBadgeGroup';
import { FocusStatusBadge } from '../focus/FocusTicketLead';
import { PriorityIndicator, PRIORITY_LABELS } from '../tickets/PriorityIndicator';
import { ComplexityBadge, complexityDescription } from '../tickets/ComplexityBadge';
import { TicketTypeIconSvg } from '../tickets/TicketTypeIconSvg';
import { MeetJoinButton } from './AgendaMeetingDetails';
import { tintClasses } from '../../lib/tints';
import { ExternalLinkIcon, HandIcon, DocumentIcon, RepeatIcon } from '../ui/icons/AgendaIcons';
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

/** A read-only icon, explained on hover (the agenda shows, it does not edit). */
const Pic = ({ title, children }: { title: string; children: ReactNode }) => (
  <span className="inline-flex shrink-0 items-center" title={title} aria-label={title}>{children}</span>
);

/**
 * The ticket at a glance, in the card header: one row of inline icons, as in
 * the Tasks queue (status, priority, type, complexity, favorite, blocked),
 * then board, epics, tags, assignee, due date and PRs. No "label: value" grid.
 */
function TicketStrip({ item, ticket }: { item: AgendaItem; ticket: Load<Ticket> | null }) {
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
    <div className="space-y-1" data-testid="agenda-ticket-strip">
      <div className="flex flex-wrap items-center gap-1.5 text-[var(--theme-text-secondary)]">
        <FocusStatusBadge ticket={{ status }} />
        {t && <Pic title={`Priority: ${PRIORITY_LABELS[t.priority] ?? t.priority}`}><PriorityIndicator priority={t.priority} /></Pic>}
        {t?.type && <Pic title={`Type: ${TICKET_TYPE_LABELS[t.type]}`}><TicketTypeIconSvg type={t.type} size={14} /></Pic>}
        {t?.complexity && <Pic title={`Complexity: ${complexityDescription(t.complexity)}`}><ComplexityBadge complexity={t.complexity} /></Pic>}
        {t?.favorite && (
          <Pic title="Favorite">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" className={tintClasses('yellow').solidText} aria-hidden>
              <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
            </svg>
          </Pic>
        )}
        {t?.blocked && (
          <Pic title="Blocked">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" className={tintClasses('red').solidText} aria-hidden>
              <rect x="3" y="7" width="10" height="8" rx="1.5" />
              <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
            </svg>
          </Pic>
        )}
        {board && <Pic title="Board"><span className="text-[11px]">{board.emoji ? `${board.emoji} ` : ''}{board.name}</span></Pic>}
        {epics.map((e) => <Pic key={e} title="Epic"><Pill>{e}</Pill></Pic>)}
        {tags.map((tag) => <Pic key={tag} title="Tag"><Pill>#{tag}</Pill></Pic>)}
        {t?.assignee && <Pic title="Assignee"><span className="text-[11px]">@{t.assignee}</span></Pic>}
        {t?.dueDate && (
          <Pic title={overdue ? 'Due date (overdue)' : 'Due date'}>
            <span className={cn('text-[11px]', overdue && 'font-semibold text-[var(--tint-red-text)]')}>Due {fmtDate(t.dueDate)}</span>
          </Pic>
        )}
        {prs.length > 0 && <PrBadgeGroup prs={prs} density="card" />}
        {ticket?.state === 'loading' && <Spinner size={10} />}
      </div>
      {t && (
        <div className="text-[10.5px] text-[var(--theme-text-muted)]">Created {fmtDate(t.createdAt)} · updated {fmtDate(t.updatedAt)}</div>
      )}
      {ticket?.state === 'error' && <div className="text-[var(--tint-red-text)]">Could not load the ticket details.</div>}
    </div>
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

/** Free events: recurrence and description. Google meetings have <AgendaMeetingDetails/>. */
function CalendarMeta({ item }: { item: AgendaItem }) {
  const ev = item.event;
  if (!ev || (!ev.recurrence && !ev.description)) return null;
  return (
    <Section title="Event">
      {ev.recurrence && (
        <div className="grid grid-cols-[84px_1fr] items-center gap-x-2 gap-y-1">
          <Field label="Repeats">{ev.recurrence}{ev.recurrenceUntil ? ` until ${fmtDate(ev.recurrenceUntil)}` : ''}</Field>
        </div>
      )}
      {ev.description && <div className="whitespace-pre-wrap text-[var(--theme-text-secondary)]">{ev.description}</div>}
      {ev.recurrence && (
        <div className="flex items-center gap-1 text-[var(--theme-text-muted)]">
          <RepeatIcon size={11} /> Edits and deletion apply to the whole series.
        </div>
      )}
      {/* The attached deliverables are listed by <AgendaEventLinks/>. */}
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

  const ticket = useLoad(ticketId, () => api.fetchAgendaTicket(ticketId!));
  const ticketDelivs = useLoad(ticketId && `${ticketId}:d`, () => api.fetchAgendaTicketDeliverables(ticketId!));
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
  const meetUrl = item.type === 'external' && item.external?.meetUrl && item.external.rsvp !== 'declined'
    && (!item.end || new Date(item.end) > now) ? item.external.meetUrl : null;

  // Footer: one primary action (the most likely next step), the rest secondary.
  const primary = meetUrl ? 'meet' : item.ticket ? 'ticket' : item.routine ? 'routine' : item.type === 'event' ? 'event' : 'external';
  const v = (key: typeof primary) => (primary === key ? 'primary' : 'secondary') as 'primary' | 'secondary';

  return (
    <div className="flex max-h-[min(75vh,620px)] w-[380px] flex-col text-xs" data-testid="agenda-card">
      {/* Header: always visible. Title, when, and the ticket at a glance. */}
      <div className="shrink-0 space-y-1.5 border-b border-[var(--theme-border)] p-3 pb-2" data-testid="agenda-card-header">
        <div className="flex items-start gap-2">
          <LabelIcon type={item.type} overdue={item.overdue} item={item} size={18} className="mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold leading-5 text-[var(--theme-text-primary)]">
              {item.ticket && item.type !== 'pr.merged' ? <span className="mr-1 tabular-nums text-[var(--theme-text-muted)]">#{item.ticket.displayId}</span> : null}
              {item.title}
            </div>
            <div className="text-[var(--theme-text-muted)]">
              {label.label}
              {item.routine ? ` · ${item.routine.name}` : ''}
              {' · '}
              <span className="text-[var(--theme-text-secondary)]">{whenLine(item, now)}</span>
            </div>
          </div>
        </div>
        {item.ticket && <TicketStrip item={item} ticket={ticket} />}
      </div>

      {/* Body: scrolls. Order: the item's own notes, the run, every deliverable, then meeting / event parts. */}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2 empty:hidden" data-testid="agenda-card-body">
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
        <DeliverableList load={ticketDelivs} title="Ticket deliverables" exclude={runIds} onClose={onClose} />
        <CalendarMeta item={item} />
        {item.type === 'external' && <AgendaMeetingDetails item={item} />}
        {item.type === 'event' && <AgendaEventLinks item={item} onClose={onClose} />}
        {item.type === 'external' && <AgendaMeetingLinks item={item} onClose={onClose} />}
      </div>

      {/* Footer: always visible. Every action looks the same: Fleex buttons, one primary. */}
      <div className="flex shrink-0 flex-wrap gap-2 border-t border-[var(--theme-border)] px-3 py-2 empty:hidden" data-testid="agenda-card-footer">
        {meetUrl && <MeetJoinButton url={meetUrl} variant={v('meet')} />}
        {item.ticket && <Button size="sm" variant={v('ticket')} onClick={openTicket}>Open ticket</Button>}
        {item.routine && <Button size="sm" variant={v('routine')} onClick={openRoutine}>Open routine</Button>}
        {item.type === 'event' && <AgendaEventActions item={item} onClose={onClose} primary={primary === 'event'} />}
        {externalUrl && (
          <Button size="sm" variant={v('external')} className="gap-1" onClick={() => window.open(externalUrl, '_blank', 'noopener')}>
            {item.prRef ? 'Open on GitHub' : 'Open in Google Calendar'}
            <ExternalLinkIcon size={12} />
          </Button>
        )}
      </div>
    </div>
  );
}
