import type { TicketContext, TicketContextEpic } from '@fleex/shared';
import { TicketNotFoundError } from '../../domain/errors.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import type { CommentStorePort } from '../ports/comment-store.port.js';
import type { MentionStorePort } from '../ports/mention-store.port.js';
import type { DeliverableStorePort } from '../ports/deliverable-store.port.js';
import type { TicketGroupStorePort } from '../ports/ticket-group-store.port.js';
import type { AnnotationStorePort } from '../ports/annotation-store.port.js';
import type { TodoStorePort } from '../ports/todo-store.port.js';
import type { GetRelevantSummariesUseCase } from './get-relevant-summaries.js';
import type { MemorySnippet, RetrieveContextUseCase } from './retrieve-context.js';

/** Annotation bodies are truncated in the agent context (the full text stays on the ticket). */
export const ANNOTATION_CONTEXT_BODY_MAX = 500;

/** The thread a run belongs to, and the deliverables the assistant exposed to it. */
export interface ThreadScope {
  id: string;
  deliverableIds: string[];
}

export class GetTicketContextUseCase {
  constructor(
    private readonly ticketStore: TicketStorePort,
    private readonly commentStore: CommentStorePort,
    private readonly mentionStore: MentionStorePort,
    private readonly deliverableStore: DeliverableStorePort,
    private readonly getRelevantSummaries?: GetRelevantSummariesUseCase,
    private readonly ticketGroupStore?: TicketGroupStorePort,
    /**
     * When wired, retrieval goes through the engine selector instead of calling
     * `getRelevantSummaries` directly. Optional so the many call sites that build
     * this use case for non-agentic reads stay unchanged.
     */
    private readonly retrieveContext?: RetrieveContextUseCase,
    /** Timeline annotations — what was flagged as worth remembering, and when. */
    private readonly annotationStore?: AnnotationStorePort,
    /** The ticket's shared todo list. */
    private readonly todoStore?: TodoStorePort,
  ) {}

  async execute(params: {
    ticketId: string;
    agentName: string;
    commentsLimit?: number;
    activityLimit?: number;
    /**
     * The run belongs to an assistant thread: its target is walled off from the
     * rest of the ticket. It reads the thread's own turns — not the discussion
     * between the human and the assistant, nor the other threads — and only the
     * deliverables the assistant exposed to it, plus the ones the thread produced.
     */
    thread?: ThreadScope | null;
  }): Promise<TicketContext> {
    const ticket = await this.ticketStore.getTicketById(params.ticketId);
    if (!ticket) throw new TicketNotFoundError(params.ticketId);

    const commentsLimit = params.commentsLimit ?? 50;
    const activityLimit = params.activityLimit ?? 20;

    // Get comments visible to this agent (public + private where agent is recipient)
    const allComments = await this.commentStore.getByTicket(params.ticketId);
    const scope = params.thread ?? null;
    const visibleComments = allComments
      .filter((c) => c.isVisibleTo(params.agentName))
      .filter((c) => !scope || c.threadId === scope.id)
      .slice(-commentsLimit);
    // Every turn of the thread, not only the last ones shown: a deliverable of an early turn is still the thread's.
    const threadCommentIds = scope ? new Set(allComments.filter((c) => c.threadId === scope.id).map((c) => c.id)) : null;

    // Get mentions
    const allMentions = (await this.mentionStore.getByTicket(params.ticketId))
      .filter((m) => !threadCommentIds || threadCommentIds.has(m.commentId));
    const pendingMentions = allMentions.filter(
      (m) => m.targetAgent === params.agentName && m.status !== 'resolved',
    );

    // Get deliverables
    const threadMentionIds = new Set(allMentions.map((m) => m.id));
    const shared = new Set(scope?.deliverableIds ?? []);
    const deliverables = (await this.deliverableStore.getByTicket(params.ticketId))
      .filter((d) => !scope || shared.has(d.id) || (d.mentionId != null && threadMentionIds.has(d.mentionId)));

    // Timeline annotations: the body is cut so a long one can't crowd the prompt.
    // Annotations are pinned from the main discussion: a thread does not get them.
    const annotations = this.annotationStore && !scope
      ? (await this.annotationStore.listByTicket(params.ticketId).catch(() => [])).map((a) => {
          const dto = a.toDTO();
          return dto.body.length > ANNOTATION_CONTEXT_BODY_MAX
            ? { ...dto, body: `${dto.body.slice(0, ANNOTATION_CONTEXT_BODY_MAX)}…` }
            : dto;
        })
      : [];

    // Shared todo list (live items, display order). A failure must not sink the run.
    const todos = this.todoStore
      ? (await this.todoStore.listItems(params.ticketId).catch(() => [])).map((i) => i.toDTO())
      : [];

    // Get activity
    const activity = await this.ticketStore.getActivitiesByTicket(params.ticketId, activityLimit);

    // Retrieve context from past work: through the engine selector when wired,
    // otherwise the tag-and-recency ranking directly.
    let relevantSummaries: Awaited<ReturnType<GetRelevantSummariesUseCase['execute']>> = [];
    let memorySnippets: MemorySnippet[] = [];
    let memoryEngine: 'legacy' | 'semantic' | undefined;
    let shadowSnippets: MemorySnippet[] | undefined;
    if (this.retrieveContext) {
      try {
        const retrieved = await this.retrieveContext.execute({ ticketId: params.ticketId });
        relevantSummaries = retrieved.summaries;
        memorySnippets = retrieved.snippets;
        memoryEngine = retrieved.engine;
        shadowSnippets = retrieved.shadowSnippets;
      } catch {
        // Non-critical — proceed without retrieved context
      }
    } else if (this.getRelevantSummaries) {
      try {
        relevantSummaries = await this.getRelevantSummaries.execute({ ticketId: params.ticketId });
      } catch {
        // Non-critical — proceed without summaries
      }
    }

    // Get epics this ticket belongs to
    let epics: TicketContextEpic[] = [];
    if (this.ticketGroupStore) {
      try {
        const memberships = await this.ticketGroupStore.getMembershipsByTicket(params.ticketId);
        const groups = await Promise.all(
          memberships.map((m) => this.ticketGroupStore!.getTicketGroupById(m.groupId)),
        );
        epics = groups
          .filter(Boolean)
          .map((g) => ({
            name: g!.name,
            emoji: g!.emoji,
            description: g!.description,
            timeframe: g!.timeframe,
            groupStatus: g!.groupStatus,
          }));
      } catch {
        // Non-critical — proceed without epics
      }
    }

    return {
      ticket: ticket.toDTO(),
      comments: visibleComments.map((c) => c.toDTO()),
      mentions: {
        pending: pendingMentions.map((m) => m.toDTO()),
        all: allMentions.map((m) => m.toDTO()),
      },
      deliverables: deliverables.map((d) => d.toDTO()),
      annotations,
      todos,
      activity: activity.map((a) => a.toDTO()),
      relevantSummaries,
      epics,
      memorySnippets,
      memoryEngine,
      shadowSnippets,
    };
  }
}
