/**
 * Integration — the assistant on the ticket todo (lot 4), through a real
 * SQLite database, the real todo use case, the real HTTP routes and the real
 * CLI header builder. Runs under Bun only (`bun run test:bun`).
 *
 * The chain under test: the identity `runCli` puts in the CLI's environment
 * (`cliInvocation`) → the headers the CLI sends (`actorHeaders`) → the actor
 * the server resolves → the existing protections and the history. Only the
 * process spawn and the HTTP socket are skipped (`inject`).
 *
 * Why it matters: an orchestrator that ticks the human's QA item, or whose
 * changes are signed by the human, makes the todo unreadable as a record of
 * who did what.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { SqliteConnection } from '../../src/infrastructure/adapters/sqlite/connection.js';
import { SqliteTodoStoreAdapter } from '../../src/infrastructure/adapters/sqlite/sqlite-todo-store.adapter.js';
import { runPendingMigrations } from '../../src/infrastructure/migrations/run-migrations.js';
import { TicketTodosUseCase } from '../../src/application/use-cases/ticket-todos.js';
import { registerTodoRoutes, TODO_AGENTS_OFF } from '../../src/infrastructure/http/todos.routes.js';
import { registerErrorHandler } from '../../src/infrastructure/http/error-handler.js';
import { resolveTodoActor } from '../../src/infrastructure/http/todo-actor.js';
import { cliInvocation } from '../../src/application/assistant/assistant-environment.js';
import { actorHeaders } from '../../../cli/src/core/actor.js';
import type { TicketStorePort } from '../../src/application/ports/ticket-store.port.js';
import type { Container } from '../../src/infrastructure/container.js';

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const HUMAN = 'olivier';

/** The headers the CLI sends when `runCli` runs it as the assistant « Nas » (slug `nas`). */
function assistantHeaders(): Record<string, string> {
  const { args } = cliInvocation('/opt/fleex', ['ticket', 'todo'], { name: 'Nas', persona: 'nas' });
  const env: Record<string, string> = {};
  for (const a of args) {
    if (!a.startsWith('FLEEX_')) break;
    env[a.slice(0, a.indexOf('='))] = a.slice(a.indexOf('=') + 1);
  }
  return actorHeaders(env);
}

let conn: SqliteConnection;
let server: FastifyInstance;
let todoAgentAccess: boolean;

beforeEach(async () => {
  conn = new SqliteConnection(':memory:');
  await conn.init();
  await runPendingMigrations('sqlite', conn, silent as never);
  conn.db.exec(`
    INSERT INTO boards (id, name, emoji, created_at, updated_at)
    VALUES ('b-1', 'Board', '', datetime('now'), datetime('now'));
    INSERT INTO tickets (id, board_id, display_id, title, description, status, priority, position, tags, links, status_changed_at, created_at, updated_at)
    VALUES ('t-1', 'b-1', 42, 'Ticket', '', 'todo', 'none', 0, '[]', '[]', datetime('now'), datetime('now'), datetime('now'));
  `);
  const ticketStore = { getTicketById: async (id: string) => (id === 't-1' ? { id, displayId: 42 } : null) } as unknown as TicketStorePort;
  const ticketTodos = new TicketTodosUseCase(
    new SqliteTodoStoreAdapter(conn), ticketStore, () => {}, () => HUMAN,
    async (slug) => ['nas', 'builder'].includes(slug),
  );
  todoAgentAccess = true;
  const container = { config: { get: () => ({ todoAgentAccess }) }, ticketTodos } as unknown as Container;
  server = Fastify();
  registerErrorHandler(server);
  registerTodoRoutes(server, container, (r) => resolveTodoActor(r.headers, HUMAN), '/api');
});

afterEach(async () => {
  await server.close();
  conn.close();
});

const asAssistant = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) =>
  server.inject({ method, url, headers: assistantHeaders(), ...(payload ? { payload } : {}) });
const asHuman = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) =>
  server.inject({ method, url, ...(payload ? { payload } : {}) });

describe('the assistant on the todo, under its own identity', () => {
  it('a done on an item assigned to the user is refused (403) with the reason, and the item stays open', async () => {
    await asHuman('POST', '/api/tickets/t-1/todos', { text: 'QA manuelle', assignee: 'user' });
    const res = await asAssistant('PATCH', '/api/tickets/t-1/todos/1', { state: 'done' });
    expect(res.statusCode).toBe(403);
    expect(res.body).toContain(`#1 is assigned to ${HUMAN} — leave it`);
    const [item] = (await asHuman('GET', '/api/tickets/t-1/todos')).json() as Array<{ state: string }>;
    expect(item!.state).toBe('open');
  });

  it('neither can it edit or cancel that item', async () => {
    await asHuman('POST', '/api/tickets/t-1/todos', { text: 'Décider du nom', assignee: 'user' });
    expect((await asAssistant('PATCH', '/api/tickets/t-1/todos/1', { text: 'Nom décidé' })).statusCode).toBe(403);
    expect((await asAssistant('PATCH', '/api/tickets/t-1/todos/1', { state: 'cancelled', reason: 'inutile' })).statusCode).toBe(403);
  });

  // Control for the two tests above: the same calls WITHOUT the identity are the
  // human's and pass — that was the hole.
  it('without the identity the same done passes as the human (what runCli used to do)', async () => {
    await asHuman('POST', '/api/tickets/t-1/todos', { text: 'QA manuelle', assignee: 'user' });
    expect((await asHuman('PATCH', '/api/tickets/t-1/todos/1', { state: 'done' })).statusCode).toBe(200);
  });

  it('the history of an item it creates carries its name, not the human’s', async () => {
    const created = await asAssistant('POST', '/api/tickets/t-1/todos', { text: 'Écrire la spec', assignee: 'builder' });
    expect(created.statusCode).toBe(201);
    await asAssistant('PATCH', '/api/tickets/t-1/todos/1', { state: 'done' });
    const history = (await asHuman('GET', '/api/tickets/t-1/todos/events')).json() as Array<{ action: string; actorType: string; actorName: string; source: string }>;
    expect(history.map((e) => [e.action, e.actorType, e.actorName, e.source]).sort()).toEqual([
      ['created', 'agent', 'Nas', 'cli'],
      ['state_changed', 'agent', 'Nas', 'cli'],
    ]);
    const [item] = (await asHuman('GET', '/api/tickets/t-1/todos')).json() as Array<{ createdByName: string; stateChangedByName: string }>;
    expect(item!.createdByName).toBe('Nas');
    expect(item!.stateChangedByName).toBe('Nas');
  });

  it('`me` is its own slug: an item it takes is assigned to the assistant persona', async () => {
    const res = await asAssistant('POST', '/api/tickets/t-1/todos', { text: 'Rendre compte', assignee: 'me' });
    expect((res.json() as { item: { assignee: unknown } }).item.assignee).toEqual({ type: 'agent', name: 'nas' });
  });

  it('with todoAgentAccess off, every todo call of the assistant is refused — it follows the setting like any agent', async () => {
    todoAgentAccess = false;
    const read = await asAssistant('GET', '/api/tickets/t-1/todos');
    const write = await asAssistant('POST', '/api/tickets/t-1/todos', { text: 'x' });
    expect([read.statusCode, write.statusCode]).toEqual([403, 403]);
    expect(read.body).toContain(TODO_AGENTS_OFF);
  });
});
