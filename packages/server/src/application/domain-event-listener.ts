import type { EventBus } from './event-bus.js';
import type { PersonaStorePort } from './ports/persona-store.port.js';
import type { SkillStorePort } from './ports/skill-store.port.js';
import type { TicketStorePort } from './ports/ticket-store.port.js';
import type { MentionStorePort } from './ports/mention-store.port.js';
import type { CommentStorePort } from './ports/comment-store.port.js';
import type { DeliverableStorePort } from './ports/deliverable-store.port.js';
import type { LoggerPort } from './ports/logger.port.js';
import type { AutoReviewWorkflowUseCase } from './use-cases/auto-review-workflow.js';
import type { ExecuteAgentUseCase } from './use-cases/execute-agent.js';
import type { WakeWaitingAgentsUseCase } from './use-cases/wake-waiting-agents.js';
import type { RunPanelUseCase } from './use-cases/run-panel.js';
import type { GenerateTicketSummaryUseCase } from './use-cases/generate-ticket-summary.js';
import type { WorkflowTemplateStorePort } from './ports/workflow-template-store.port.js';
import type { CreateWorkflowRunUseCase } from './use-cases/create-workflow-run.js';
import type {
  AnyDomainEvent,
  CommentPostedEvent,
  CommentUpdatedEvent,
  MentionCreatedEvent,
  MentionResolvedEvent,
  MentionWaitingForInfoEvent,
  TicketMovedEvent,
  TicketUpdatedEvent,
  DeliverableCreatedEvent,
  DeliverableUpdatedEvent,
} from '../domain/events.js';

/**
 * Broadcast function signature — sends typed messages to WebSocket clients.
 */
type BroadcastFn = (type: string, data: unknown) => void;

export interface DomainEventListenerDeps {
  eventBus: EventBus;
  personaStore: PersonaStorePort;
  skillStore: SkillStorePort;
  ticketStore: TicketStorePort;
  mentionStore: MentionStorePort;
  commentStore: CommentStorePort;
  deliverableStore: DeliverableStorePort;
  autoReviewWorkflow: AutoReviewWorkflowUseCase;
  executeAgent: ExecuteAgentUseCase;
  wakeWaitingAgents: WakeWaitingAgentsUseCase;
  runPanel: RunPanelUseCase;
  generateTicketSummary: GenerateTicketSummaryUseCase;
  logger: LoggerPort;
  workflowTemplateStore?: WorkflowTemplateStorePort | null;
  createWorkflowRun?: CreateWorkflowRunUseCase | null;
}

/**
 * Central listener that reacts to all domain events.
 *
 * Handles:
 * 1. WebSocket broadcasting (ticket, persona channels)
 * 2. Auto-triggering agents when mentioned
 * 3. Auto-review workflow transitions
 * 4. Waking waiting agents on new content
 * 5. Auto-resolving mentions when ticket → done
 */
export class DomainEventListener {
  private ticketBroadcast: BroadcastFn = () => {};
  private personaBroadcast: BroadcastFn = () => {};
  private skillBroadcast: BroadcastFn = () => {};

  constructor(private readonly deps: DomainEventListenerDeps) {}

  /** Called after Phase B wiring to attach workflow deps (which are initialized after the listener) */
  setWorkflowDeps(deps: { workflowTemplateStore: WorkflowTemplateStorePort | null; createWorkflowRun: CreateWorkflowRunUseCase | null }): void {
    this.deps.workflowTemplateStore = deps.workflowTemplateStore;
    this.deps.createWorkflowRun = deps.createWorkflowRun;
  }

  /** Called by WS plugins to wire up broadcast functions */
  setTicketBroadcast(fn: BroadcastFn): void {
    this.ticketBroadcast = fn;
  }

  setPersonaBroadcast(fn: BroadcastFn): void {
    this.personaBroadcast = fn;
  }

  setSkillBroadcast(fn: BroadcastFn): void {
    this.skillBroadcast = fn;
  }

  /**
   * Register all event handlers on the bus.
   */
  register(): void {
    const bus = this.deps.eventBus;

    // ── Ticket broadcasts ──
    bus.on('ticket.created', (e) => this.broadcastTicketEntity(e, 'ticket:created'));
    bus.on('ticket.updated', (e) => this.broadcastTicketEntity(e, 'ticket:updated'));
    bus.on('ticket.moved', (e) => this.broadcastTicketEntity(e, 'ticket:moved'));
    bus.on('ticket.deleted', (e) => {
      if (e.type === 'ticket.deleted') {
        this.ticketBroadcast('ticket:deleted', { id: e.ticketId });
      }
    });

    // ── Board broadcasts ──
    bus.on('board.updated', (e) => this.broadcastBoardEntity(e, 'board:updated'));
    bus.on('board.deleted', (e) => {
      if (e.type === 'board.deleted') {
        this.ticketBroadcast('board:updated', { deleted: e.boardId });
      }
    });

    // ── Comment broadcasts ──
    bus.on('comment.posted', (e) => this.broadcastCommentEntity(e, 'comment:created'));
    bus.on('comment.updated', (e) => this.broadcastCommentEntity(e, 'comment:updated'));
    bus.on('comment.deleted', (e) => {
      if (e.type === 'comment.deleted') {
        this.ticketBroadcast('comment:deleted', { id: e.commentId, ticketId: e.ticketId });
      }
    });

    // ── Mention broadcasts ──
    bus.on('mention.created', (e) => this.broadcastMentionEntity(e, 'mention:created'));
    bus.on('mention.acknowledged', (e) => this.broadcastMentionEntity(e, 'mention:acknowledged'));
    bus.on('mention.resolved', (e) => this.broadcastMentionEntity(e, 'mention:resolved'));
    bus.on('mention.waiting_for_info', (e) => this.broadcastMentionEntity(e, 'mention:waiting_for_info'));
    bus.on('mention.woken_up', (e) => this.broadcastMentionEntity(e, 'mention:updated'));
    bus.on('mention.deleted', (e) => {
      if (e.type === 'mention.deleted') {
        this.ticketBroadcast('mention:deleted', { id: e.mentionId, ticketId: e.ticketId, commentId: e.commentId });
      }
    });

    // ── Deliverable broadcasts ──
    bus.on('deliverable.created', (e) => this.broadcastDeliverableEntity(e, 'deliverable:created'));
    bus.on('deliverable.updated', (e) => this.broadcastDeliverableEntity(e, 'deliverable:updated'));
    bus.on('deliverable.deleted', (e) => {
      if (e.type === 'deliverable.deleted') {
        this.ticketBroadcast('deliverable:deleted', { deliverableId: e.deliverableId, ticketId: e.ticketId });
      }
    });

    // ── Persona broadcasts ──
    bus.on('persona.created', (e) => this.broadcastPersonaEntity(e, 'persona:created'));
    bus.on('persona.updated', (e) => this.broadcastPersonaEntity(e, 'persona:updated'));
    bus.on('persona.deleted', (e) => {
      if (e.type === 'persona.deleted') {
        this.personaBroadcast('persona:deleted', { id: e.personaId });
      }
    });
    bus.on('persona.execution_started', (e) => {
      if (e.type === 'persona.execution_started') {
        this.personaBroadcast('persona:execution_started', {
          personaId: e.personaId,
          mentionIds: e.mentionIds,
        });
      }
    });

    // ── Skill broadcasts ──
    bus.on('skill.created', (e) => this.broadcastSkillEntity(e, 'skill:created'));
    bus.on('skill.updated', (e) => this.broadcastSkillEntity(e, 'skill:updated'));
    bus.on('skill.deleted', (e) => {
      if (e.type === 'skill.deleted') {
        this.skillBroadcast('skill:deleted', { id: e.skillId });
      }
    });

    // ── Cross-cutting: Auto-trigger agents when mentioned ──
    bus.on('mention.created', (e) => this.handleAutoTriggerAgent(e as MentionCreatedEvent));

    // ── Cross-cutting: Auto-trigger panels when mentioned ──
    bus.on('mention.created', (e) => this.handleAutoTriggerPanel(e as MentionCreatedEvent));

    // ── Cross-cutting: Auto-trigger skills when mentioned ──
    bus.on('mention.created', (e) => this.handleAutoTriggerSkill(e as MentionCreatedEvent));

    // ── Cross-cutting: Auto-trigger workflows when mentioned ──
    bus.on('mention.created', (e) => this.handleAutoTriggerWorkflow(e as MentionCreatedEvent));

    // ── Cross-cutting: Auto-review workflow ──
    bus.on('comment.posted', (e) => this.handleCommentPostedWorkflow(e as CommentPostedEvent));
    bus.on('comment.updated', (e) => this.handleCommentUpdatedWorkflow(e as CommentUpdatedEvent));
    bus.on('mention.resolved', (e) => this.handleMentionResolvedWorkflow(e as MentionResolvedEvent));
    bus.on('mention.waiting_for_info', (e) => this.handleMentionWaitingWorkflow(e as MentionWaitingForInfoEvent));
    bus.on('deliverable.created', (e) => this.handleDeliverableWorkflow(e as DeliverableCreatedEvent));
    bus.on('deliverable.updated', (e) => this.handleDeliverableUpdatedWorkflow(e as DeliverableUpdatedEvent));

    // ── Cross-cutting: Auto-resolve all mentions when ticket → done ──
    bus.on('ticket.moved', (e) => this.handleTicketMovedToDone(e as TicketMovedEvent));
    bus.on('ticket.updated', (e) => this.handleTicketUpdatedToDone(e as TicketUpdatedEvent));

    // ── Cross-cutting: Auto-generate ticket summary on close ──
    bus.on('ticket.moved', (e) => this.handleTicketClosedForSummary(e as TicketMovedEvent));
    bus.on('ticket.updated', (e) => this.handleTicketUpdatedClosedForSummary(e as TicketUpdatedEvent));

    // ── Cross-cutting: Wake waiting agents on new content ──
    bus.on('comment.posted', (e) => this.handleWakeWaitingOnComment(e as CommentPostedEvent));
    bus.on('deliverable.created', (e) => this.handleWakeWaitingOnDeliverable(e as DeliverableCreatedEvent));

    // ── Cross-cutting: Auto-resolve human mentions when human posts ──
    bus.on('comment.posted', (e) => this.handleAutoResolveHumanMentions(e as CommentPostedEvent));

    // Error handling
    bus.onError((event, error) => {
      this.deps.logger.error('Domain event handler failed', {
        eventType: event.type,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  // ── Auto-trigger agent execution ──

  private async handleAutoTriggerAgent(event: MentionCreatedEvent): Promise<void> {
    if (event.targetType !== 'agent') return;

    const persona = await this.deps.personaStore.getByName(event.targetAgent);
    if (persona) {
      this.deps.executeAgent.execute(persona.id).catch(() => {});
    }
  }

  // ── Auto-trigger panel execution ──

  private async handleAutoTriggerPanel(event: MentionCreatedEvent): Promise<void> {
    if (event.targetType !== 'panel') return;

    this.deps.runPanel.execute({
      panelName: event.targetAgent,
      ticketId: event.ticketId,
      mentionId: event.mentionId,
    }).catch((err) => {
      this.deps.logger.error('Panel auto-trigger failed', {
        panelName: event.targetAgent,
        ticketId: event.ticketId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  // ── Auto-trigger skill execution ──

  private async handleAutoTriggerSkill(event: MentionCreatedEvent): Promise<void> {
    if (event.targetType !== 'skill') return;

    const skill = await this.deps.skillStore.getByCommandName(event.targetAgent);
    if (!skill || !skill.enabled) {
      // Unknown or disabled skill — resolve silently
      const mention = await this.deps.mentionStore.getById(event.mentionId);
      if (mention && mention.status !== 'resolved') {
        mention.resolve();
        await this.deps.mentionStore.save(mention);
        this.ticketBroadcast('mention:resolved', mention.toDTO());
      }
      return;
    }

    // Load the comment to extract arguments (body text minus @skill:xxx mentions)
    const mention = await this.deps.mentionStore.getById(event.mentionId);
    if (!mention) return;

    const comment = await this.deps.commentStore.getById(mention.commentId);
    const commentBody = comment
      ? comment.body.replace(/@skill:[a-zA-Z0-9_-]+/g, '').trim()
      : '';

    this.deps.executeAgent.executeForSkill(skill.id, event.ticketId, {
      commentBody: commentBody || undefined,
      mentionId: event.mentionId,
    }).catch((err) => {
      this.deps.logger.error('Skill auto-trigger failed', {
        skillName: event.targetAgent,
        ticketId: event.ticketId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  // ── Auto-trigger workflow run ──

  private async handleAutoTriggerWorkflow(event: MentionCreatedEvent): Promise<void> {
    if (event.targetType !== 'workflow') return;

    // workflow stores may be null on unsupported adapters
    if (!this.deps.workflowTemplateStore || !this.deps.createWorkflowRun) {
      this.deps.logger.warn('Workflow mention received but workflow stores not configured', {
        slug: event.targetAgent, ticketId: event.ticketId,
      });
      return;
    }

    const template = await this.deps.workflowTemplateStore.getBySlug(event.targetAgent);
    if (!template || !template.enabled) {
      // Unknown or disabled template — resolve silently like skills do
      const mention = await this.deps.mentionStore.getById(event.mentionId);
      if (mention && mention.status !== 'resolved') {
        mention.resolve();
        await this.deps.mentionStore.save(mention);
      }
      return;
    }

    // Fire and forget — create the workflow run
    this.deps.createWorkflowRun.execute({
      ticketId: event.ticketId,
      templateId: template.id,
      triggeredBy: event.sourceAgent,
      triggeredFrom: `mention:${event.mentionId}`,
    }).then(async () => {
      // Resolve the mention after the run is created
      const mention = await this.deps.mentionStore.getById(event.mentionId);
      if (mention && mention.status !== 'resolved') {
        mention.resolve();
        await this.deps.mentionStore.save(mention);
      }
    }).catch((err) => {
      this.deps.logger.error('Workflow auto-trigger failed', {
        slug: event.targetAgent, ticketId: event.ticketId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  // ── Comment posted workflow: handle mentions for auto-review ──

  private async handleCommentPostedWorkflow(event: CommentPostedEvent): Promise<void> {
    for (const m of event.createdMentions) {
      if (m.targetType === 'human') {
        await this.deps.autoReviewWorkflow.handleHumanMention({
          ticketId: event.ticketId,
          mentionedHuman: m.targetAgent,
        });
      }
      if (m.targetType === 'agent') {
        await this.deps.autoReviewWorkflow.handleAgentMentionInReview({
          ticketId: event.ticketId,
          mentionedAgent: m.targetAgent,
        });
      }
    }
  }

  // ── Comment updated workflow: handle new mentions for auto-review ──

  private async handleCommentUpdatedWorkflow(event: CommentUpdatedEvent): Promise<void> {
    for (const m of event.createdMentions) {
      if (m.targetType === 'human') {
        await this.deps.autoReviewWorkflow.handleHumanMention({
          ticketId: event.ticketId,
          mentionedHuman: m.targetAgent,
        });
      }
      if (m.targetType === 'agent') {
        await this.deps.autoReviewWorkflow.handleAgentMentionInReview({
          ticketId: event.ticketId,
          mentionedAgent: m.targetAgent,
        });
      }
    }
  }

  // ── Mention resolved → agent work completion ──

  private async handleMentionResolvedWorkflow(event: MentionResolvedEvent): Promise<void> {
    await this.deps.autoReviewWorkflow.handleAgentWorkCompletion({
      ticketId: event.ticketId,
      completedAgentName: event.resolvedBy,
    });
  }

  // ── Mention waiting for info → auto-block ──

  private async handleMentionWaitingWorkflow(event: MentionWaitingForInfoEvent): Promise<void> {
    await this.deps.autoReviewWorkflow.handleMentionWaitingForInfo({
      ticketId: event.ticketId,
      agentName: event.targetAgent,
    });
  }

  // ── Deliverable created → auto-review if final ──

  private async handleDeliverableWorkflow(event: DeliverableCreatedEvent): Promise<void> {
    await this.deps.autoReviewWorkflow.handleDeliverableCreated({
      ticketId: event.ticketId,
      agentName: event.agentName,
      status: event.status,
    });
  }

  // ── Deliverable updated → auto-review if status changed to final ──

  private async handleDeliverableUpdatedWorkflow(event: DeliverableUpdatedEvent): Promise<void> {
    if (event.oldStatus !== 'final' && event.newStatus === 'final') {
      await this.deps.autoReviewWorkflow.handleDeliverableCreated({
        ticketId: event.ticketId,
        agentName: event.agentName,
        status: 'final',
      });
    }
  }

  // ── Ticket moved to done → auto-resolve all mentions ──

  private async handleTicketMovedToDone(event: TicketMovedEvent): Promise<void> {
    if (event.toStatus === 'done') {
      await this.deps.autoReviewWorkflow.handleTicketDone({ ticketId: event.ticketId });
    }
  }

  private async handleTicketUpdatedToDone(event: TicketUpdatedEvent): Promise<void> {
    if (event.changes['status'] && event.changes['status'].to === 'done') {
      await this.deps.autoReviewWorkflow.handleTicketDone({ ticketId: event.ticketId });
    }
  }

  // ── Wake waiting agents on new content ──

  private async handleWakeWaitingOnComment(event: CommentPostedEvent): Promise<void> {
    const excludeAgent = event.authorType === 'agent' ? event.authorName : undefined;
    await this.deps.wakeWaitingAgents.execute(event.ticketId, excludeAgent, event.executionMode);
  }

  private async handleWakeWaitingOnDeliverable(event: DeliverableCreatedEvent): Promise<void> {
    await this.deps.wakeWaitingAgents.execute(event.ticketId, event.agentName);
  }

  // ── Auto-generate ticket summary on close ──

  private handleTicketClosedForSummary(event: TicketMovedEvent): void {
    if (event.toStatus === 'done' || event.toStatus === 'cancelled') {
      this.deps.generateTicketSummary.execute({
        ticketId: event.ticketId,
        status: event.toStatus as 'done' | 'cancelled',
      }).catch((err) => {
        this.deps.logger.error('Ticket summary generation failed', {
          ticketId: event.ticketId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  }

  private handleTicketUpdatedClosedForSummary(event: TicketUpdatedEvent): void {
    const statusChange = event.changes['status'];
    if (statusChange && (statusChange.to === 'done' || statusChange.to === 'cancelled')) {
      this.deps.generateTicketSummary.execute({
        ticketId: event.ticketId,
        status: statusChange.to as 'done' | 'cancelled',
      }).catch((err) => {
        this.deps.logger.error('Ticket summary generation failed', {
          ticketId: event.ticketId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  }

  // ── Auto-resolve human mentions when human posts ──

  private async handleAutoResolveHumanMentions(event: CommentPostedEvent): Promise<void> {
    if (event.authorType === 'user') {
      await this.deps.autoReviewWorkflow.handleHumanCommentPosted({ ticketId: event.ticketId });
    }
  }

  // ── Entity broadcast helpers ──
  // These load the full entity from the store to broadcast the latest DTO.

  private async broadcastTicketEntity(event: AnyDomainEvent, wsType: string): Promise<void> {
    if (!('ticketId' in event)) return;
    const ticket = await this.deps.ticketStore.getTicketById((event as { ticketId: string }).ticketId);
    if (ticket) this.ticketBroadcast(wsType, ticket.toDTO());
  }

  private async broadcastBoardEntity(event: AnyDomainEvent, wsType: string): Promise<void> {
    if (!('boardId' in event)) return;
    const board = await this.deps.ticketStore.getBoardById((event as { boardId: string }).boardId);
    if (board) this.ticketBroadcast(wsType, board.toDTO());
  }

  private async broadcastCommentEntity(event: AnyDomainEvent, wsType: string): Promise<void> {
    if (!('commentId' in event)) return;
    const comment = await this.deps.commentStore.getById((event as { commentId: string }).commentId);
    if (comment) this.ticketBroadcast(wsType, comment.toDTO());
  }

  private async broadcastMentionEntity(event: AnyDomainEvent, wsType: string): Promise<void> {
    if (!('mentionId' in event)) return;
    const mention = await this.deps.mentionStore.getById((event as { mentionId: string }).mentionId);
    if (mention) this.ticketBroadcast(wsType, mention.toDTO());
  }

  private async broadcastDeliverableEntity(event: AnyDomainEvent, wsType: string): Promise<void> {
    if (!('deliverableId' in event)) return;
    const deliverable = await this.deps.deliverableStore.getById((event as { deliverableId: string }).deliverableId);
    if (deliverable) this.ticketBroadcast(wsType, deliverable.toDTO());
  }

  private async broadcastPersonaEntity(event: AnyDomainEvent, wsType: string): Promise<void> {
    if (!('personaId' in event)) return;
    const persona = await this.deps.personaStore.getById((event as { personaId: string }).personaId);
    if (persona) this.personaBroadcast(wsType, persona.toDTO());
  }

  private async broadcastSkillEntity(event: AnyDomainEvent, wsType: string): Promise<void> {
    if (!('skillId' in event)) return;
    const skill = await this.deps.skillStore.getById((event as { skillId: string }).skillId);
    if (skill) this.skillBroadcast(wsType, skill.toDTO());
  }
}
