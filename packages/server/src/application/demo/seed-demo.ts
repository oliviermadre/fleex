/**
 * Demo seed: writes a presentable backlog (« Atelier Nova ») into an EMPTY
 * instance, through the stores — never raw SQL — so it survives migrations.
 *
 * Every date in the seed is relative to `now` (`-30m`, `-2h`, `-3d`, `-1w`), so
 * "il y a 2 h" is still true on the day the screenshots are taken. Every
 * reference is a key chosen by the seed author, never a UUID.
 *
 * Only reachable when FLEEX_DEMO_MODE=1 (see demo.routes.ts). Contract:
 * docs/releases.md.
 */
import { randomUUID } from 'node:crypto';
import type {
  AnnotationTone,
  StepOutput,
  TicketPriority,
  TicketStatus,
  WorkflowEdge,
  WorkflowStep,
  WorkflowTemplateSnapshot,
} from '@fleex/shared';
import { BoardEntity } from '../../domain/entities/board.entity.js';
import { TicketEntity } from '../../domain/entities/ticket.entity.js';
import { TicketGroupEntity } from '../../domain/entities/ticket-group.entity.js';
import { TicketActivityEntity } from '../../domain/entities/ticket-activity.entity.js';
import { TicketCommentEntity } from '../../domain/entities/ticket-comment.entity.js';
import { TicketDeliverableEntity } from '../../domain/entities/ticket-deliverable.entity.js';
import { TimelineAnnotationEntity } from '../../domain/entities/timeline-annotation.entity.js';
import { WorkflowRunEntity } from '../../domain/entities/workflow-run.entity.js';
import { StepRunEntity } from '../../domain/entities/step-run.entity.js';
import { AgentPersonaEntity } from '../../domain/entities/agent-persona.entity.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import type { TicketGroupStorePort } from '../ports/ticket-group-store.port.js';
import type { CommentStorePort } from '../ports/comment-store.port.js';
import type { DeliverableStorePort } from '../ports/deliverable-store.port.js';
import type { AnnotationStorePort } from '../ports/annotation-store.port.js';
import type { WorkflowRunStorePort } from '../ports/workflow-run-store.port.js';
import type { StepRunStorePort } from '../ports/step-run-store.port.js';
import type { PersonaStorePort } from '../ports/persona-store.port.js';

// ── Seed document (what the CLI sends, YAML already parsed and merged) ──────

export interface DemoSeed {
  personas?: Array<{ name: string; displayName?: string; emoji?: string; role?: string }>;
  boards?: Array<{ key: string; name: string; emoji?: string; createdAt?: string }>;
  epics?: Array<{
    key: string;
    name: string;
    emoji?: string;
    color?: string;
    description?: string;
    boards?: string[];
    timeframe?: 'now' | 'next' | 'later';
    createdAt?: string;
  }>;
  tickets?: DemoTicket[];
}

export interface DemoTicket {
  key: string;
  board: string;
  title: string;
  description?: string;
  status?: TicketStatus;
  priority?: TicketPriority;
  tags?: string[];
  epic?: string;
  persona?: string;
  /** Linked repositories (`org/name`), shown on the card; nothing is cloned. */
  repos?: string[];
  createdAt?: string;
  /** When the ticket reached its current status (default: halfway between creation and now). */
  statusAt?: string;
  comments?: Array<{ author?: string; persona?: string; at?: string; body: string }>;
  deliverables?: Array<{
    title: string;
    type?: string;
    status?: 'draft' | 'final';
    persona?: string;
    at?: string;
    content: string;
  }>;
  annotations?: Array<{ at: string; title: string; body?: string; tone?: AnnotationTone; author?: string }>;
  workflowRun?: {
    name?: string;
    emoji?: string;
    status?: 'completed' | 'running' | 'failed';
    steps: Array<{ name: string; persona?: string; gate?: boolean; at: string; outcome?: string }>;
  };
}

export interface DemoSeedResult {
  personas: number;
  boards: number;
  epics: number;
  tickets: number;
  comments: number;
  deliverables: number;
  annotations: number;
  workflowRuns: number;
  /** key → { id, displayId } so the shot lists can reach a ticket by its key. */
  ticketsByKey: Record<string, { id: string; displayId: number }>;
  boardsByKey: Record<string, string>;
}

export class DemoSeedError extends Error {}
/** The instance already has data: `fleex demo reset` recreates the DB instead. */
export class DemoNotEmptyError extends Error {}

const STATUSES: TicketStatus[] = ['backlog', 'todo', 'doing', 'reviewing', 'done', 'cancelled'];
const PRIORITIES: TicketPriority[] = ['none', 'low', 'medium', 'high'];
const UNIT_MS: Record<string, number> = { s: 1e3, m: 60e3, min: 60e3, h: 3600e3, d: 86400e3, w: 7 * 86400e3 };

/**
 * `-2h` → now − 2 h. Also accepts an absolute ISO date. Throws on anything else
 * so a typo in the seed fails the reset instead of silently dating at "now".
 */
export function resolveDemoDate(value: string | undefined, now: Date, fallback: Date = now): Date {
  if (value === undefined || value === null || value === '') return fallback;
  const v = String(value).trim();
  const m = /^-(\d+(?:\.\d+)?)\s*(s|min|m|h|d|w)$/.exec(v);
  if (m) return new Date(now.getTime() - Number(m[1]) * UNIT_MS[m[2]!]!);
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  throw new DemoSeedError(`invalid date "${v}" (use -30m, -2h, -3d, -1w or an ISO date)`);
}

export interface SeedDemoDeps {
  ticketStore: TicketStorePort;
  ticketGroupStore: TicketGroupStorePort;
  commentStore: CommentStorePort;
  deliverableStore: DeliverableStorePort;
  annotationStore: AnnotationStorePort;
  workflowRunStore: WorkflowRunStorePort | null;
  stepRunStore: StepRunStorePort | null;
  personaStore: PersonaStorePort;
}

export class SeedDemoUseCase {
  constructor(private readonly deps: SeedDemoDeps) {}

  async execute(seed: DemoSeed, now: Date = new Date()): Promise<DemoSeedResult> {
    const d = this.deps;
    if ((await d.ticketStore.getAllBoards()).length > 0 || (await d.ticketStore.getAllTickets()).length > 0) {
      throw new DemoNotEmptyError('the demo instance already has boards or tickets; run `fleex demo reset`, it recreates the database');
    }
    validate(seed);

    const result: DemoSeedResult = {
      personas: 0, boards: 0, epics: 0, tickets: 0, comments: 0, deliverables: 0, annotations: 0, workflowRuns: 0,
      ticketsByKey: {}, boardsByKey: {},
    };
    const at = (v: string | undefined, fallback?: Date) => resolveDemoDate(v, now, fallback ?? now);

    // Personas — reuse the installed ones, create a minimal one when missing.
    const personaNames = new Set((await d.personaStore.getAll()).map((p) => p.name));
    for (const p of seed.personas ?? []) {
      if (personaNames.has(p.name)) continue;
      const created = at('-30d');
      await d.personaStore.save(new AgentPersonaEntity(
        randomUUID(), p.name, p.displayName ?? p.name, 'claude-opus-4-8', 'claude_code',
        p.role ? `# ${p.displayName ?? p.name}\n\n${p.role}` : '',
        p.emoji ? `• Nom : ${p.displayName ?? p.name}\n• Emoji : ${p.emoji}` : '',
        '', null, created, created,
      ));
      personaNames.add(p.name);
      result.personas++;
    }

    // Boards
    for (const b of seed.boards ?? []) {
      const created = at(b.createdAt, at('-60d'));
      const board = new BoardEntity(randomUUID(), b.name, b.emoji ?? '📋', created, created);
      await d.ticketStore.saveBoard(board);
      result.boardsByKey[b.key] = board.id;
      result.boards++;
    }

    // Epics
    const epicIds: Record<string, string> = {};
    for (const e of seed.epics ?? []) {
      const created = at(e.createdAt, at('-45d'));
      const boardIds = (e.boards ?? []).map((k) => result.boardsByKey[k]!);
      const draft = TicketGroupEntity.create({
        id: randomUUID(), boardIds, name: e.name, emoji: e.emoji, color: e.color, description: e.description,
        timeframe: e.timeframe ?? 'now',
      });
      const epic = new TicketGroupEntity(
        draft.id, draft.boardIds, draft.name, draft.emoji, draft.color, draft.description, draft.timeframe,
        draft.groupStatus, false, false, created, created,
      );
      await d.ticketGroupStore.saveTicketGroup(epic);
      for (const boardId of boardIds) await d.ticketGroupStore.addBoardToGroup(epic.id, boardId);
      epicIds[e.key] = epic.id;
      result.epics++;
    }

    // Tickets, in seed order (display ids follow it).
    let position = 0;
    for (const t of seed.tickets ?? []) {
      const created = at(t.createdAt, at('-7d'));
      const status = t.status ?? 'backlog';
      const statusAt = t.statusAt
        ? at(t.statusAt)
        : new Date(created.getTime() + (now.getTime() - created.getTime()) / 2);
      const ticket = new TicketEntity(
        randomUUID(), result.boardsByKey[t.board]!, 0, t.title, t.description ?? '', status, t.priority ?? 'none',
        null, position++, t.tags ?? [], (t.repos ?? []).map((ref) => ({
          id: randomUUID(), type: 'repository' as const, ref, label: ref,
          url: `https://github.com/${ref}`, createdAt: created.toISOString(),
        })), false, false, null, t.persona ?? null, null, null, null,
        status === 'backlog' || status === 'todo' ? null : statusAt, statusAt, created, statusAt,
      );
      await d.ticketStore.createTicket(ticket);
      const saved = (await d.ticketStore.getAllTickets()).find((x) => x.id === ticket.id);
      result.ticketsByKey[t.key] = { id: ticket.id, displayId: saved?.displayId ?? 0 };
      result.tickets++;

      await d.ticketStore.saveActivity(new TicketActivityEntity(
        randomUUID(), ticket.id, 'created', {}, 'user', null, 'web', created,
      ));
      if (status !== 'backlog') {
        await d.ticketStore.saveActivity(new TicketActivityEntity(
          randomUUID(), ticket.id, 'moved', { status: { from: 'backlog', to: status } },
          t.persona ? 'agent' : 'user', t.persona ?? null, 'web', statusAt,
        ));
      }
      if (t.epic) await d.ticketGroupStore.addMembership(ticket.id, epicIds[t.epic]!);

      for (const c of t.comments ?? []) {
        const when = at(c.at);
        const isAgent = !!c.persona;
        const draft = TicketCommentEntity.create({
          id: randomUUID(), ticketId: ticket.id, authorType: isAgent ? 'agent' : 'user',
          authorName: c.persona ?? c.author ?? 'nas', body: c.body,
        });
        await d.commentStore.save(new TicketCommentEntity(
          draft.id, draft.ticketId, draft.authorType, draft.authorName, draft.body, draft.visibility,
          draft.privateRecipients, draft.mentions, null, when, when,
        ));
        result.comments++;
      }

      for (const del of t.deliverables ?? []) {
        const when = at(del.at);
        await d.deliverableStore.save(new TicketDeliverableEntity(
          randomUUID(), ticket.id, del.persona ?? 'catalyst', del.type ?? 'report', del.title, del.content,
          1, del.status ?? 'final', null, when, when,
        ));
        result.deliverables++;
      }

      for (const a of t.annotations ?? []) {
        const when = at(a.at);
        await d.annotationStore.save(TimelineAnnotationEntity.create({
          id: randomUUID(), ticketId: ticket.id, ticketCreatedAt: created, at: when.toISOString(), title: a.title,
          body: a.body, tone: a.tone, authorType: 'user', authorName: a.author ?? 'nas', now,
        }));
        result.annotations++;
      }

      if (t.workflowRun && d.workflowRunStore && d.stepRunStore) {
        await this.seedRun(ticket.id, t.workflowRun, at);
        result.workflowRuns++;
      }
    }
    return result;
  }

  private async seedRun(
    ticketId: string,
    run: NonNullable<DemoTicket['workflowRun']>,
    at: (v: string | undefined, fallback?: Date) => Date,
  ): Promise<void> {
    const steps: WorkflowStep[] = run.steps.map((s, i) => ({
      id: `demo-step-${i + 1}`,
      name: s.name,
      executorType: s.gate ? 'human_gate' : 'agent',
      executorRef: s.gate ? '' : (s.persona ?? 'builder'),
      ...(s.gate ? { humanGateOutcomes: ['approve', 'reject'] } : {}),
      position: { x: i * 260, y: 0 },
    }));
    const edges: WorkflowEdge[] = steps.slice(1).map((s, i) => ({
      id: `demo-edge-${i + 1}`, source: steps[i]!.id, target: s.id, isDefault: true,
    }));
    const snapshot: WorkflowTemplateSnapshot = {
      name: run.name ?? 'Spec Dev PR', emoji: run.emoji ?? '⚙️', steps, edges, entryStepId: steps[0]!.id,
    };
    const status = run.status ?? 'completed';
    const times = run.steps.map((s) => at(s.at));
    const started = times[0]!;
    const lastDone = new Date(times[times.length - 1]!.getTime() + 20 * 60e3);
    const runId = randomUUID();
    const runEntity = new WorkflowRunEntity(
      runId, ticketId, null, snapshot, status, status === 'running' ? steps[steps.length - 1]!.id : null,
      'nas', 'demo-seed', started, status === 'running' ? null : lastDone, started, lastDone,
    );
    await this.deps.workflowRunStore!.save(runEntity);

    for (let i = 0; i < steps.length; i++) {
      const isLast = i === steps.length - 1;
      const stepStatus = isLast && status === 'running' ? 'running' : isLast && status === 'failed' ? 'failed' : 'completed';
      const startedAt = times[i]!;
      const completedAt = stepStatus === 'running' ? null : new Date((times[i + 1] ?? lastDone).getTime() - 60e3);
      const outcome = run.steps[i]!.outcome ?? (run.steps[i]!.gate ? 'approve' : undefined);
      const output: StepOutput | null = stepStatus === 'completed'
        ? { result: 'ok', schemaFields: {}, ...(outcome ? { outcome } : {}) }
        : null;
      await this.deps.stepRunStore!.save(new StepRunEntity(
        randomUUID(), runId, steps[i]!.id, 1, stepStatus,
        stepStatus === 'completed' ? 'ok' : stepStatus === 'failed' ? 'ko' : null,
        output, isLast ? null : edges[i]!.id, null, startedAt, completedAt, startedAt,
      ));
    }
  }
}

/** Fail with every problem at once, naming the ticket key, before writing anything. */
function validate(seed: DemoSeed): void {
  const errors: string[] = [];
  const boards = new Set((seed.boards ?? []).map((b) => b.key));
  const epics = new Set((seed.epics ?? []).map((e) => e.key));
  const keys = new Set<string>();
  for (const e of seed.epics ?? []) {
    for (const b of e.boards ?? []) if (!boards.has(b)) errors.push(`epic ${e.key}: unknown board "${b}"`);
  }
  for (const t of seed.tickets ?? []) {
    const where = `ticket ${t.key ?? '(no key)'}`;
    if (!t.key) errors.push(`${where}: "key" is required`);
    else if (keys.has(t.key)) errors.push(`${where}: duplicate key`);
    keys.add(t.key);
    if (!t.title) errors.push(`${where}: "title" is required`);
    if (!boards.has(t.board)) errors.push(`${where}: unknown board "${t.board}"`);
    if (t.epic && !epics.has(t.epic)) errors.push(`${where}: unknown epic "${t.epic}"`);
    if (t.status && !STATUSES.includes(t.status)) errors.push(`${where}: invalid status "${t.status}"`);
    if (t.priority && !PRIORITIES.includes(t.priority)) errors.push(`${where}: invalid priority "${t.priority}"`);
    if (t.workflowRun && !(t.workflowRun.steps?.length > 0)) errors.push(`${where}: workflowRun needs at least one step`);
    for (const del of t.deliverables ?? []) {
      if (typeof del.content !== 'string' || !del.content) errors.push(`${where}: deliverable "${del.title}" has no content`);
    }
  }
  // Dates are checked here too, so a typo never leaves a half-written seed.
  const checkDate = (v: string | undefined, where: string) => {
    try { resolveDemoDate(v, new Date()); } catch (e) { errors.push(`${where}: ${(e as Error).message}`); }
  };
  for (const b of seed.boards ?? []) checkDate(b.createdAt, `board ${b.key}`);
  for (const e of seed.epics ?? []) checkDate(e.createdAt, `epic ${e.key}`);
  for (const t of seed.tickets ?? []) {
    const where = `ticket ${t.key}`;
    checkDate(t.createdAt, where);
    checkDate(t.statusAt, where);
    for (const c of t.comments ?? []) checkDate(c.at, `${where} comment`);
    for (const x of t.deliverables ?? []) checkDate(x.at, `${where} deliverable`);
    for (const a of t.annotations ?? []) {
      checkDate(a.at, `${where} annotation`);
      if (!a.at) errors.push(`${where} annotation "${a.title}": "at" is required`);
    }
    for (const s of t.workflowRun?.steps ?? []) checkDate(s.at, `${where} run step ${s.name}`);
  }
  if (errors.length) throw new DemoSeedError(errors.join('\n'));
}
