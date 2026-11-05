import type {
  AgendaItem,
  AgendaResponse,
  AgendaRoutineRef,
  AgendaTicketRef,
  AgendaWaitSegment,
} from '@fleex/shared';
import type { TicketEntity } from '../../domain/entities/ticket.entity.js';
import type { RoutineEntity } from '../../domain/entities/routine.entity.js';
import type { WorkflowRunEntity } from '../../domain/entities/workflow-run.entity.js';
import type { DomainEventLogEntity } from '../../domain/entities/domain-event-log.entity.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import type { RoutineStorePort } from '../ports/routine-store.port.js';
import type { WorkflowRunStorePort } from '../ports/workflow-run-store.port.js';
import type { DomainEventLogStorePort } from '../ports/domain-event-log-store.port.js';
import { runTimesBetween } from '../../domain/services/routine-schedule.js';

/** Upcoming occurrences per routine and per request — a `*​/5` routine is ~2 000 slots a week. */
export const UPCOMING_CAP = 500;
/** Longest window the endpoint serves: six weeks plus a DST hour of slack. */
export const MAX_WINDOW_MS = 43 * 24 * 3600_000;

const EVENT_FETCH_LIMIT = 50_000;
const ACTIVE_RUN = new Set(['running', 'needs_review', 'blocked']);
/** Events after which a run is no longer waiting on the step that asked. */
const RESUME_EVENTS = new Set([
  'workflow.step_started',
  'workflow.step_completed',
  'workflow.step_cancelled',
  'workflow.run_completed',
  'workflow.run_failed',
  'workflow.run_cancelled',
]);

export interface AgendaSources {
  tickets: TicketEntity[];
  routines: RoutineEntity[];
  /** Any runs — the builder keeps the ones that overlap the window. */
  runs: WorkflowRunEntity[];
  /** Domain events (`ticket.moved`, `pr.merged`, `routine.run_skipped`, `workflow.*`). */
  events: DomainEventLogEntity[];
}

export interface AgendaWindow {
  from: Date;
  to: Date;
  now: Date;
}

const iso = (d: Date) => d.toISOString();
const inWindow = (t: number, w: AgendaWindow) => t >= w.from.getTime() && t < w.to.getTime();
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function ticketRef(t: TicketEntity): AgendaTicketRef {
  return { id: t.id, displayId: t.displayId, title: t.title, boardId: t.boardId, status: t.status, tags: t.tags };
}

function routineRef(r: RoutineEntity): AgendaRoutineRef {
  return { id: r.id, name: r.name, emoji: r.emoji };
}

/** 'YYYY-MM-DD' of a stored due date (kept as a calendar day, no time zone). */
function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * The stretches a run spent waiting on a human, read from the audit log:
 * `workflow.needs_review` opens a wait, the run's next step / run event closes
 * it. A `human_gate` step is a gate; any other step that parked the run is an
 * agent question (`waiting_for_info`).
 */
export function waitSegments(run: WorkflowRunEntity, runEvents: DomainEventLogEntity[], now: Date): AgendaWaitSegment[] {
  const steps = new Map(run.templateSnapshot.steps.map((s) => [s.id, s]));
  const sorted = [...runEvents].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const out: AgendaWaitSegment[] = [];
  let open: { stepId: string; start: Date; kind: 'gate' | 'question' } | null = null;
  const close = (end: Date | null) => {
    if (!open) return;
    const step = steps.get(open.stepId);
    out.push({ kind: open.kind, stepName: step?.name ?? open.stepId, start: iso(open.start), end: end ? iso(end) : null });
    open = null;
  };
  for (const e of sorted) {
    if (e.eventType === 'workflow.needs_review' || e.eventType === 'workflow.awaiting_routing') {
      close(e.occurredAt);
      const stepId = str(e.payload['stepId']) ?? '';
      const kind = e.eventType === 'workflow.awaiting_routing' || steps.get(stepId)?.executorType === 'human_gate' ? 'gate' : 'question';
      open = { stepId, start: e.occurredAt, kind };
    } else if (open && RESUME_EVENTS.has(e.eventType)) {
      close(e.occurredAt);
    }
  }
  if (open) close(ACTIVE_RUN.has(run.status) ? null : (run.completedAt ?? now));
  return out;
}

export function buildAgenda(src: AgendaSources, w: AgendaWindow): AgendaResponse {
  const items: AgendaItem[] = [];
  const truncated: string[] = [];
  const ticketsById = new Map(src.tickets.map((t) => [t.id, t]));
  const routinesById = new Map(src.routines.map((r) => [r.id, r]));
  const today = dayKey(w.now);

  // ── Tickets: T1 created, T4 due ──
  for (const t of src.tickets) {
    if (inWindow(t.createdAt.getTime(), w)) {
      items.push({ id: `ticket.created:${t.id}`, type: 'ticket.created', shape: 'point', start: iso(t.createdAt), title: t.title, ticket: ticketRef(t) });
    }
    if (t.dueDate) {
      const day = dayKey(t.dueDate);
      // A calendar day is in the window when its noon UTC is — robust to the
      // client's midnight-local bounds on either side of UTC.
      const noon = Date.parse(`${day}T12:00:00Z`);
      if (noon >= w.from.getTime() - 12 * 3600_000 && noon < w.to.getTime() + 12 * 3600_000) {
        items.push({
          id: `ticket.due:${t.id}`, type: 'ticket.due', shape: 'allDay', start: day, title: t.title, ticket: ticketRef(t),
          overdue: day < today && t.status !== 'done',
        });
      }
    }
  }

  // ── T2 done: the `ticket.moved → done` event, else `statusChangedAt` ──
  // Some paths move a ticket to done without emitting `ticket.moved`; a ticket
  // that is done now and changed status inside the window still counts.
  const doneAt = new Map<string, Date>();
  for (const e of src.events) {
    if (e.eventType !== 'ticket.moved' || e.payload['toStatus'] !== 'done') continue;
    const id = str(e.payload['ticketId']);
    if (!id || !inWindow(e.occurredAt.getTime(), w)) continue;
    const prev = doneAt.get(id);
    if (!prev || prev < e.occurredAt) doneAt.set(id, e.occurredAt);
  }
  for (const t of src.tickets) {
    if (t.status === 'done' && !doneAt.has(t.id) && inWindow(t.statusChangedAt.getTime(), w)) doneAt.set(t.id, t.statusChangedAt);
  }
  for (const [id, at] of doneAt) {
    const t = ticketsById.get(id);
    if (!t) continue;
    items.push({ id: `ticket.done:${id}`, type: 'ticket.done', shape: 'point', start: iso(at), title: t.title, ticket: ticketRef(t) });
  }

  // ── Runs overlapping the window: R1 (routine) and W1 (ticket) ──
  const eventsByRun = new Map<string, DomainEventLogEntity[]>();
  for (const e of src.events) {
    if (!e.eventType.startsWith('workflow.')) continue;
    const runId = str(e.payload['workflowRunId']);
    if (!runId) continue;
    const list = eventsByRun.get(runId);
    if (list) list.push(e);
    else eventsByRun.set(runId, [e]);
  }
  for (const run of src.runs) {
    const start = run.startedAt.getTime();
    const end = run.completedAt ? run.completedAt.getTime() : w.now.getTime();
    const overlaps = start < w.to.getTime() && (end >= w.from.getTime() || !run.completedAt);
    if (!overlaps) continue;
    const base = {
      shape: 'block' as const,
      start: iso(run.startedAt),
      end: run.completedAt ? iso(run.completedAt) : null,
      status: run.status,
      runId: run.id,
    };
    if (run.routineId) {
      const r = routinesById.get(run.routineId);
      items.push({
        ...base, id: `routine.run:${run.id}`, type: 'routine.run',
        title: r?.name ?? run.templateSnapshot.name,
        routine: r ? routineRef(r) : { id: run.routineId, name: run.templateSnapshot.name, emoji: run.templateSnapshot.emoji },
        triggeredFrom: run.triggeredFrom,
      });
    } else if (run.ticketId) {
      const t = ticketsById.get(run.ticketId);
      if (!t) continue; // archived / deleted ticket — nothing to open
      const current = run.currentStepId ? run.templateSnapshot.steps.find((s) => s.id === run.currentStepId) : undefined;
      items.push({
        ...base, id: `workflow.run:${run.id}`, type: 'workflow.run',
        title: t.title, ticket: ticketRef(t),
        workflowName: run.templateSnapshot.name,
        currentStep: ACTIVE_RUN.has(run.status) ? (current?.name ?? null) : null,
        segments: waitSegments(run, eventsByRun.get(run.id) ?? [], w.now),
      });
    }
  }

  // ── R2 upcoming: the scheduler's own parser, from max(from, now) ──
  const upFrom = new Date(Math.max(w.from.getTime(), w.now.getTime()));
  for (const r of src.routines) {
    if (!r.enabled || r.trigger.kind === 'manual') continue;
    let res: { times: Date[]; truncated: boolean };
    try {
      res = runTimesBetween(r.trigger, upFrom, w.to, UPCOMING_CAP);
    } catch {
      continue; // an invalid trigger is reported on /routines, not here
    }
    if (res.truncated) truncated.push(r.id);
    const tz = r.trigger.kind === 'cron' ? r.trigger.timezone : null;
    const cron = r.trigger.kind === 'cron' ? r.trigger.cron : null;
    for (const t of res.times) {
      items.push({
        id: `routine.upcoming:${r.id}:${iso(t)}`, type: 'routine.upcoming', shape: 'point', start: iso(t),
        title: r.name, routine: routineRef(r), cron, timezone: tz,
      });
    }
  }

  // ── R3 skipped (overlap) and P2 merged PRs, from the audit log ──
  const ticketByPr = new Map<string, TicketEntity>();
  for (const t of src.tickets) {
    for (const l of t.links) if (l.type === 'github_pr') ticketByPr.set(l.ref.toLowerCase(), t);
  }
  for (const e of src.events) {
    if (!inWindow(e.occurredAt.getTime(), w)) continue;
    if (e.eventType === 'routine.run_skipped') {
      const rid = str(e.payload['routineId']);
      const r = rid ? routinesById.get(rid) : undefined;
      if (!r) continue;
      items.push({
        id: `routine.skipped:${e.id}`, type: 'routine.skipped', shape: 'point', start: iso(e.occurredAt),
        title: r.name, routine: routineRef(r), runId: str(e.payload['activeRunId']),
      });
    } else if (e.eventType === 'pr.merged') {
      const ref = str(e.payload['ref']);
      if (!ref) continue;
      const t = ticketByPr.get(ref.toLowerCase());
      items.push({
        id: `pr.merged:${e.id}`, type: 'pr.merged', shape: 'point', start: iso(e.occurredAt),
        title: ref, prRef: ref, ticket: t ? ticketRef(t) : null,
      });
    }
  }

  items.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.id < b.id ? -1 : 1));
  return {
    from: iso(w.from),
    to: iso(w.to),
    generatedAt: iso(w.now),
    items,
    routines: src.routines.map(routineRef).sort((a, b) => a.name.localeCompare(b.name)),
    truncated,
  };
}

/**
 * GET /api/agenda — reads every source in parallel, then {@link buildAgenda}.
 * Runs come from `getAll()` filtered in memory, like the statistics use case;
 * events are read once per family with the window (widened back to the oldest
 * overlapping run, so a wait that began before `from` is still bounded).
 */
export class GetAgendaUseCase {
  constructor(
    private readonly ticketStore: TicketStorePort,
    private readonly routineStore: RoutineStorePort | null,
    private readonly runStore: WorkflowRunStorePort | null,
    private readonly eventLog: DomainEventLogStorePort | null,
  ) {}

  async execute(w: AgendaWindow): Promise<AgendaResponse> {
    const [tickets, routines, allRuns] = await Promise.all([
      this.ticketStore.getAllTickets(),
      this.routineStore ? this.routineStore.getAll() : Promise.resolve([]),
      this.runStore ? this.runStore.getAll() : Promise.resolve([]),
    ]);
    const runs = allRuns.filter((r) => {
      const end = r.completedAt ? r.completedAt.getTime() : Infinity;
      return r.startedAt.getTime() < w.to.getTime() && end >= w.from.getTime();
    });
    const since = new Date(Math.min(w.from.getTime(), ...runs.map((r) => r.startedAt.getTime())));
    const read = (eventType: string, from: Date) =>
      this.eventLog ? this.eventLog.list({ limit: EVENT_FETCH_LIMIT, eventType, since: from, until: w.to }) : Promise.resolve([]);
    const families = await Promise.all([
      read('ticket.moved', w.from),
      read('pr.merged', w.from),
      read('routine.run_skipped', w.from),
      runs.length ? read('workflow.', since) : Promise.resolve([]),
    ]);
    return buildAgenda({ tickets, routines, runs, events: families.flat() }, w);
  }
}
