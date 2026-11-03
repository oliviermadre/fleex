import type { FastifyInstance } from 'fastify';
import type { Container } from '../container.js';
import { registerTodoRoutes } from './todos.routes.js';

/**
 * The ticket todo list for token-authenticated agents. Same behaviour as the
 * web routes; the actor is the token's agent, source `agent-api` — so an agent
 * cannot delete an item a human created (403, enforced by the use-case).
 */
export function agentTodosRoutes(container: Container) {
  return async function (app: FastifyInstance) {
    registerTodoRoutes(app, container, (request) => ({
      type: 'agent',
      name: request.agent?.name ?? 'unknown',
      source: 'agent-api',
      // No persona header here: the token's agent name, lower-cased, stands for it.
      ...(request.agent?.name ? { persona: request.agent.name.toLowerCase() } : {}),
    }));
  };
}
