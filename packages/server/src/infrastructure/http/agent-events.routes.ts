import type { FastifyInstance } from 'fastify';
import { AgentPersonaNotFoundError } from '../../domain/errors.js';
import type { Container } from '../container.js';

export function agentEventsRoutes(container: Container) {
  return async function (app: FastifyInstance) {
    // GET /api/personas/:id/executions — list executions for a persona
    app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
      '/api/personas/:id/executions',
      async (request) => {
        const persona = await container.personaStore.getById(request.params.id);
        if (!persona) throw new AgentPersonaNotFoundError(request.params.id);

        const limit = request.query.limit ? parseInt(request.query.limit, 10) : 50;
        return container.agentEventStore.getExecutionsByPersona(request.params.id, limit);
      },
    );

    // GET /api/tickets/:id/executions — list executions for a ticket
    app.get<{ Params: { id: string } }>(
      '/api/tickets/:id/executions',
      async (request) => {
        return container.agentEventStore.getExecutionsByTicket(request.params.id);
      },
    );

    // GET /api/executions/:id/events — get all events for an execution (historical replay)
    app.get<{ Params: { id: string } }>(
      '/api/executions/:id/events',
      async (request) => {
        const executionId = request.params.id;
        const events = await container.agentEventStore.getEventsByExecution(executionId);
        const dtos = events.map((e) => e.toDTO());

        // Backfill execution_start events that lack executionId/sdkSessionId (old events)
        for (const dto of dtos) {
          if (dto.eventType === 'execution_start' && dto.data && typeof dto.data === 'object') {
            const data = dto.data as Record<string, unknown>;
            if (!data['executionId']) {
              data['executionId'] = executionId;
            }
            if (!data['resumeSessionId']) {
              // Look up sdkSessionId from execution index
              const executions = await container.agentEventStore.getExecutionsByTicket(
                (data['ticketId'] as string) ?? '',
              );
              // Find the execution just before this one for the same persona to get the resume session
              const thisExec = executions.find((e) => e.id === executionId);
              if (thisExec?.sdkSessionId) {
                // This is the session that was obtained *during* this execution,
                // not the one it resumed from — but still useful to show
                data['sdkSessionId'] = thisExec.sdkSessionId;
              }
            }
          }
        }

        return dtos;
      },
    );
  };
}
