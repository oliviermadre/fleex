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

describe('resolveTodoActor — the persona of an agent run', () => {
  it('carries the persona slug the CLI sends, lower-cased: it decides which items are "for you"', () => {
    expect(resolveTodoActor({ 'x-fleex-actor-type': 'agent', 'x-fleex-actor-name': 'w', 'x-fleex-actor-persona': 'Builder' }, 'nas'))
      .toEqual({ type: 'agent', name: 'w', source: 'web', persona: 'builder' });
  });

  it('drops a malformed persona, and never gives one to the human', () => {
    expect(resolveTodoActor({ 'x-fleex-actor-type': 'agent', 'x-fleex-actor-name': 'w', 'x-fleex-actor-persona': 'a b' }, 'nas').persona)
      .toBeUndefined();
    expect(resolveTodoActor({ 'x-fleex-actor-persona': 'builder' }, 'nas').persona).toBeUndefined();
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

  it('exports FLEEX_ACTOR_PERSONA only when the run has a persona (not a panel orchestrator)', () => {
    const withPersona = buildSdkOptions('edit', { model: 'm', systemPrompt: '', actorName: 'w', actorPersona: 'builder' });
    expect((withPersona.env as Record<string, string>).FLEEX_ACTOR_PERSONA).toBe('builder');
    const orchestrator = buildSdkOptions('edit', { model: 'm', systemPrompt: '', actorName: 'Panel' });
    expect((orchestrator.env as Record<string, string>).FLEEX_ACTOR_PERSONA).toBeUndefined();
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
  cancelReason: null, assignee: null, assignedByType: null, assignedByName: null, takeoverReason: null, createdAt: '2026-11-03T09:00:00.000Z', updatedAt: '2026-11-03T09:00:00.000Z', ...over,
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
    expect(out).toContain('- [ ] #3 Item 3 — by Catalyst (reopened by nas)');
    expect(out).toContain('- [ ] #4 Item 4 — by nas');
    expect(out).toContain('- [x] #1 Item 1 — done by Builder · 2026-11-03 10:01 UTC');
    expect(out).not.toContain('Item 5');
    expect(out).toContain('(1 cancelled item hidden');
  });

  // The point of assignment: an agent reading the list must see at a glance
  // what is its own, what is free, and what is the human's to do.
  describe('grouped by who the items are for', () => {
    const list = [
      item(1, 'open', { assignee: { type: 'agent', name: 'builder' } }),
      item(2, 'open'),
      item(3, 'open', { assignee: { type: 'agent', name: null } }),
      item(4, 'open', { assignee: { type: 'agent', name: 'catalyst' } }),
      item(5, 'open', { assignee: { type: 'user', name: 'nas' }, createdByName: 'nas' }),
    ];
    const section = (out: string, heading: string) => out.split('### ').find((s) => s.startsWith(heading)) ?? '';

    it('for an agent with a persona: its items, free ones, another agent\'s, the human\'s', () => {
      const out = formatTodoContext(42, list, { persona: 'builder' })!;
      expect(section(out, 'For you (builder)')).toContain('#1 Item 1');
      expect(section(out, 'For any agent / anyone')).toMatch(/#2 Item 2[\s\S]*#3 Item 3/);
      expect(section(out, 'Assigned to another agent')).toContain('#4 Item 4 — by Catalyst → catalyst');
      expect(section(out, 'Assigned to nas — do NOT act on these')).toContain('#5 Item 5');
      // Headings follow the order an agent should work in.
      expect(out.indexOf('For you')).toBeLessThan(out.indexOf('For any agent'));
      expect(out.indexOf('Assigned to another agent')).toBeLessThan(out.indexOf('Assigned to nas'));
    });

    it('for a run without persona (panel orchestrator): nothing is "for you"', () => {
      const out = formatTodoContext(42, list)!;
      expect(out).not.toContain('For you');
      expect(section(out, 'Assigned to another agent')).toMatch(/#1 Item 1[\s\S]*#4 Item 4/);
    });

    it('omits empty groups', () => {
      const out = formatTodoContext(42, [item(2, 'open')], { persona: 'builder' })!;
      expect(out).toContain('### For any agent / anyone');
      expect(out).not.toMatch(/For you|another agent|do NOT act/);
    });

    it('says when an agent took over the human\'s item, and why', () => {
      const out = formatTodoContext(42, [item(6, 'open', {
        assignee: { type: 'agent', name: 'builder' }, assignedByName: 'Builder', takeoverReason: 'nas asked me to finish QA',
      })], { persona: 'builder' })!;
      expect(out).toContain('(taken over by Builder: “nas asked me to finish QA”)');
    });
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

/** A PgConnection whose transaction client fails on the statement matching `failOn`; records every statement. */
function pgFake(failOn: RegExp | null, failure: Error) {
  const sql: string[] = [];
  let released = false;
  const client = {
    query: async (text: string) => {
      sql.push(text.trim().split(/\s+/).slice(0, 3).join(' '));
      if (failOn && failOn.test(text)) throw failure;
      return { rows: [] };
    },
    release: () => { released = true; },
  };
  const db = { connect: async () => client, query: client.query };
  return { db: db as unknown as PgConnection, sql, released: () => released };
}

const stateEvent = { id: 'e1', itemId: 'i1', ticketId: 't', itemRef: 1, itemText: 'A', action: 'state_changed' as const,
  changes: { state: { from: 'open', to: 'done' } }, actorType: 'user' as const, actorName: 'nas', source: 'web' as const,
  createdAt: '2026-11-03T10:00:00.000Z' };

describe('PgTodoStore', () => {
  it('reports a ref collision as ref_conflict so the use-case retries', async () => {
    const fake = pgFake(/INSERT INTO ticket_todo_items/, Object.assign(new Error('duplicate key value'), { code: '23505' }));
    expect(await new PgTodoStore(fake.db).insertItem(entity(), [])).toBe('ref_conflict');
  });

  it('rethrows any other failure', async () => {
    const fake = pgFake(/INSERT INTO ticket_todo_items/, new Error('connection reset'));
    await expect(new PgTodoStore(fake.db).insertItem(entity(), [])).rejects.toThrow('connection reset');
  });

  // Review finding: item and history were two separate writes, so a failed
  // history insert left a change nobody could trace (AC4: one event per change).
  it('rolls the item change back when its history row fails, and releases the client', async () => {
    const fake = pgFake(/INSERT INTO ticket_todo_events/, new Error('network down'));
    await expect(new PgTodoStore(fake.db).saveItem(entity(), [stateEvent])).rejects.toThrow('network down');
    expect(fake.sql).toEqual(['BEGIN', 'UPDATE ticket_todo_items SET', 'INSERT INTO ticket_todo_events', 'ROLLBACK']);
    expect(fake.released()).toBe(true);
  });

  it('commits item and history together', async () => {
    const fake = pgFake(null, new Error('unused'));
    await new PgTodoStore(fake.db).saveItem(entity(), [stateEvent]);
    expect(fake.sql).toEqual(['BEGIN', 'UPDATE ticket_todo_items SET', 'INSERT INTO ticket_todo_events', 'COMMIT']);
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
    expect(await new SupabaseTodoStore({ client } as unknown as SupabaseConnection).insertItem(entity(), [])).toBe('ref_conflict');
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
