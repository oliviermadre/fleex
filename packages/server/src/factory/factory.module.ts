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
import { FactoryEngine } from './engine.js';
import { StationRunner } from './station-runner.js';
import { runScript, normaliseScript, type ScriptContext, type Shell } from './script-runner.js';
import { buildTicketWorkspaceId } from '@fleex/shared';
import { basename } from 'node:path';
import { computeStats, type ExecutionCost, type FactoryStats } from './stats.js';
import type { FactoryTicketInfo, StationSpec } from './types.js';
import type { StationRunResult } from './station-runner.js';
import type { CommentPostedEvent } from '../domain/events.js';

/** What a person launches by hand from a ticket's thread. A workflow is not one: a ticket on the floor cannot run any. */
const LAUNCHES = ['agent', 'skill', 'panel'];

const DAY_MS = 86_400_000;
const STATS_TTL_MS = 20_000;

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
      /* in the human's name, as a comment of theirs would be; it starts no agent (no mention is created from it) */
      recordDecision: async (ticketId, gate, outcome, reason) => {
        const { humanDisplayName, humanMentionName } = deps.config.get();
        const authorName = humanDisplayName || humanMentionName || 'user';
        const body = `**${gate}: ${outcome}**${reason ? `\n\n${reason.replace(/@(?=[\w-]+:?)/g, '@\u200b')}` : ''}`;
        const { comment } = await deps.postComment.execute({ ticketId, authorType: 'user', authorName, body, visibility: 'public' });
        deps.eventBus.emit({ type: 'comment.posted', commentId: comment.id, ticketId, authorType: 'user', authorName, createdMentions: [], occurredAt: new Date() });
      },
    });
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
    if (!this.initPromise) this.initPromise = this.engine.init().catch((err) => { this.initPromise = null; throw err; });
    return this.initPromise;
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
    const runs = await this.store.listRunsSince(floor.id, since);
    const ticketIds = [...new Set(runs.filter((r) => r.executionId || r.executor === 'panel').map((r) => r.ticketId))];
    const executions: ExecutionCost[] = [];
    for (let i = 0; i < ticketIds.length; i += 8) {
      const batch = await Promise.all(ticketIds.slice(i, i + 8).map((id) => this.deps.agentEventStore.getExecutionsByTicket(id).catch(() => [])));
      for (const list of batch) for (const e of list) executions.push({ id: e.id, ticketId: e.ticketId, startedAt: e.startedAt, costUsd: e.costUsd ?? null });
    }
    return computeStats({ runs, executions, layout: floor.layout, since, until, days });
  }

  start(): void {
    this.engine.start(() => {
      if (!this.enabled()) return false;
      if (!this.initPromise) void this.ensureReady().catch((err) => this.deps.logger.warn('Factory: could not load the floor', { error: String(err) }));
      return true;
    });
  }

  stop(): Promise<void> { return this.engine.stop(); }
}

export function createFactoryModule(deps: FactoryModuleDeps): FactoryModule | null {
  return deps.store ? new FactoryModule({ ...deps, store: deps.store }) : null;
}
