import {
  getNativeOperation,
  validateResolvedParams,
  NATIVE_OP_CREATE_TICKET,
  type NativeAction,
} from '@fleex/shared';
import type { TicketEntity } from '../../domain/entities/ticket.entity.js';
import { TicketNotFoundError } from '../../domain/errors.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import type { NativeOperationRegistry } from '../services/native-operations/registry.js';
import type { OpPlan, NativeEffectContext } from '../services/native-operations/types.js';
import {
  resolveParams,
  type RuntimeReferenceContext,
} from '../services/native-operations/resolve-references.js';
import type { CreateTicketUseCase } from './create-ticket.js';
import {
  type ApplyTicketMutationUseCase,
  type TicketFieldPatch,
  type TicketMutationActor,
} from './apply-ticket-mutation.js';
import type { PostCommentUseCase } from './post-comment.js';

export interface ApplyNativeActionsInput {
  /** The run's subject ticket. Ignored when the step starts with `ticket.create`. */
  ticketId: string;
  actions: NativeAction[];
  workflowName: string;
  references: {
    steps: Record<string, Record<string, unknown>>;
    predecessorStepIds: string[];
  };
}

export interface ApplyNativeActionsResult {
  ticketId: string;
  actionsApplied: number;
  changed: string[];
  createdTicketId?: string;
  createdTicketDisplayId?: number;
}

/** Native steps are attributed to the workflow, not to a human. */
const NATIVE_ACTOR: Omit<TicketMutationActor, 'actorName'> = {
  actorType: 'agent',
  source: 'api',
};

/**
 * Applies a native step's ordered action list.
 *
 * Everything that can fail is checked *before* the first write: unknown
 * operations, unresolved references, invalid parameters and same-field
 * conflicts. Then the subject is read once, every field change is merged into a
 * single `update()` (with the status routed through `moveTo()`), and the ticket
 * is written once. Effects run afterwards.
 */
export class ApplyNativeActionsUseCase {
  constructor(
    private readonly deps: {
      ticketStore: TicketStorePort;
      registry: NativeOperationRegistry;
      createTicket: CreateTicketUseCase;
      applyTicketMutation: ApplyTicketMutationUseCase;
      postComment: PostCommentUseCase;
    },
  ) {}

  async execute(input: ApplyNativeActionsInput): Promise<ApplyNativeActionsResult> {
    const { actions } = input;
    if (actions.length === 0) throw new Error('native step: must have at least one action');

    const actor: TicketMutationActor = { ...NATIVE_ACTOR, actorName: input.workflowName };

    // ── 1. Read the subject once (also feeds `{{ ticket.* }}`) ────────────────
    const subjectTicket = await this.deps.ticketStore.getTicketById(input.ticketId);
    if (!subjectTicket) throw new TicketNotFoundError(input.ticketId);

    const refCtx: RuntimeReferenceContext = {
      steps: input.references.steps,
      ticket: ticketReferenceFields(subjectTicket),
      workflowName: input.workflowName,
      predecessorStepIds: input.references.predecessorStepIds,
    };

    // ── 2. Resolve + validate every action before touching anything ──────────
    const resolved = actions.map((action) => {
      const descriptor = getNativeOperation(action.operationId);
      const impl = this.deps.registry.get(action.operationId);
      if (!descriptor || !impl) {
        throw new Error(`native step: unknown operation "${action.operationId}"`);
      }
      const params = resolveParams(action.params ?? {}, refCtx);
      const errors = validateResolvedParams(action.operationId, params);
      if (errors.length > 0) throw new Error(`native step: ${errors.join('; ')}`);
      return { action, descriptor, impl, params };
    });

    assertNoFieldConflicts(resolved.map((r) => r.descriptor));

    const createIndex = resolved.findIndex((r) => r.action.operationId === NATIVE_OP_CREATE_TICKET);
    if (createIndex > 0) {
      throw new Error('native step: "Create ticket" must be the first action');
    }

    // ── 3. Optional create — rebinds the subject for the remaining actions ───
    let subject = subjectTicket;
    let createdTicketId: string | undefined;
    let createdTicketDisplayId: number | undefined;

    if (createIndex === 0) {
      const first = resolved[0];
      if (!first) throw new Error('native step: missing create action');
      const plan = first.impl.plan({ params: first.params, ticket: null });
      if (plan.kind !== 'create') throw new Error('native step: ticket.create must plan a create');
      subject = await this.deps.createTicket.execute({ ...plan.input, actor });
      createdTicketId = subject.id;
      createdTicketDisplayId = subject.displayId;
    }

    // ── 4. Plan the remaining actions against the (possibly new) subject ─────
    const rest = createIndex === 0 ? resolved.slice(1) : resolved;
    const plans: OpPlan[] = rest.map((r) => r.impl.plan({ params: r.params, ticket: subject }));

    let move: { status: TicketStatus } | undefined;
    let fields: TicketFieldPatch = {};
    const effects: Extract<OpPlan, { kind: 'effect' }>[] = [];

    for (const plan of plans) {
      if (plan.kind === 'move') move = { status: plan.status };
      else if (plan.kind === 'field') fields = { ...fields, ...plan.patch };
      else if (plan.kind === 'effect') effects.push(plan);
      else throw new Error('native step: only the first action may create a ticket');
    }

    // ── 5. One write covering the move and every field change ───────────────
    let changed: string[] = [];
    const hasFields = Object.keys(fields).length > 0;
    if (move || hasFields) {
      const result = await this.deps.applyTicketMutation.applyTo(subject, {
        move,
        fields: hasFields ? fields : undefined,
        actor,
      });
      changed = result.changed;
    }

    // ── 6. Effects — after the write, so they are not part of its atomicity ──
    const effectCtx: NativeEffectContext = {
      ticketId: subject.id,
      actor: { ...actor, workflowName: input.workflowName },
      deps: { postComment: this.deps.postComment },
    };
    for (const effect of effects) {
      await effect.run(effectCtx);
    }

    return {
      ticketId: subject.id,
      actionsApplied: actions.length,
      changed,
      ...(createdTicketId ? { createdTicketId } : {}),
      ...(createdTicketDisplayId !== undefined ? { createdTicketDisplayId } : {}),
    };
  }
}

type TicketStatus = Parameters<TicketEntity['moveTo']>[0];

function assertNoFieldConflicts(
  descriptors: { label: string; conflictsOn?: readonly string[] }[],
): void {
  const claimed = new Map<string, string>();
  for (const descriptor of descriptors) {
    for (const field of descriptor.conflictsOn ?? []) {
      const previous = claimed.get(field);
      if (previous) {
        throw new Error(
          `native step: "${previous}" and "${descriptor.label}" both write "${field}"`,
        );
      }
      claimed.set(field, descriptor.label);
    }
  }
}

/** The read-only projection exposed to `{{ ticket.* }}`. */
function ticketReferenceFields(ticket: TicketEntity): Record<string, unknown> {
  return {
    id: ticket.id,
    displayId: ticket.displayId,
    boardId: ticket.boardId,
    title: ticket.title,
    description: ticket.description,
    status: ticket.status,
    priority: ticket.priority,
    type: ticket.type,
    assignee: ticket.assignee,
    tags: ticket.tags,
  };
}
