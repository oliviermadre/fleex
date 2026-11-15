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
import type { FactoryTicketInfo } from './types.js';

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

  constructor(private readonly deps: FactoryModuleDeps & { store: FactoryStorePort }) {
    const runner = new StationRunner({
      executors: {
        agent: new AgentStepExecutor(deps.executeAgent, deps.config),
        skill: new SkillStepExecutor(deps.executeAgent, deps.skillStore, deps.personaStore, deps.config),
        panel: new PanelStepExecutor(deps.runPanel, deps.config),
      },
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
        return { id: t.id, displayId: t.displayId, title: t.title, type: t.type ?? '', priority: t.priority ?? '', status: t.status, tags: t.tags ?? [] };
      },
      setStatus: async (ticketId: string, status: TicketStatus) => {
        await deps.applyTicketMutation.execute({ ticketId, move: { status }, actor: { actorType: 'agent', actorName: 'Factory' } });
      },
    });
  }

  enabled(): boolean { return isFactoryEnabled(this.deps.config.get()); }

  /** Loads the floor on first use, so a workspace that never enables the Factory never queries its tables. */
  ensureReady(): Promise<void> {
    if (!this.initPromise) this.initPromise = this.engine.init().catch((err) => { this.initPromise = null; throw err; });
    return this.initPromise;
  }

  /** Tickets the rest of Fleex should leave alone, or null when the Factory is off or not loaded yet. */
  managedTicketIds(): Set<string> | null {
    return this.enabled() && this.initPromise ? this.engine.managedIds() : null;
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
