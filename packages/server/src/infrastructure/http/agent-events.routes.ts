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
        const events = await container.agentEventStore.getEventsByExecution(request.params.id);
        return events.map((e) => e.toDTO());
      },
    );
  };
}
