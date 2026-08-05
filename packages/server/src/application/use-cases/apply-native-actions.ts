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
import type {
  OpPlan, NativeEffectContext, TriggerWorkflowRunPort,
} from '../services/native-operations/types.js';
import {
  resolveParams,
  hasPendingCreatedReference,
  type RuntimeReferenceContext,
} from '../services/native-operations/resolve-references.js';
import type { CreateTicketUseCase } from './create-ticket.js';
import {
  type ApplyTicketMutationUseCase,
  type TicketFieldPatch,
  type TicketMutationActor,
} from './apply-ticket-mutation.js';
import type { PostCommentUseCase } from './post-comment.js';
import type { EventBus } from '../event-bus.js';

export interface ApplyNativeActionsInput {
  /**
   * The run's subject ticket. Ignored when the step starts with `ticket.create`,
   * and absent entirely in a routine run — which is legal only for operations
   * declaring `requiresSubjectTicket: false`.
   */
  ticketId?: string | null;
  /**
   * Board the routine's subject points at. Last fallback for `ticket.create`,
   * whose `{{ ticket.boardId }}` default resolves to nothing without a ticket.
   */
  subjectBoardId?: string | null;
  /** The run, so a `workflow.trigger` child can record which run spawned it. */
  workflowRunId?: string | null;
  /** Names the step in errors — an author needs to know which node to fix. */
  stepName?: string;
  actions: NativeAction[];
  workflowName: string;
  references: {
    steps: Record<string, Record<string, unknown>>;
    predecessorStepIds: string[];
    /** One element of a `forEach` fan-out. Absent when the step does not iterate. */
    item?: unknown;
  };
}

export interface ApplyNativeActionsResult {
  /** Null when the step ran without a subject and created nothing. */
  ticketId: string | null;
  actionsApplied: number;
  changed: string[];
  createdTicketId?: string;
  createdTicketDisplayId?: number;
  /** Runs spawned by `workflow.trigger`, in action order. */
  triggeredRunIds?: string[];
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
      eventBus: EventBus;
      /** Lazily bound by the container — see `TriggerWorkflowRunPort`. */
      triggerWorkflowRun?: TriggerWorkflowRunPort | null;
    },
  ) {}

  async execute(input: ApplyNativeActionsInput): Promise<ApplyNativeActionsResult> {
    const { actions } = input;
    if (actions.length === 0) throw new Error('native step: must have at least one action');

    const actor: TicketMutationActor = { ...NATIVE_ACTOR, actorName: input.workflowName };
    const where = `native step${input.stepName ? ` "${input.stepName}"` : ''}`;

    // ── 1. Read the subject once (also feeds `{{ ticket.* }}`) ────────────────
    // A routine run has no subject at all; that is not an error here, only for
    // the operations that actually need one (checked at plan time below).
    const subjectTicket = input.ticketId
      ? await this.deps.ticketStore.getTicketById(input.ticketId)
      : null;
    if (input.ticketId && !subjectTicket) throw new TicketNotFoundError(input.ticketId);

    const refCtx: RuntimeReferenceContext = {
      steps: input.references.steps,
      ticket: subjectTicket ? ticketReferenceFields(subjectTicket) : null,
      workflowName: input.workflowName,
      predecessorStepIds: input.references.predecessorStepIds,
      ...('item' in input.references ? { item: input.references.item } : {}),
      created: null,
    };

    // ── 2. Resolve + validate every action before touching anything ──────────
    // Pass 1. `{{ created.* }}` is the one reference that cannot be answered yet
    // (the ticket does not exist), so it is left as raw text on the actions that
    // follow the create; everything else still fails fast, right here, before
    // anything is written. Pass 2 below finishes those actions off.
    const resolved = actions.map((action) => {
      const descriptor = getNativeOperation(action.operationId);
      const impl = this.deps.registry.get(action.operationId);
      if (!descriptor || !impl) {
        throw new Error(`${where}: unknown operation "${action.operationId}"`);
      }
      // The create itself may not reference what it is about to create, so it
      // gets no tolerance and fails loudly instead of writing a literal
      // "{{ created.id }}" into a ticket title.
      const isCreate = action.operationId === NATIVE_OP_CREATE_TICKET;
      const params = resolveParams(action.params ?? {}, refCtx, {
        tolerateCreated: !isCreate,
        droppableWithoutTicket: optionalParamNames(descriptor),
      });
      const pendingCreated = Object.entries(params)
        .filter(([, value]) => hasPendingCreatedReference(value))
        .map(([name]) => name);
      const errors = validateResolvedParams(action.operationId, params, pendingCreated);
      if (errors.length > 0) throw new Error(`${where}: ${errors.join('; ')}`);
      return { action, descriptor, impl, params, pendingCreated };
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
      throw new Error(`${where}: only one "Create ticket" action is allowed`);
    }
    const createIndex = createIndexes[0] ?? -1;
    if (createIndex > 0) {
      throw new Error(`${where}: "Create ticket" must be the first action`);
    }
    // Pass 1 let `{{ created.* }}` through as raw text on the promise that pass 2
    // would fill it in. With no create there is no pass 2, and the placeholder
    // would be written verbatim into a comment or a field — refuse instead.
    if (createIndex !== 0) {
      const orphan = resolved.find((r) => r.pendingCreated.length > 0);
      if (orphan) {
        throw new Error(
          `${where}: "${orphan.descriptor.label}" references {{ created.* }} but no ticket was created `
          + '(add a "Create ticket" action first, or remove the reference)',
        );
      }
    }

    // ── 3. Optional create — rebinds the subject for the remaining actions ───
    let subject: TicketEntity | null = subjectTicket;
    let createdTicketId: string | undefined;
    let createdTicketDisplayId: number | undefined;
    let changed: string[] = [];
    const triggeredRunIds: string[] = [];
    // Counted as things actually commit, never assumed from `actions.length`,
    // so the number stays truthful on the failure path too.
    let actionsApplied = 0;

    const progress = (): ApplyNativeActionsResult => ({
      ticketId: subject?.id ?? null,
      actionsApplied,
      changed,
      ...(createdTicketId ? { createdTicketId } : {}),
      ...(createdTicketDisplayId !== undefined ? { createdTicketDisplayId } : {}),
      ...(triggeredRunIds.length > 0 ? { triggeredRunIds } : {}),
    });

    try {
      if (createIndex === 0) {
        const first = resolved[0];
        if (!first) throw new Error(`${where}: missing create action`);
        first.params = {
          ...first.params,
          boardId: resolveCreateBoardId(first.params['boardId'], input.subjectBoardId, where),
        };
        const plan = first.impl.plan({ params: first.params, ticket: null });
        if (plan.kind !== 'create') throw new Error(`${where}: ticket.create must plan a create`);
        subject = await this.deps.createTicket.execute({ ...plan.input, actor });
        createdTicketId = subject.id;
        createdTicketDisplayId = subject.displayId;
        actionsApplied += 1;

        // Pass 2 — the create has committed, so `{{ created.* }}` is knowable.
        // Only the actions that actually deferred something are redone, and they
        // are re-validated in full: pass 1 skipped their shape check.
        refCtx.created = { id: subject.id, displayId: subject.displayId };
        for (const r of resolved) {
          if (r.pendingCreated.length === 0) continue;
          r.params = resolveParams(r.action.params ?? {}, refCtx, {
            droppableWithoutTicket: optionalParamNames(r.descriptor),
          });
          const errors = validateResolvedParams(r.action.operationId, r.params);
          if (errors.length > 0) throw new Error(`${where}: ${errors.join('; ')}`);
        }
      }

      // ── 4. Plan the remaining actions against the (possibly new) subject ───
      const rest = createIndex === 0 ? resolved.slice(1) : resolved;
      const plans: OpPlan[] = rest.map((r) => {
        if (!subject && r.descriptor.requiresSubjectTicket !== false) {
          throw new Error(
            `${where}: "${r.descriptor.label}" needs a subject ticket; a routine run has none `
            + '(start the step with a "Create ticket" action, or move this action to a ticket workflow)',
          );
        }
        return r.impl.plan({ params: r.params, ticket: subject });
      });

      let move: { status: TicketStatus } | undefined;
      let fields: TicketFieldPatch = {};
      const effects: Extract<OpPlan, { kind: 'effect' }>[] = [];

      for (const plan of plans) {
        if (plan.kind === 'move') move = { status: plan.status };
        else if (plan.kind === 'field') fields = { ...fields, ...plan.patch };
        else if (plan.kind === 'effect') effects.push(plan);
        else throw new Error(`${where}: only the first action may create a ticket`);
      }

      // ── 5. One write covering the move and every field change ─────────────
      const hasFields = Object.keys(fields).length > 0;
      if (move || hasFields) {
        if (!subject) throw new Error(`${where}: no subject ticket to write to`);
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
        ticketId: subject?.id ?? null,
        workflowRunId: input.workflowRunId ?? null,
        actor: { ...actor, workflowName: input.workflowName },
        deps: {
          postComment: this.deps.postComment,
          eventBus: this.deps.eventBus,
          triggerWorkflowRun: this.deps.triggerWorkflowRun ?? null,
        },
      };
      for (const effect of effects) {
        const outcome = await effect.run(effectCtx);
        const runId = outcome['triggeredRunId'];
        if (typeof runId === 'string') triggeredRunIds.push(runId);
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

/**
 * Params that may vanish when there is no subject ticket to read.
 *
 * A required param must never disappear — its absence has to surface as
 * "required", not as a silently different behaviour — so only optional ones are
 * droppable. `boardId` on `ticket.create` is the reason this exists: its
 * `{{ ticket.boardId }}` default is unresolvable in a routine run, and the
 * board cascade below is what should answer instead.
 */
function optionalParamNames(descriptor: { params: readonly { name: string; required: boolean }[] }) {
  return new Set(descriptor.params.filter((p) => !p.required).map((p) => p.name));
}

/**
 * Board of the ticket a step creates: explicit param, then the routine
 * subject's board, then a loud refusal.
 *
 * Defaulting to "some board" would scatter tickets into whichever board
 * happened to sort first — a mistake nobody would notice until a sprint later.
 */
function resolveCreateBoardId(
  param: unknown,
  subjectBoardId: string | null | undefined,
  where: string,
): string {
  const boardId = (typeof param === 'string' && param !== '' ? param : null) ?? subjectBoardId;
  if (!boardId) {
    throw new Error(
      `${where}: "Create ticket" has no board — this run has no subject ticket and its routine `
      + 'declares no board, so set the action\'s "Board" parameter explicitly',
    );
  }
  return boardId;
}

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
