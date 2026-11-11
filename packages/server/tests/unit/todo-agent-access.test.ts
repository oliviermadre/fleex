import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { registerTodoRoutes, TODO_AGENTS_OFF } from '../../src/infrastructure/http/todos.routes.js';
import { agentTodosRoutes } from '../../src/infrastructure/http/agent-todos.routes.js';
import { registerErrorHandler } from '../../src/infrastructure/http/error-handler.js';
import { resolveTodoActor } from '../../src/infrastructure/http/todo-actor.js';
import { isTodoAgentAccessEnabled } from '../../src/application/ports/config.port.js';
import { ExecuteAgentUseCase } from '../../src/application/use-cases/execute-agent.js';
import type { Container } from '../../src/infrastructure/container.js';

/**
 * The "agents see the todo" switch (Settings › General, `todoAgentAccess`).
 *
 * Why it matters: the human's daily workflows must not start reading and
 * rewriting the todo just because it exists. Off — the default — an agent run
 * is never told about it, and whatever it discovers on its own (`--help`, MCP
 * tool list) is refused by the server. The human keeps full use of it; the
 * assistant declares itself as an agent on its CLI calls and follows the switch.
 */

const AGENT = { 'x-fleex-actor-type': 'agent', 'x-fleex-actor-name': 'Builder', 'x-fleex-actor-persona': 'builder', 'x-fleex-source': 'cli' };

function app(todoAgentAccess: boolean | undefined) {
  const ticketTodos = {
    list: vi.fn(async () => []),
    history: vi.fn(async () => []),
    create: vi.fn(async () => ({ item: null })),
    update: vi.fn(async () => ({ item: null })),
    remove: vi.fn(async () => ({ item: null })),
  };
  const container = { config: { get: () => ({ todoAgentAccess }) }, ticketTodos } as unknown as Container;
  const server = Fastify();
  registerErrorHandler(server);
  registerTodoRoutes(server, container, (r) => resolveTodoActor(r.headers, 'nas'), '/api');
  server.decorateRequest('agent', null);
  server.addHook('onRequest', async (req) => {
    (req as unknown as { agent: { name: string } }).agent = { name: 'Builder' };
  });
  void server.register(agentTodosRoutes(container), { prefix: '/api/agents/v1' });
  return { server, ticketTodos };
}

const CALLS = [
  { method: 'GET', url: '/api/tickets/t1/todos' },
  { method: 'GET', url: '/api/tickets/t1/todos/events' },
  { method: 'POST', url: '/api/tickets/t1/todos', payload: { text: 'x' } },
  { method: 'PATCH', url: '/api/tickets/t1/todos/1', payload: { state: 'done' } },
  { method: 'DELETE', url: '/api/tickets/t1/todos/1' },
] as const;

describe('todoAgentAccess — default', () => {
  it('is off unless explicitly turned on: merging the todo must not change existing workflows', () => {
    expect(isTodoAgentAccessEnabled({})).toBe(false);
    expect(isTodoAgentAccessEnabled({ todoAgentAccess: false })).toBe(false);
    expect(isTodoAgentAccessEnabled({ todoAgentAccess: true })).toBe(true);
  });
});

describe('todo routes while access is off for agents', () => {
  it.each(CALLS)('refuses an agent run, reads included: $method $url', async (call) => {
    const { server, ticketTodos } = app(undefined);
    const res = await server.inject({ ...call, headers: AGENT });
    expect(res.statusCode).toBe(403);
    expect(res.body).toContain(TODO_AGENTS_OFF);
    // Nothing reached the use-case: no read leaks, no write lands.
    for (const fn of Object.values(ticketTodos)) expect(fn).not.toHaveBeenCalled();
  });

  it('refuses a token-authenticated agent on the agent API too', async () => {
    const { server } = app(false);
    const res = await server.inject({ method: 'GET', url: '/api/agents/v1/tickets/t1/todos' });
    expect(res.statusCode).toBe(403);
  });

  it.each(CALLS)('lets the human and the assistant through (no agent header): $method $url', async (call) => {
    const { server } = app(undefined);
    const res = await server.inject({ ...call, headers: { 'x-fleex-source': 'mcp' } });
    expect(res.statusCode).toBeLessThan(300);
  });
});

describe('todo routes once access is on', () => {
  it.each(CALLS)('serves an agent run as before: $method $url', async (call) => {
    const { server } = app(true);
    const res = await server.inject({ ...call, headers: AGENT });
    expect(res.statusCode).toBeLessThan(300);
  });
});

describe('agent prompt — the todo section and hint', () => {
  const compose = (todoAgentAccess: boolean | undefined) => {
    const useCase = Object.create(ExecuteAgentUseCase.prototype) as Record<string, unknown>;
    useCase['config'] = { get: () => ({ todoAgentAccess }) };
    const written: string[] = [];
    const composer = { scaffold: (t: string) => written.push(t), track: (_: unknown, t: string) => written.push(t) };
    const context = {
      ticket: { id: 't1', displayId: 42 },
      todos: [{ ref: 1, text: 'Write the migration', state: 'open', assignee: null, createdByName: 'Catalyst', stateChangedByName: null }],
    };
    (useCase['composeTodos'] as (...a: unknown[]) => void).call(useCase, composer, context, 'builder');
    return written.join('');
  };

  it('says nothing about the todo while access is off — the run never hears of it', () => {
    expect(compose(undefined)).toBe('');
    expect(compose(false)).toBe('');
  });

  it('injects the list and the hint once access is on', () => {
    const out = compose(true);
    expect(out).toContain('## Todo list');
    expect(out).toContain('#1 Write the migration');
    expect(out).toContain('fleex ticket todo --help');
  });
});
