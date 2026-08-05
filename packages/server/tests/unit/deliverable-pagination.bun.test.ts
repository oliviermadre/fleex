/**
 * Integration tests — Documents view pagination & facets
 *
 * Historical bug: the Documents view loaded the whole `deliverables` table in
 * one shot. On Supabase that select was silently capped at max-rows (1000) and
 * ordered `created_at ASC`, so the view kept the *oldest* 1000 rows: recent
 * documents vanished, and the sidebar — built client-side from that payload —
 * lost the types that only existed among the recent rows.
 *
 * The store now pages (newest-updated first, with a DB-side total) and computes
 * facets in the database over every row.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteConnection } from '../../src/infrastructure/adapters/sqlite/connection.js';
import { SqliteDeliverableStoreAdapter } from '../../src/infrastructure/adapters/sqlite/sqlite-deliverable-store.adapter.js';
import { runPendingMigrations } from '../../src/infrastructure/migrations/run-migrations.js';
import { TicketDeliverableEntity } from '../../src/domain/entities/ticket-deliverable.entity.js';

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

let conn: SqliteConnection;
let store: SqliteDeliverableStoreAdapter;

/** `index` 0 is the oldest; the last one is the most recently updated. */
function makeDeliverable(index: number, type: string, agentName = 'claude'): TicketDeliverableEntity {
  const at = new Date(Date.UTC(2026, 0, 1) + index * 60_000);
  return new TicketDeliverableEntity(
    `d-${String(index).padStart(4, '0')}`,
    null,
    agentName,
    type,
    `Doc ${index}`,
    'content',
    1,
    index % 2 === 0 ? 'draft' : 'final',
    null,
    at,
    at,
  );
}

beforeEach(async () => {
  conn = new SqliteConnection(':memory:');
  await conn.init();
  await runPendingMigrations('sqlite', conn, silent as never);
  store = new SqliteDeliverableStoreAdapter(conn);

  // 1200 old "report" documents, then 5 recent "fireflies" ones — the exact
  // shape that used to make the recent type disappear behind the 1000 cap.
  for (let i = 0; i < 1200; i++) await store.save(makeDeliverable(i, 'report'));
  for (let i = 1200; i < 1205; i++) await store.save(makeDeliverable(i, 'fireflies', 'fireflies-bot'));
});

afterEach(() => {
  conn.close();
});

describe('query — paging', () => {
  it('returns the most recently updated page first, with the full total', async () => {
    const page = await store.query({ limit: 100, offset: 0 });

    expect(page.total).toBe(1205);
    expect(page.items).toHaveLength(100);
    expect(page.items[0].id).toBe('d-1204');
    expect(page.items[0].type).toBe('fireflies');
    // Strictly descending by updatedAt.
    const times = page.items.map((d) => d.updatedAt.getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('continues where the previous page stopped', async () => {
    const first = await store.query({ limit: 100, offset: 0 });
    const second = await store.query({ limit: 100, offset: 100 });

    expect(second.items).toHaveLength(100);
    expect(second.items[0].id).toBe('d-1104');
    const overlap = new Set(first.items.map((d) => d.id));
    expect(second.items.some((d) => overlap.has(d.id))).toBe(false);
  });

  it('filters server-side and totals the filtered set', async () => {
    const page = await store.query({ limit: 100, offset: 0, types: ['fireflies'] });

    expect(page.total).toBe(5);
    expect(page.items).toHaveLength(5);
    expect(page.items.every((d) => d.type === 'fireflies')).toBe(true);
  });

  it('accepts several values on one dimension', async () => {
    const page = await store.query({ limit: 10, offset: 0, statuses: ['draft', 'final'] });
    expect(page.total).toBe(1205);
  });
});

describe('getFacets', () => {
  it('counts every row, including types absent from the first page', async () => {
    const facets = await store.getFacets();

    expect(facets.total).toBe(1205);
    expect(facets.types).toEqual([
      { value: 'report', count: 1200 },
      { value: 'fireflies', count: 5 },
    ]);
    expect(facets.agentNames).toContainEqual({ value: 'fireflies-bot', count: 5 });
    expect(facets.statuses.map((f) => f.value).sort()).toEqual(['draft', 'final']);
  });

  it('keeps a dimension browsable by ignoring its own filter', async () => {
    const facets = await store.getFacets({ types: ['fireflies'] });

    // The Type list still offers every type…
    expect(facets.types.map((f) => f.value).sort()).toEqual(['fireflies', 'report']);
    // …while the other dimensions narrow to the selection.
    expect(facets.agentNames).toEqual([{ value: 'fireflies-bot', count: 5 }]);
    expect(facets.total).toBe(5);
  });
});

describe('getAll', () => {
  it('is not capped — every row comes back', async () => {
    expect(await store.getAll()).toHaveLength(1205);
  });
});

describe('search & origin', () => {
  // A ticket-anchored deliverable, and one produced by a routine run — the two
  // shapes the Origine column has to name.
  beforeEach(async () => {
    conn.db.exec(`
      INSERT INTO boards (id, name, emoji, created_at, updated_at)
      VALUES ('b-1', 'Board', '', datetime('now'), datetime('now'));
      INSERT INTO tickets (id, board_id, display_id, title, description, status, priority, position, tags, links, status_changed_at, created_at, updated_at)
      VALUES ('t-1', 'b-1', 1, 'Migrate CloudSQL to Kubernetes', '', 'todo', 'none', 0, '[]', '[]', datetime('now'), datetime('now'), datetime('now'));
      INSERT INTO workflow_templates (id, name, slug, steps, edges, entry_step_id, enabled, created_at, updated_at)
      VALUES ('tmpl-1', 'WF', 'wf', '[]', '[]', 'step-1', 1, datetime('now'), datetime('now'));
      INSERT INTO routines (id, slug, name, emoji, enabled, template_id, subject, trigger_kind, timezone, overlap_policy, created_at, updated_at)
      VALUES ('rt-1', 'daily-briefing', 'Briefing quotidien', '📰', 1, 'tmpl-1', '{}', 'cron', 'Europe/Paris', 'skip', datetime('now'), datetime('now'));
      INSERT INTO workflow_runs (id, ticket_id, routine_id, template_id, template_snapshot, status, triggered_by, triggered_from, started_at, created_at, updated_at)
      VALUES ('run-1', NULL, 'rt-1', 'tmpl-1', '{}', 'completed', '@test', 'test', datetime('now'), datetime('now'), datetime('now'));
    `);

    const onTicket = makeDeliverable(2000, 'spec');
    (onTicket as { ticketId: string | null }).ticketId = 't-1';
    await store.save(onTicket);

    const fromRoutine = new TicketDeliverableEntity(
      'd-2001', null, 'fireflies-bot', 'fireflies', 'Compte rendu réunion', 'x', 1, 'final',
      null, new Date(Date.UTC(2026, 1, 1)), new Date(Date.UTC(2026, 1, 1)), 'run-1', null,
    );
    await store.save(fromRoutine);
  });

  it('names the ticket as origin', async () => {
    const page = await store.query({ limit: 10, offset: 0, search: 'CloudSQL' });

    expect(page.total).toBe(1);
    expect(page.origins[page.items[0].id]).toEqual({
      kind: 'ticket',
      id: 't-1',
      label: 'Migrate CloudSQL to Kubernetes',
    });
  });

  it('names the routine as origin for a run deliverable', async () => {
    const page = await store.query({ limit: 10, offset: 0, types: ['fireflies'] });

    expect(page.origins['d-2001']).toEqual({
      kind: 'routine',
      id: 'rt-1',
      label: 'Briefing quotidien',
      workflowRunId: 'run-1',
    });
  });

  it('matches the deliverable title, the ticket title, or the routine name', async () => {
    // Deliverable title
    expect((await store.query({ limit: 10, offset: 0, search: 'compte rendu' })).total).toBe(1);
    // Ticket title — the document itself is called "Doc 2000"
    expect((await store.query({ limit: 10, offset: 0, search: 'kubernetes' })).total).toBe(1);
    // Routine name
    const byRoutine = await store.query({ limit: 10, offset: 0, search: 'briefing' });
    expect(byRoutine.total).toBe(1);
    expect(byRoutine.items[0].id).toBe('d-2001');
  });

  it('is case-insensitive and treats % as a literal', async () => {
    expect((await store.query({ limit: 10, offset: 0, search: 'CLOUDSQL' })).total).toBe(1);
    expect((await store.query({ limit: 10, offset: 0, search: '%' })).total).toBe(0);
  });

  it('collapses a workflow\'s steps into one agentic facet', async () => {
    // Three steps of the same workflow + one of another: the sidebar should
    // show two entries, not four.
    const steps = ['Spec', 'Dev', 'Check Spec'];
    for (const [i, step] of steps.entries()) {
      await store.save(new TicketDeliverableEntity(
        `d-30${i}`, null, `workflow:Spec Dev PR → ${step}`, 'spec', `Step ${step}`, 'x', 1, 'final',
        null, new Date(Date.UTC(2026, 2, 1)), new Date(Date.UTC(2026, 2, 1)), null, null,
      ));
    }
    await store.save(new TicketDeliverableEntity(
      'd-310', null, 'workflow:Product Full Flow → Kickoff', 'spec', 'Other', 'x', 1, 'final',
      null, new Date(Date.UTC(2026, 2, 1)), new Date(Date.UTC(2026, 2, 1)), null, null,
    ));

    const facets = await store.getFacets({ types: ['spec'] });
    const workflows = facets.agentNames.filter((f) => f.value.startsWith('workflow:'));

    expect(workflows).toEqual([
      { value: 'workflow:Spec Dev PR', count: 3 },
      { value: 'workflow:Product Full Flow', count: 1 },
    ]);
  });

  it('filters on the collapsed workflow, matching every step', async () => {
    for (const step of ['Spec', 'Dev']) {
      await store.save(new TicketDeliverableEntity(
        `d-40${step}`, null, `workflow:Spec Dev PR → ${step}`, 'plan', `Step ${step}`, 'x', 1, 'final',
        null, new Date(Date.UTC(2026, 2, 2)), new Date(Date.UTC(2026, 2, 2)), null, null,
      ));
    }

    const page = await store.query({ limit: 10, offset: 0, agentNames: ['workflow:Spec Dev PR'] });
    expect(page.total).toBe(2);
  });

  it('counts and filters the ticket vs routine origin', async () => {
    const facets = await store.getFacets({ types: ['spec', 'fireflies'] });
    const byKind = Object.fromEntries(facets.originKinds.map((f) => [f.value, f.count]));

    expect(byKind.ticket).toBe(1);
    expect(byKind.routine).toBe(1);

    const routineOnly = await store.query({
      limit: 10,
      offset: 0,
      types: ['spec', 'fireflies'],
      originKinds: ['routine'],
    });
    expect(routineOnly.total).toBe(1);
    expect(routineOnly.items[0].id).toBe('d-2001');
  });

  it('narrows the facet counts to the search', async () => {
    const facets = await store.getFacets({ search: 'briefing' });

    expect(facets.total).toBe(1);
    expect(facets.types).toEqual([{ value: 'fireflies', count: 1 }]);
  });
});
