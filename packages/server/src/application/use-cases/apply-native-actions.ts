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

/**
 * Raised when a step fails *after* something already committed.
 *
 * A native step is atomic up to its single ticket write, but `ticket.create` and
 * effects sit outside that guarantee. When one of them fails, reporting
 * "0 actions applied" would describe a mutation that happened as one that did
 * not — the one failure mode a deterministic node cannot afford. So the error
 * carries what actually landed.
 */
export class NativeActionsPartialFailure extends Error {
  constructor(message: string, readonly committed: ApplyNativeActionsResult) {
    super(message);
    this.name = 'NativeActionsPartialFailure';
  }
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

    // Both checks must happen *here*, before the create below writes anything.
    // Counting rather than taking the first index is what makes that true: with
    // `[create, …, create]` the placement check alone passes, the first create
    // commits a ticket, and only then does planning reject the second — leaving
    // exactly the partial write this whole ordering exists to prevent.
    const createIndexes = resolved
      .map((r, i) => (r.action.operationId === NATIVE_OP_CREATE_TICKET ? i : -1))
      .filter((i) => i >= 0);
    if (createIndexes.length > 1) {
      throw new Error('native step: only one "Create ticket" action is allowed');
    }
    const createIndex = createIndexes[0] ?? -1;
    if (createIndex > 0) {
      throw new Error('native step: "Create ticket" must be the first action');
    }

    // ── 3. Optional create — rebinds the subject for the remaining actions ───
    let subject = subjectTicket;
    let createdTicketId: string | undefined;
    let createdTicketDisplayId: number | undefined;
    let changed: string[] = [];
    // Counted as things actually commit, never assumed from `actions.length`,
    // so the number stays truthful on the failure path too.
    let actionsApplied = 0;

    const progress = (): ApplyNativeActionsResult => ({
      ticketId: subject.id,
      actionsApplied,
      changed,
      ...(createdTicketId ? { createdTicketId } : {}),
      ...(createdTicketDisplayId !== undefined ? { createdTicketDisplayId } : {}),
    });

    try {
      if (createIndex === 0) {
        const first = resolved[0];
        if (!first) throw new Error('native step: missing create action');
        const plan = first.impl.plan({ params: first.params, ticket: null });
        if (plan.kind !== 'create') throw new Error('native step: ticket.create must plan a create');
        subject = await this.deps.createTicket.execute({ ...plan.input, actor });
        createdTicketId = subject.id;
        createdTicketDisplayId = subject.displayId;
        actionsApplied += 1;
      }

      // ── 4. Plan the remaining actions against the (possibly new) subject ───
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

      // ── 5. One write covering the move and every field change ─────────────
      const hasFields = Object.keys(fields).length > 0;
      if (move || hasFields) {
        const result = await this.deps.applyTicketMutation.applyTo(subject, {
          move,
          fields: hasFields ? fields : undefined,
          actor,
        });
        changed = result.changed;
      }
      actionsApplied += rest.length - effects.length;

      // ── 6. Effects — after the write, so they are not part of its atomicity ─
      const effectCtx: NativeEffectContext = {
        ticketId: subject.id,
        actor: { ...actor, workflowName: input.workflowName },
        deps: { postComment: this.deps.postComment },
      };
      for (const effect of effects) {
        await effect.run(effectCtx);
        actionsApplied += 1;
      }
    } catch (err) {
      // Nothing committed yet ⇒ the plain error is the whole truth. Otherwise
      // wrap it so the caller can report the mutation that did land.
      if (actionsApplied === 0) throw err;
      throw new NativeActionsPartialFailure(
        err instanceof Error ? err.message : String(err),
        progress(),
      );
    }

    return progress();
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
