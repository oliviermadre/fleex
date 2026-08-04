import type { TicketStatus } from '@fleex/shared';
import type { TicketEntity } from '../../../domain/entities/ticket.entity.js';
import type { CreateTicketInput } from '../../use-cases/create-ticket.js';
import type { TicketFieldPatch, TicketMutationActor } from '../../use-cases/apply-ticket-mutation.js';
import type { PostCommentUseCase } from '../../use-cases/post-comment.js';
import type { EventBus } from '../../event-bus.js';

/**
 * What an operation *declares* it wants done. Planning is separate from
 * execution so the use-case can validate everything, merge the field patches
 * and apply them in a single write.
 */
export type OpPlan =
  /** Creates the step's subject. Only valid as the first action. */
  | { kind: 'create'; input: Omit<CreateTicketInput, 'actor'> }
  /** Status change — always via `moveTo()`, never folded into a field patch. */
  | { kind: 'move'; status: TicketStatus }
  /** Merged with the other field patches into one `update()`. */
  | { kind: 'field'; patch: TicketFieldPatch }
  /** Runs after the single write; not covered by its atomicity. */
  | { kind: 'effect'; run: (ctx: NativeEffectContext) => Promise<Record<string, unknown>> };

/**
 * Spawns a child workflow run — the port behind `workflow.trigger`.
 *
 * Injected as a function rather than the use-case itself because the dependency
 * is circular: `CreateWorkflowRun` → orchestrator → step executors →
 * `NativeStepExecutor` → `ApplyNativeActions` → back here. The container binds
 * it lazily, once both ends exist.
 */
export type TriggerWorkflowRunPort = (params: {
  templateSlug: string;
  ticketId: string;
  triggeredBy: string;
  /** The run that asked for this one — bounds recursion. */
  parentRunId: string | null;
}) => Promise<{ id: string }>;

export interface NativeEffectContext {
  /**
   * The step's subject — the run's ticket, or the one `ticket.create` just made.
   * Null in a routine run that created nothing; only operations declaring
   * `requiresSubjectTicket: false` ever see that.
   */
  ticketId: string | null;
  /** The run the step belongs to, so a child run can record its parent. */
  workflowRunId: string | null;
  actor: TicketMutationActor & { workflowName: string };
  /**
   * `eventBus` is what makes an effect observable while it happens: persisting a
   * comment is not enough, the WebSocket push is driven by the emitted event.
   */
  deps: {
    postComment: PostCommentUseCase;
    eventBus: EventBus;
    /** Absent on storage drivers with no workflow engine (json / pgsql). */
    triggerWorkflowRun?: TriggerWorkflowRunPort | null;
  };
}

export interface NativeOperationPlanInput {
  params: Record<string, unknown>;
  /**
   * Snapshot of the subject, read once by the use-case. Lets read-modify-write
   * operations (add tags, append description) stay pure `field` plans instead
   * of becoming effects with their own read — which is what preserves the
   * one-read/one-write guarantee.
   */
  ticket: TicketEntity | null;
}

export interface NativeOperationImpl {
  id: string;
  plan(input: NativeOperationPlanInput): OpPlan;
}
