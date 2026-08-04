import type { StepExecutor, StepExecutionInput, StepExecutorResult } from './types.js';

/**
 * Runs a `route` step: a no-op whose only job is to be a place in the graph.
 *
 * It writes nothing to the ticket, spends no tokens and produces no fields. Its
 * value is entirely in its outgoing edges: because a condition may read any
 * ancestor's output, an author can converge several branches on a Router and
 * re-split them on a finer rule, instead of writing one nested boolean
 * expression per outgoing edge.
 *
 * Like `HumanGateStepExecutor` it resolves synchronously and never calls
 * `onExecutionStarted`, so no agent execution row is created.
 */
export class RouteStepExecutor implements StepExecutor {
  async execute(_input: StepExecutionInput): Promise<StepExecutorResult> {
    return { output: { schemaFields: {}, result: 'ok' } };
  }
}
