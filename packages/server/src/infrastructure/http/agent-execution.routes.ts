import type { FastifyInstance } from 'fastify';
import type { Container } from '../container.js';

type Deps = Pick<Container, 'agentEventStore'>;

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

        // Update the execution with manually_terminated_by_user flag and interrupted status
        await container.agentEventStore.updateExecutionsByIds(
          [executionId],
          'interrupted',
          { manuallyTerminatedByUser: true }
        );

        return reply.code(200).send({ accepted: true, executionId });
      }
    );
  };
}
