import type { TicketStatus } from '@fleex/shared';
import type { ConfigPort } from '../application/ports/config.port.js';
import { isFactoryEnabled } from '../application/ports/config.port.js';
import type { TicketStorePort } from '../application/ports/ticket-store.port.js';
import type { SkillStorePort } from '../application/ports/skill-store.port.js';
import type { PersonaStorePort } from '../application/ports/persona-store.port.js';
import type { AgentEventStorePort } from '../application/ports/agent-event-store.port.js';
import type { ExecuteAgentUseCase } from '../application/use-cases/execute-agent.js';
import type { RunPanelUseCase } from '../application/use-cases/run-panel.js';
import type { ApplyTicketMutationUseCase } from '../application/use-cases/apply-ticket-mutation.js';
import type { SubmitDeliverableUseCase } from '../application/use-cases/submit-deliverable.js';
import type { PostCommentUseCase } from '../application/use-cases/post-comment.js';
import type { EventBus } from '../application/event-bus.js';
import { AgentStepExecutor } from '../application/services/step-executors/agent-step-executor.js';
import { SkillStepExecutor } from '../application/services/step-executors/skill-step-executor.js';
import { PanelStepExecutor } from '../application/services/step-executors/panel-step-executor.js';
import type { FactoryStorePort } from './factory-store.port.js';
import { FactoryEngine, type FactorySnapshot } from './engine.js';
import { FactoryFeed, type FactoryPatch } from './factory-feed.js';
import { StationRunner } from './station-runner.js';
import { IntakePuller } from './intake-puller.js';
import type { MailSourcePort } from './mail-source.port.js';
import { runScript, normaliseScript, type ScriptContext, type Shell } from './script-runner.js';
import { buildTicketWorkspaceId } from '@fleex/shared';
import { basename } from 'node:path';
import { computeStats, type ExecutionCost, type FactoryStats } from './stats.js';
import type { ExitLog, FactoryTicketInfo, StationSpec } from './types.js';
import type { StationRunResult } from './station-runner.js';
import type { CommentPostedEvent } from '../domain/events.js';

/** What a person launches by hand from a ticket's thread. A workflow is not one: a ticket on the floor cannot run any. */
const LAUNCHES = ['agent', 'skill', 'panel'];

const DAY_MS = 86_400_000;
/* a minute: the page asks every minute, and the stats span days */
const STATS_TTL_MS = 60_000;
/* a floor that could not be loaded is tried again after this, not at every tick */
const INIT_RETRY_MS = 30_000;
/* what changes a ticket as the floor sees it: its type, priority, status, tags, flags, or its removal */
const TICKET_EVENTS = ['ticket.updated', 'ticket.moved', 'ticket.blocked', 'ticket.unblocked', 'ticket.favorited', 'ticket.unfavorited', 'ticket.deleted'] as const;

export interface FactoryModuleDeps {
  /** Null on a storage driver the Factory does not support: the module is then absent. */
  store: FactoryStorePort | null;
  config: ConfigPort;
  ticketStore: TicketStorePort;
  skillStore: SkillStorePort;
  personaStore: PersonaStorePort;
  agentEventStore: AgentEventStorePort;
  executeAgent: ExecuteAgentUseCase;
  runPanel: RunPanelUseCase;
  applyTicketMutation: ApplyTicketMutationUseCase;
  submitDeliverable: SubmitDeliverableUseCase;
  postComment: PostCommentUseCase;
  eventBus: EventBus;
  /** What a script station needs of the machine: a shell, and where a ticket's workspace and worktrees are. Without it script stations cannot run. */
  host?: { shell: Shell; exists(path: string): Promise<boolean>; workspacePath(workspaceId: string): string; workspaceRepoPath(workspaceId: string, repoName: string): string };
  logger: { warn(msg: string, meta?: Record<string, unknown>): void; info(msg: string, meta?: Record<string, unknown>): void };
  /** What reads the mailbox for the Gmail intakes (gogcli today). Without it they say they cannot be pulled. */
  mail?: MailSourcePort | null;
}

/**
 * The experimental Factory, as one object the rest of the server can hold or
 * not. Everything about it lives in `src/factory` and in the `factory_*` tables;
 * with the flag off it reads nothing, writes nothing and starts nothing.
 */
export class FactoryModule {
  readonly engine: FactoryEngine;
  readonly store: FactoryStorePort;
  private initPromise: Promise<void> | null = null;
  private loaded = false;
  private retryAt = 0;
  private readonly feed = new FactoryFeed();
  readonly puller: IntakePuller;
  readonly mail: MailSourcePort | null;

  /**
   * A script station on a ticket: where the ticket's workspace and worktrees are, what each of its repositories
   * defines as named actions, and the commands run through the host's shell. A repository the ticket is linked to
   * whose worktree is not on disk is told as such: the station says so and counts it as a failure.
   */
  private async runScript(station: StationSpec, ticketId: string): Promise<StationRunResult> {
    const host = this.deps.host;
    if (!host) return { status: 'failed', outcome: '', executionId: null, error: 'Script stations cannot run here' };
    const entity = await this.deps.ticketStore.getTicketById(ticketId);
    if (!entity) return { status: 'failed', outcome: '', executionId: null, error: 'The ticket is gone' };
    const t = entity.toDTO(), links = t.links ?? [], workspaceId = buildTicketWorkspaceId(t.title, t.id), workspace = host.workspacePath(workspaceId);
    const made = links.filter((l) => l.type === 'worktree' && l.ref);
    const worktrees: ScriptContext['worktrees'] = [];
    for (const l of links) {
      if (l.type !== 'repository' || !l.ref?.includes('/')) continue;
      const name = l.ref.split('/')[1] ?? '', path = made.find((w) => basename(w.ref) === name)?.ref ?? host.workspaceRepoPath(workspaceId, name);
      worktrees.push({ repo: l.ref, path: (await host.exists(path).catch(() => false)) ? path : null });
    }
    const spec = normaliseScript(station.script), repoConfigs = this.deps.config.get().repoConfigs ?? {};
    /* the workspace exists as soon as something runs in it: a ticket no agent has worked on yet may not have one */
    if (spec.lines.some((l) => l.target === 'workspace')) await host.shell(`mkdir -p '${workspace.replace(/'/g, `'\\''`)}'`, { cwd: '/', timeoutMs: 10_000 }).catch(() => undefined);
    return runScript(spec, {
      workspace, worktrees, actions: (repo) => repoConfigs[repo]?.actions ?? {},
      env: { FLEEX_TICKET_ID: t.id, FLEEX_TICKET_NUMBER: String(t.displayId), FLEEX_TICKET_TITLE: t.title, FLEEX_WORKSPACE: workspace, FLEEX_STATION: station.name || 'Script' },
    }, host.shell);
  }
  private statsCache = new Map<number, { at: number; value: Promise<FactoryStats> }>();

  constructor(private readonly deps: FactoryModuleDeps & { store: FactoryStorePort }) {
    const runner = new StationRunner({
      executors: {
        agent: new AgentStepExecutor(deps.executeAgent, deps.config),
        skill: new SkillStepExecutor(deps.executeAgent, deps.skillStore, deps.personaStore, deps.config),
        panel: new PanelStepExecutor(deps.runPanel, deps.config),
      },
      script: (station, ticketId) => this.runScript(station, ticketId),
      submitDeliverable: deps.submitDeliverable, postComment: deps.postComment, agentEventStore: deps.agentEventStore, eventBus: deps.eventBus,
    });
    this.store = deps.store;
    this.engine = new FactoryEngine({
      store: deps.store, runner, logger: deps.logger,
      loadTicket: async (ticketId): Promise<FactoryTicketInfo | null> => {
        const entity = await deps.ticketStore.getTicketById(ticketId);
        if (!entity) return null;
        const t = entity.toDTO();
        if (t.archivedAt) return null;
        return { id: t.id, displayId: t.displayId, title: t.title, type: t.type ?? '', priority: t.priority ?? '', status: t.status, tags: t.tags ?? [], boardId: t.boardId, complexity: t.complexity ?? null, favorite: t.favorite === true, blocked: t.blocked === true };
      },
      setStatus: async (ticketId: string, status: TicketStatus) => {
        await deps.applyTicketMutation.execute({ ticketId, move: { status }, actor: { actorType: 'agent', actorName: 'Factory' } });
      },
      /* by the ordinary path, as any automation would: a status is a move, the rest are fields */
      applyChange: async (ticketId, change) => {
        await deps.applyTicketMutation.execute({
          ticketId, ...(change.status ? { move: { status: change.status } } : {}),
          ...(Object.keys(change.fields).length ? { fields: change.fields as NonNullable<Parameters<typeof deps.applyTicketMutation.execute>[0]['fields']> } : {}),
          actor: { actorType: 'agent', actorName: 'Factory' },
        });
      },
      cancelExecution: (executionId) => deps.executeAgent.cancelExecution(executionId),
      /* a mail is asked again for its whole thread: what a station is told, and what an older item is filled from */
      readItem: async (item) => {
        if (item.source !== 'gmail' || !deps.mail) return null;
        const messages = await deps.mail.thread(item.sourceKey), last = messages[messages.length - 1];
        if (!last) return null;
        return { body: { text: last.body, html: last.html }, conversation: messages.map((m) => ({ from: m.from, at: m.at, text: m.body })) };
      },
      /* in the human's name, as a comment of theirs would be; it starts no agent (no mention is created from it) */
      recordDecision: async (ticketId, gate, outcome, reason) => {
        const { humanDisplayName, humanMentionName } = deps.config.get();
        const authorName = humanDisplayName || humanMentionName || 'user';
        const body = `**${gate}: ${outcome}**${reason ? `\n\n${reason.replace(/@(?=[\w-]+:?)/g, '@\u200b')}` : ''}`;
        const { comment } = await deps.postComment.execute({ ticketId, authorType: 'user', authorName, body, visibility: 'public' });
        deps.eventBus.emit({ type: 'comment.posted', commentId: comment.id, ticketId, authorType: 'user', authorName, createdMentions: [], occurredAt: new Date() });
      },
    });
    this.mail = deps.mail ?? null;
    this.puller = new IntakePuller({ engine: this.engine, mail: this.mail, logger: deps.logger });
    this.listen();
  }

  enabled(): boolean { return isFactoryEnabled(this.deps.config.get()); }

  /**
   * What a person writes in a ticket's thread reaches the floor: launching an agent, a skill or a panel sets the ticket
   * aside; a plain reply to a station's question gives the ticket back to that station.
   */
  private listen(): void {
    this.deps.eventBus.on('comment.posted', async (e) => {
      const event = e as CommentPostedEvent;
      if (event.authorType !== 'user' || !this.managedTicketIds()?.has(event.ticketId)) return;
      if (event.createdMentions.some((m) => LAUNCHES.includes(m.targetType))) await this.engine.launchedByHand(event.ticketId);
      else await this.engine.answered(event.ticketId);
    });
    for (const type of TICKET_EVENTS) {
      this.deps.eventBus.on(type, async (e) => {
        const ticketId = (e as { ticketId?: string }).ticketId;
        if (ticketId && this.managedTicketIds()?.has(ticketId)) await this.engine.ticketChanged(ticketId);
      });
    }
  }

  /** A skill or a panel was launched on a ticket without a comment (its own button): same as launching it from the thread. */
  async launchedByHand(ticketId: string): Promise<void> {
    if (!this.managedTicketIds()?.has(ticketId)) return;
    await this.engine.launchedByHand(ticketId).catch((err) => this.deps.logger.warn('Factory: could not set a ticket aside', { ticketId, error: String(err) }));
  }

  /** Why a workflow cannot start on this ticket, or null when it can: a ticket on the floor is already being routed. */
  refusesWorkflow(ticketId: string): string | null {
    return this.managedTicketIds()?.has(ticketId) ? 'This ticket is on the factory floor, where the machines decide what runs on it. Give it back from the floor to run a workflow on it.' : null;
  }

  /** Loads the floor on first use, so a workspace that never enables the Factory never queries its tables. */
  ensureReady(): Promise<void> {
    if (!this.initPromise) this.initPromise = this.engine.init().then(() => { this.loaded = true; }, (err) => { this.initPromise = null; throw err; });
    return this.initPromise;
  }

  /** The floor as the routes give it: a snapshot, and the last live patch it already holds (see `FactoryFeed`). */
  state(): FactorySnapshot & { epoch: string; seq: number } {
    return { ...this.engine.snapshot(), epoch: this.feed.epoch, seq: this.feed.seq };
  }

  /** What changed on the floor since the last patch, for the pages watching it live; null when off, not loaded or unchanged. */
  patch(): FactoryPatch | null {
    return this.enabled() && this.loaded ? this.feed.diff(this.engine.snapshot()) : null;
  }

  /** Tickets the rest of Fleex should leave alone, or null when the Factory is off or not loaded yet. */
  managedTicketIds(): Set<string> | null {
    return this.enabled() && this.initPromise ? this.engine.managedIds() : null;
  }

  /**
   * What the floor did over the last `days` days, machine by machine. Read-only,
   * and kept for a few seconds: pricing the runs reads the executions of every
   * ticket that ran in the period.
   */
  stats(days: number): Promise<FactoryStats> {
    const span = Math.max(1, Math.min(90, Math.floor(days) || 7));
    const hit = this.statsCache.get(span);
    if (hit && Date.now() - hit.at < STATS_TTL_MS) return hit.value;
    const value = this.computeStats(span).catch((err) => { this.statsCache.delete(span); throw err; });
    this.statsCache.set(span, { at: Date.now(), value });
    return value;
  }

  private async computeStats(days: number): Promise<FactoryStats> {
    const now = Date.now(), since = new Date(now - days * DAY_MS).toISOString(), until = new Date(now).toISOString();
    const floor = this.engine.snapshot().floor;
    /* a station's visits to items count as its runs; they have no ticket, so what they cost is read by execution */
    const [ticketRuns, itemRuns, exitItems] = await Promise.all([this.store.listRunsSince(floor.id, since), this.store.listItemRunsSince(floor.id, since), this.store.listExitItems(floor.id, null, since)]);
    const runs = [...ticketRuns, ...itemRuns];
    const ticketIds = [...new Set(ticketRuns.filter((r) => r.executionId || r.executor === 'panel').map((r) => r.ticketId))];
    const executions: ExecutionCost[] = [];
    for (let i = 0; i < ticketIds.length; i += 8) {
      const batch = await Promise.all(ticketIds.slice(i, i + 8).map((id) => this.deps.agentEventStore.getExecutionsByTicket(id).catch(() => [])));
      for (const list of batch) for (const e of list) executions.push({ id: e.id, ticketId: e.ticketId, startedAt: e.startedAt, costUsd: e.costUsd ?? null });
    }
    const itemExecutions = [...new Set(itemRuns.map((r) => r.executionId).filter((id): id is string => !!id))];
    if (itemExecutions.length && this.deps.agentEventStore.getExecutionsByIds) {
      for (const e of await this.deps.agentEventStore.getExecutionsByIds(itemExecutions).catch(() => [])) executions.push({ id: e.id, ticketId: e.ticketId, startedAt: e.startedAt, costUsd: e.costUsd ?? null });
    }
    return computeStats({ runs, executions, layout: floor.layout, since, until, days, exitItems });
  }


  /**
   * What left by one exit (by every exit of the floor, with null) over the last `days` days: its shipments (the `exit`
   * runs), each with the ticket as it is now (a ticket deleted since keeps its number only), and the items archived
   * there. Each exit that appears is named: as it is on the floor, or as its runs remember it once removed.
   */
  async exitLog(machineId: string | null, days: number): Promise<ExitLog> {
    const span = Math.max(1, Math.min(90, Math.floor(days) || 7)), since = new Date(Date.now() - span * DAY_MS).toISOString();
    const floor = this.engine.snapshot().floor, floorId = floor.id;
    const all = machineId ? await this.store.listRecentRuns(floorId, 2000, machineId) : await this.store.listRunsSince(floorId, since);
    const runs = all.filter((r) => r.executor === 'exit' && r.finishedAt && r.finishedAt >= since);
    const tickets: ExitLog['tickets'] = [];
    for (let i = 0; i < runs.length; i += 8) {
      const batch = await Promise.all(runs.slice(i, i + 8).map(async (r) => {
        const t = (await this.deps.ticketStore.getTicketById(r.ticketId).catch(() => null))?.toDTO() ?? null;
        return {
          machineId: r.machineId, ticketId: r.ticketId, displayId: t?.displayId ?? null, title: t?.title ?? 'A ticket deleted since', type: t?.type ?? '', priority: t?.priority ?? '', boardId: t?.boardId ?? null,
          status: t?.status ?? null, archived: !!t?.archivedAt, tags: t?.tags ?? [], handedAt: r.startedAt, shippedAt: r.finishedAt!,
        };
      }));
      tickets.push(...batch);
    }
    tickets.sort((a, b) => b.shippedAt.localeCompare(a.shippedAt));
    const items = (await this.store.listExitItems(floorId, machineId, since)).map((i) => ({
      machineId: i.machineId!, itemId: i.id, source: i.source, title: i.title, author: i.author, url: i.url, tags: i.tags, handedAt: i.createdAt, shippedAt: i.archivedAt!,
    }));
    /* every exit on the floor, then those only the runs remember */
    const exits = new Map<string, ExitLog['exits'][number]>();
    for (const m of floor.layout.machines) if (m.kind === 'exit' && (!machineId || m.id === machineId)) exits.set(m.id, { machineId: m.id, name: m.name || 'Exit', onFloor: true });
    for (const r of runs) if (!exits.has(r.machineId)) exits.set(r.machineId, { machineId: r.machineId, name: r.machineName || 'Exit', onFloor: false });
    for (const i of items) if (!exits.has(i.machineId)) exits.set(i.machineId, { machineId: i.machineId, name: 'Exit', onFloor: false });
    return { machineId, days: span, since, exits: [...exits.values()], tickets, items };
  }

  start(): void {
    this.engine.start(() => {
      if (!this.enabled()) return false;
      if (!this.initPromise && Date.now() >= this.retryAt) {
        void this.ensureReady().catch((err) => { this.retryAt = Date.now() + INIT_RETRY_MS; this.deps.logger.warn('Factory: could not load the floor', { error: String(err) }); });
      }
      return true;
    });
    this.puller.start(() => this.enabled() && this.loaded);
  }

  stop(): Promise<void> { this.puller.stop(); return this.engine.stop(); }
}

export function createFactoryModule(deps: FactoryModuleDeps): FactoryModule | null {
  return deps.store ? new FactoryModule({ ...deps, store: deps.store }) : null;
}
