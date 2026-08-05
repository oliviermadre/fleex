import { NATIVE_OP_TRIGGER_WORKFLOW } from '@fleex/shared';
import type { NativeOperationImpl } from './types.js';

/**
 * Native operations that act on *workflows* rather than on a ticket.
 *
 * Kept in its own module because it is the first family whose dependency points
 * back at the workflow engine: `workflow.trigger` needs `CreateWorkflowRun`,
 * which (through the orchestrator and the step executors) already depends on
 * this very step. The cycle is cut by taking the trigger as a port on the
 * effect context, bound lazily by the container — so nothing here imports the
 * use-case, and `plan()` stays the same pure function as every ticket op.
 *
 * It is an `effect`, i.e. it runs *after* the step's single ticket write. That
 * ordering is what makes "create a ticket, then run a workflow on it" work:
 * `effectCtx.ticketId` is the subject, which `ticket.create` has already
 * rebound to the ticket it just made.
 */

const str = (v: unknown): string => (typeof v === 'string' ? v : String(v ?? ''));
const strOrNull = (v: unknown): string | null =>
  v === undefined || v === null || v === '' ? null : str(v);

export const WORKFLOW_OPERATIONS: readonly NativeOperationImpl[] = [
  {
    id: NATIVE_OP_TRIGGER_WORKFLOW,
    plan: ({ params }) => ({
      kind: 'effect',
      run: async (ctx) => {
        const trigger = ctx.deps.triggerWorkflowRun;
        if (!trigger) {
          throw new Error(
            'workflow.trigger: no workflow engine is available on this storage driver',
          );
        }

        const templateSlug = str(params['templateSlug']);
        if (!templateSlug) throw new Error('workflow.trigger: "Workflow" is required');

        // A workflow run is still anchored to something: without an explicit
        // ticket and without a subject, there is nothing to run it on. Saying so
        // beats creating an orphan run the entity would reject anyway.
        const ticketId = strOrNull(params['ticketId']) ?? ctx.ticketId;
        if (!ticketId) {
          throw new Error(
            `workflow.trigger: no ticket to run "${templateSlug}" on — this step has no subject `
            + '(add a "Create ticket" action first, or set "Ticket" explicitly)',
          );
        }

        const run = await trigger({
          templateSlug,
          ticketId,
          triggeredBy: `workflow:${ctx.actor.workflowName}`,
          parentRunId: ctx.workflowRunId,
        });
        return { triggeredRunId: run.id };
      },
    }),
  },
];
