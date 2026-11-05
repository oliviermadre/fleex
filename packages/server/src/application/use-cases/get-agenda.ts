import type {
  AgendaExternalLink,
  AgendaItem,
  AgendaResponse,
  AgendaRoutineRef,
  AgendaTicketRef,
  AgendaWaitSegment,
  CalendarEvent,
  TicketGroupMembership,
} from '@fleex/shared';
import type { TicketEntity } from '../../domain/entities/ticket.entity.js';
import type { RoutineEntity } from '../../domain/entities/routine.entity.js';
import type { WorkflowRunEntity } from '../../domain/entities/workflow-run.entity.js';
import type { DomainEventLogEntity } from '../../domain/entities/domain-event-log.entity.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import type { RoutineStorePort } from '../ports/routine-store.port.js';
import type { WorkflowRunStorePort } from '../ports/workflow-run-store.port.js';
import type { DomainEventLogStorePort } from '../ports/domain-event-log-store.port.js';
import type { TicketGroupStorePort } from '../ports/ticket-group-store.port.js';
import type { KvStorePort } from '../ports/kv-store.port.js';
import { runTimesBetween } from '../../domain/services/routine-schedule.js';
import { expandCalendarEvent, listCalendarEvents, EVENT_OCCURRENCE_CAP } from './calendar-events.js';
import { calendarEventItemId, calendarEventLinkKey } from '@fleex/shared';
import { listMissedSlots, type StoredMissedSlot } from '../services/missed-slots.js';

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
  /** Ticket ↔ epic memberships — fills `AgendaTicketRef.epicIds`. */
  memberships?: TicketGroupMembership[];
  /** Every epic, for the sidebar filter. */
  epics?: { id: string; name: string }[];
  /** E1 free events (series; the builder expands recurrences). */
  calendarEvents?: CalendarEvent[];
  /** Deliverables attached to free events, by link key (`calendarEventLinkKey`). */
  eventLinks?: Map<string, AgendaExternalLink[]>;
  /** R3 slots the scheduler never fired. */
  missedSlots?: StoredMissedSlot[];
  /** Items from an external source (Google), already shaped. */
  externalItems?: AgendaItem[];
}

/**
 * A calendar outside Fleex (Google…). Implemented elsewhere; a rejection is
 * reported in `errors.external` and the rest of the agenda is still served.
 */
export interface AgendaExternalSource {
  list(from: Date, to: Date, calendarIds: string[]): Promise<AgendaItem[]>;
}

export interface AgendaWindow {
  from: Date;
  to: Date;
  now: Date;
}

const iso = (d: Date) => d.toISOString();
const inWindow = (t: number, w: AgendaWindow) => t >= w.from.getTime() && t < w.to.getTime();
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function makeTicketRef(epicIdsByTicket: Map<string, string[]>) {
  return (t: TicketEntity): AgendaTicketRef => ({
    id: t.id, displayId: t.displayId, title: t.title, boardId: t.boardId, status: t.status, tags: t.tags,
    epicIds: epicIdsByTicket.get(t.id) ?? [],
    repos: t.links.filter((l) => l.type === 'repository').map((l) => l.ref),
  });
}

function routineRef(r: RoutineEntity): AgendaRoutineRef {
  return { id: r.id, name: r.name, emoji: r.emoji, triggerKind: r.trigger.kind };
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
  const epicIdsByTicket = new Map<string, string[]>();
  for (const m of src.memberships ?? []) {
    const list = epicIdsByTicket.get(m.ticketId);
    if (list) { if (!list.includes(m.groupId)) list.push(m.groupId); } else epicIdsByTicket.set(m.ticketId, [m.groupId]);
  }
  const ticketRef = makeTicketRef(epicIdsByTicket);

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

  // ── R3 missed: slots the scheduler was not running for ──
  for (const m of src.missedSlots ?? []) {
    const at = Date.parse(m.slotAt);
    if (!inWindow(at, w)) continue;
    const r = routinesById.get(m.routineId);
    if (!r) continue; // deleted routine
    const slot = iso(new Date(at));
    items.push({
      id: `routine.missed:${r.id}:${slot}`, type: 'routine.missed', shape: 'point', start: slot,
      title: r.name, routine: routineRef(r), missedReason: m.reason,
      cron: r.trigger.kind === 'cron' ? r.trigger.cron : null,
      timezone: r.trigger.kind === 'cron' ? r.trigger.timezone : null,
    });
  }

  // ── E1 free events, one item per occurrence ──
  for (const e of src.calendarEvents ?? []) {
    const t = e.ticketId ? ticketsById.get(e.ticketId) : undefined;
    for (const occ of expandCalendarEvent(e, w.from, w.to, EVENT_OCCURRENCE_CAP)) {
      items.push({
        id: calendarEventItemId(e, occ.start),
        type: 'event', shape: e.allDay ? 'allDay' : 'block', start: occ.start, end: occ.end,
        title: e.title, event: e, ticket: t ? ticketRef(t) : null,
        eventLinks: src.eventLinks?.get(calendarEventLinkKey(e, occ.start)) ?? [],
      });
    }
  }

  // ── E3 external (already shaped by the source) ──
  items.push(...(src.externalItems ?? []));

  items.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.id < b.id ? -1 : 1));
  return {
    from: iso(w.from),
    to: iso(w.to),
    generatedAt: iso(w.now),
    items,
    routines: src.routines.map(routineRef).sort((a, b) => a.name.localeCompare(b.name)),
    truncated,
    epics: [...(src.epics ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    errors: {},
  };
}

/**
 * GET /api/agenda — reads every source in parallel, then {@link buildAgenda}.
 * Runs come from `getOverlapping(from, to)` — never `getAll()`, which loads every
 * run with its template snapshot and times out on a large Supabase instance;
 * events are read once per family with the window (widened back to the oldest
 * overlapping run, so a wait that began before `from` is still bounded).
 */
export class GetAgendaUseCase {
  constructor(
    private readonly ticketStore: TicketStorePort,
    private readonly routineStore: RoutineStorePort | null,
    private readonly runStore: WorkflowRunStorePort | null,
    private readonly eventLog: DomainEventLogStorePort | null,
    private readonly external: AgendaExternalSource | null = null,
    private readonly more: {
      ticketGroups?: TicketGroupStorePort | null;
      kvStore?: KvStorePort | null;
      /** Deliverable links grouped by key (the link store lives in infrastructure). */
      links?: () => Promise<Map<string, AgendaExternalLink[]>>;
    } = {},
  ) {}

  async execute(w: AgendaWindow, opts: { calendarIds?: string[] } = {}): Promise<AgendaResponse> {
    const kv = this.more.kvStore ?? null;
    const externalP: Promise<{ items: AgendaItem[]; error: string | null }> = this.external
      ? this.external.list(w.from, w.to, opts.calendarIds ?? []).then(
        (items) => ({ items, error: null }),
        (err: unknown) => ({ items: [], error: err instanceof Error ? err.message : String(err) }),
      )
      : Promise.resolve({ items: [], error: null });
    const [tickets, routines, allRuns, groups, calendarEvents, missedSlots, eventLinks] = await Promise.all([
      this.ticketStore.getAllTickets(),
      this.routineStore ? this.routineStore.getAll() : Promise.resolve([]),
      this.runStore ? this.runStore.getOverlapping(w.from, w.to) : Promise.resolve([]),
      this.loadEpics(),
      kv ? listCalendarEvents(kv) : Promise.resolve([]),
      kv ? listMissedSlots(kv) : Promise.resolve([]),
      this.more.links ? this.more.links().catch(() => new Map<string, AgendaExternalLink[]>()) : Promise.resolve(new Map<string, AgendaExternalLink[]>()),
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
      runs.length ? read('workflow', since) : Promise.resolve([]),
    ]);
    const external = await externalP;
    const res = buildAgenda({
      tickets, routines, runs, events: families.flat(),
      memberships: groups.memberships, epics: groups.epics, calendarEvents, eventLinks, missedSlots, externalItems: external.items,
    }, w);
    if (external.error !== null) res.errors.external = external.error;
    return res;
  }

  /** Epics and their memberships: one read for the groups, one per group — never per ticket. */
  private async loadEpics(): Promise<{ epics: { id: string; name: string }[]; memberships: TicketGroupMembership[] }> {
    const store = this.more.ticketGroups;
    if (!store) return { epics: [], memberships: [] };
    const groups = await store.getAllTicketGroups();
    const lists = await Promise.all(groups.map((g) => store.getMembershipsByGroup(g.id)));
    return { epics: groups.map((g) => ({ id: g.id, name: g.name })), memberships: lists.flat() };
  }
}
