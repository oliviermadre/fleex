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

export interface NativeEffectContext {
  /** The step's subject — the run's ticket, or the one `ticket.create` just made. */
  ticketId: string;
  actor: TicketMutationActor & { workflowName: string };
  /**
   * `eventBus` is what makes an effect observable while it happens: persisting a
   * comment is not enough, the WebSocket push is driven by the emitted event.
   */
  deps: { postComment: PostCommentUseCase; eventBus: EventBus };
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
