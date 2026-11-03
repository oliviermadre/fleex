/**
 * The pieces around the todo use-case that decide what humans and agents see:
 * who an action is attributed to, what an agent is told in its prompt, and the
 * pg / Supabase adapters (no database here — the SQLite path is covered by
 * ticket-todos-sqlite.bun.test.ts).
 */
import { describe, it, expect } from 'vitest';
import type { TicketTodoItem } from '@fleex/shared';
import { resolveTodoActor } from '../../src/infrastructure/http/todo-actor.js';
import { formatTodoContext, TODO_CONTEXT_DONE_MAX, TODO_CONTEXT_OPEN_MAX } from '../../src/application/utils/format-todo-context.js';
import { buildSdkOptions } from '../../src/application/utils/build-sdk-options.js';
import { PgTodoStore } from '../../src/infrastructure/adapters/pgsql/pg-todo-store.adapter.js';
import { SupabaseTodoStore } from '../../src/infrastructure/adapters/supabase/supabase-todo-store.adapter.js';
import { TicketTodoItemEntity } from '../../src/domain/entities/ticket-todo-item.entity.js';
import type { PgConnection } from '../../src/infrastructure/adapters/pgsql/connection.js';
import type { SupabaseConnection } from '../../src/infrastructure/adapters/supabase/connection.js';

describe('resolveTodoActor — attribution of a web/CLI/MCP call', () => {
  it('is the human, from the web, when no header is sent (the browser)', () => {
    expect(resolveTodoActor({}, 'nas')).toEqual({ type: 'user', name: 'nas', source: 'web' });
  });

  it('is the agent an agent run declared through the CLI env', () => {
    expect(resolveTodoActor({ 'x-fleex-actor-type': 'agent', 'x-fleex-actor-name': 'Builder', 'x-fleex-source': 'cli' }, 'nas'))
      .toEqual({ type: 'agent', name: 'Builder', source: 'cli' });
    expect(resolveTodoActor({ 'x-fleex-actor-type': 'agent', 'x-fleex-actor-name': 'Builder', 'x-fleex-source': 'mcp' }, 'nas').source)
      .toBe('mcp');
  });

  it('decodes the URL-encoded name the CLI sends (a workflow step name holds `→`)', () => {
    const name = encodeURIComponent('workflow:Spec Dev PR (HITL) → Build');
    expect(resolveTodoActor({ 'x-fleex-actor-type': 'agent', 'x-fleex-actor-name': name }, 'nas').name)
      .toBe('workflow:Spec Dev PR (HITL) → Build');
  });

  it('falls back to the human on anything malformed, and truncates long names', () => {
    expect(resolveTodoActor({ 'x-fleex-actor-type': 'robot', 'x-fleex-actor-name': 'X' }, 'nas').type).toBe('user');
    expect(resolveTodoActor({ 'x-fleex-actor-type': 'agent' }, 'nas')).toEqual({ type: 'user', name: 'nas', source: 'web' });
    // `agent-api` is reserved to token-authenticated routes: a header cannot claim it.
    expect(resolveTodoActor({ 'x-fleex-source': 'agent-api' }, 'nas').source).toBe('web');
    expect(resolveTodoActor({ 'x-fleex-actor-type': 'agent', 'x-fleex-actor-name': 'a'.repeat(300) }, 'nas').name).toHaveLength(120);
  });
});

describe('buildSdkOptions — the identity an agent run hands to the CLI it spawns', () => {
  it('exports FLEEX_ACTOR_* on top of the inherited env', () => {
    const opts = buildSdkOptions('edit', { model: 'm', systemPrompt: '', actorName: 'Builder' });
    const env = opts.env as Record<string, string>;
    expect(env.FLEEX_ACTOR_TYPE).toBe('agent');
    expect(env.FLEEX_ACTOR_NAME).toBe('Builder');
    expect(env.PATH).toBe(process.env.PATH); // still able to find `fleex`, git, …
  });

  it('leaves the SDK default env alone when no actor is given', () => {
    expect(buildSdkOptions('edit', { model: 'm', systemPrompt: '' }).env).toBeUndefined();
  });
});

const item = (ref: number, state: TicketTodoItem['state'], over: Partial<TicketTodoItem> = {}): TicketTodoItem => ({
  id: `i${ref}`, ticketId: 't', ref, text: `Item ${ref}`, note: null, state, position: ref,
  createdByType: 'agent', createdByName: 'Catalyst',
  stateChangedAt: state === 'open' ? null : `2026-11-03T10:${String(ref % 60).padStart(2, '0')}:00.000Z`,
  stateChangedByType: state === 'open' ? null : 'agent', stateChangedByName: state === 'open' ? null : 'Builder',
  cancelReason: null, createdAt: '2026-11-03T09:00:00.000Z', updatedAt: '2026-11-03T09:00:00.000Z', ...over,
});

describe('formatTodoContext — the `## Todo list` section of an agent prompt', () => {
  it('is absent for a ticket without todo (only the hint is injected then)', () => {
    expect(formatTodoContext(42, [])).toBeNull();
  });

  it('shows open items, who closed done ones, a reopen, and only counts cancelled ones', () => {
    const out = formatTodoContext(42, [
      item(1, 'done'),
      item(3, 'open', { stateChangedByName: 'nas', stateChangedByType: 'user' }),
      item(4, 'open', { createdByName: 'nas', createdByType: 'user' }),
      item(5, 'cancelled'),
    ])!;
    expect(out).toContain('2 open · 1 done · 1 cancelled');
    expect(out).toContain('- [ ] #3 Item 3 — Catalyst (reopened by nas)');
    expect(out).toContain('- [ ] #4 Item 4 — nas');
    expect(out).toContain('- [x] #1 Item 1 — done by Builder · 2026-11-03 10:01 UTC');
    expect(out).not.toContain('Item 5');
    expect(out).toContain('(1 cancelled item hidden');
  });

  it('caps open and done items so a long list cannot crowd the prompt', () => {
    const items = [
      ...Array.from({ length: TODO_CONTEXT_OPEN_MAX + 3 }, (_, i) => item(i + 1, 'open')),
      ...Array.from({ length: TODO_CONTEXT_DONE_MAX + 2 }, (_, i) => item(100 + i, 'done')),
    ];
    const out = formatTodoContext(42, items)!;
    expect(out.match(/- \[ \]/g)).toHaveLength(TODO_CONTEXT_OPEN_MAX);
    expect(out.match(/- \[x\]/g)).toHaveLength(TODO_CONTEXT_DONE_MAX);
    expect(out).toContain('… 3 more open');
    expect(out).toContain('… 2 more done');
  });
});

const entity = () => TicketTodoItemEntity.create({
  id: 'i1', ticketId: 't', ref: 1, text: 'A', position: 1, actor: { type: 'user', name: 'nas' },
});

describe('PgTodoStore', () => {
  it('reports a ref collision as ref_conflict so the use-case retries', async () => {
    const db = { query: async () => { throw Object.assign(new Error('duplicate key value'), { code: '23505' }); } };
    expect(await new PgTodoStore(db as unknown as PgConnection).insertItem(entity())).toBe('ref_conflict');
  });

  it('rethrows any other failure', async () => {
    const db = { query: async () => { throw new Error('connection reset'); } };
    await expect(new PgTodoStore(db as unknown as PgConnection).insertItem(entity())).rejects.toThrow('connection reset');
  });

  it('reads JSONB changes and Date columns back into the shared shape', async () => {
    const db = {
      query: async () => ({
        rows: [{
          id: 'e1', item_id: 'i1', ticket_id: 't', item_ref: 3, item_text: 'A', action: 'state_changed',
          changes: { state: { from: 'open', to: 'done' } }, actor_type: 'agent', actor_name: 'Builder',
          source: 'mcp', created_at: new Date('2026-11-03T10:00:00.000Z'),
        }],
      }),
    };
    const [e] = await new PgTodoStore(db as unknown as PgConnection).listEvents('t');
    expect(e).toMatchObject({ itemRef: 3, changes: { state: { from: 'open', to: 'done' } }, createdAt: '2026-11-03T10:00:00.000Z' });
  });
});

describe('SupabaseTodoStore', () => {
  it('reports a ref collision as ref_conflict', async () => {
    const client = { from: () => ({ insert: async () => ({ error: { code: '23505', message: 'duplicate key value' } }) }) };
    expect(await new SupabaseTodoStore({ client } as unknown as SupabaseConnection).insertItem(entity())).toBe('ref_conflict');
  });

  it('pages through the history instead of stopping at the 1000-row PostgREST cap', async () => {
    const rows = Array.from({ length: 2300 }, (_, i) => ({
      id: `e${i}`, item_id: 'i1', ticket_id: 't', item_ref: 1, item_text: 'A', action: 'moved', changes: {},
      actor_type: 'user', actor_name: 'nas', source: 'web', created_at: '2026-11-03T10:00:00.000Z',
    }));
    const client = {
      from: () => {
        let from = 0; let to = Infinity;
        const b = {
          select: () => b, eq: () => b, order: () => b,
          range: (f: number, t: number) => { from = f; to = t; return b; },
          then: (resolve: (v: unknown) => void) => resolve({ data: rows.slice(from, Math.min(to + 1, from + 1000)), error: null }),
        };
        return b;
      },
    };
    expect(await new SupabaseTodoStore({ client } as unknown as SupabaseConnection).listEvents('t')).toHaveLength(2300);
  });
});
