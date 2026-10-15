import type { FastifyInstance } from 'fastify';
import type { Container } from '../container.js';

type Deps = Pick<Container, 'agentEventStore' | 'executeAgent'>;

/**
 * Agent execution management routes: terminate runs manually, manage execution state.
 */
export function agentExecutionRoutes(container: Deps) {
  return async function (app: FastifyInstance) {
    /**
     * Manually terminate a run.
     * Sets manually_terminated_by_user flag and status to 'interrupted'.
     * Used when user wants to stop a run that's in progress.
     *
     * POST /api/executions/:executionId/terminate-manual
     * Body: { reason?: string } (optional, for logging)
     *
     * Response: { accepted: true, execution: AgentExecution }
     */
    app.post<{ Params: { executionId: string }; Body: { reason?: string } }>(
      '/api/executions/:executionId/terminate-manual',
      async (request, reply) => {
        const { executionId } = request.params;

        // Flag first: cancelling fails the mention, which wakes the assistant, and it
        // must already see manually_terminated_by_user to leave the run alone.
        await container.agentEventStore.updateExecutionsByIds(
          [executionId],
          'interrupted',
          { manuallyTerminatedByUser: true }
        );
        // Then actually stop the agent process (no-op if the run already ended).
        await container.executeAgent.cancelExecution(executionId).catch(() => false);

        return reply.code(200).send({ accepted: true, executionId });
      }
    );
  };
}
