import type { FastifyInstance } from 'fastify';
import type { Container } from '../container.js';
import { stopAuthorFromHeaders } from './stop-author.js';

type Deps = Pick<Container, 'stopRun'>;

/**
 * Agent execution management routes: terminate runs manually, manage execution state.
 */
export function agentExecutionRoutes(container: Deps) {
  return async function (app: FastifyInstance) {
    /**
     * Manually terminate a run (the Stop button of a run card).
     * Goes through the single stop path with the human as author: the run is
     * marked `stoppedBy: user`, and when it drives an assistant thread the
     * thread is parked under the human's hold — the assistant is not woken and
     * may not relaunch it.
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
        // No-op when the run already ended: there is nothing left to stop.
        const outcome = await container.stopRun.stopExecution(executionId, {
          by: stopAuthorFromHeaders(request.headers),
          reason: request.body?.reason ?? null,
        });
        return reply.code(200).send({ accepted: true, executionId, stopped: outcome.stopped });
      }
    );
  };
}
