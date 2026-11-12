import type { FastifyInstance } from 'fastify';
import type { TodoActor, TodoCreateInput, TodoUpdateInput } from '../../application/use-cases/ticket-todos.js';
import { isTodoAgentAccessEnabled } from '../../application/ports/config.port.js';
import { ForbiddenError } from '../../domain/errors.js';
import type { Container } from '../container.js';

type ActorRequest = { headers: Record<string, string | string[] | undefined>; agent?: { name: string } };
type ActorOf = (request: ActorRequest) => TodoActor;

/** Worded for the agent that hits it: stop, don't look for a way around. */
export const TODO_AGENTS_OFF =
  'the ticket todo list is turned off for agents in this workspace — leave it and carry on without it';

/**
 * The ticket todo list routes, mounted twice: under `/api` for the web and the
 * CLI/MCP (actor from the `x-fleex-actor-*` headers, see resolveTodoActor),
 * and under `/api/agents/v1` for token-authenticated agents (actor = the
 * token's agent, source `agent-api`). `:itemId` takes the item UUID or its
 * per-ticket ref (`3` or `#3`).
 */
export function registerTodoRoutes(app: FastifyInstance, container: Container, actorOf: ActorOf, prefix = '') {
  /**
   * The actor of the call — refused (403), reads included, when it is an agent
   * run and todo access is off for agents. The human always passes; the
   * assistant's CLI calls declare it as an agent, so it follows the setting.
   */
  const gate = (request: ActorRequest): TodoActor => {
    const actor = actorOf(request);
    if (actor.type === 'agent' && !isTodoAgentAccessEnabled(container.config.get())) throw new ForbiddenError(TODO_AGENTS_OFF);
    return actor;
  };

  app.get<{ Params: { id: string } }>(`${prefix}/tickets/:id/todos`, async (request) => {
    gate(request);
    const items = await container.ticketTodos.list(request.params.id);
    return items.map((i) => i.toDTO());
  });

  app.get<{ Params: { id: string }; Querystring: { itemId?: string } }>(
    `${prefix}/tickets/:id/todos/events`,
    async (request) => {
      gate(request);
      return container.ticketTodos.history(request.params.id, request.query.itemId);
    },
  );

  app.post<{ Params: { id: string }; Body: Partial<TodoCreateInput> }>(`${prefix}/tickets/:id/todos`, async (request, reply) => {
    const body = request.body ?? {};
    const result = await container.ticketTodos.create(
      request.params.id,
      { text: body.text ?? '', note: body.note, after: body.after, assignee: body.assignee },
      gate(request),
    );
    return reply.code(201).send(result);
  });

  app.patch<{ Params: { id: string; itemId: string }; Body: TodoUpdateInput }>(
    `${prefix}/tickets/:id/todos/:itemId`,
    async (request) => container.ticketTodos.update(request.params.id, request.params.itemId, request.body ?? {}, gate(request)),
  );

  app.delete<{ Params: { id: string; itemId: string } }>(
    `${prefix}/tickets/:id/todos/:itemId`,
    async (request) => container.ticketTodos.remove(request.params.id, request.params.itemId, gate(request)),
  );
}
