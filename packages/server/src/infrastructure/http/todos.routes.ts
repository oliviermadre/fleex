import type { FastifyInstance } from 'fastify';
import type { TodoActor, TodoCreateInput, TodoUpdateInput } from '../../application/use-cases/ticket-todos.js';
import type { Container } from '../container.js';

type ActorOf = (request: { headers: Record<string, string | string[] | undefined>; agent?: { name: string } }) => TodoActor;

/**
 * The ticket todo list routes, mounted twice: under `/api` for the web and the
 * CLI/MCP (actor from the `x-fleex-actor-*` headers, see resolveTodoActor),
 * and under `/api/agents/v1` for token-authenticated agents (actor = the
 * token's agent, source `agent-api`). `:itemId` takes the item UUID or its
 * per-ticket ref (`3` or `#3`).
 */
export function registerTodoRoutes(app: FastifyInstance, container: Container, actorOf: ActorOf, prefix = '') {
  app.get<{ Params: { id: string } }>(`${prefix}/tickets/:id/todos`, async (request) => {
    const items = await container.ticketTodos.list(request.params.id);
    return items.map((i) => i.toDTO());
  });

  app.get<{ Params: { id: string }; Querystring: { itemId?: string } }>(
    `${prefix}/tickets/:id/todos/events`,
    async (request) => container.ticketTodos.history(request.params.id, request.query.itemId),
  );

  app.post<{ Params: { id: string }; Body: Partial<TodoCreateInput> }>(`${prefix}/tickets/:id/todos`, async (request, reply) => {
    const body = request.body ?? {};
    const result = await container.ticketTodos.create(
      request.params.id,
      { text: body.text ?? '', note: body.note, after: body.after, assignee: body.assignee },
      actorOf(request),
    );
    return reply.code(201).send(result);
  });

  app.patch<{ Params: { id: string; itemId: string }; Body: TodoUpdateInput }>(
    `${prefix}/tickets/:id/todos/:itemId`,
    async (request) => container.ticketTodos.update(request.params.id, request.params.itemId, request.body ?? {}, actorOf(request)),
  );

  app.delete<{ Params: { id: string; itemId: string } }>(
    `${prefix}/tickets/:id/todos/:itemId`,
    async (request) => container.ticketTodos.remove(request.params.id, request.params.itemId, actorOf(request)),
  );
}
