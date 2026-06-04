/**
 * Integration tests — SQLite upsert cascade regression
 *
 * Verifies that saveTicket() and WorkflowRunStore.save() use non-destructive
 * upserts (INSERT … ON CONFLICT DO UPDATE) instead of INSERT OR REPLACE, so
 * that ON DELETE CASCADE chains are never triggered by a plain update.
 *
 * Historical bug: INSERT OR REPLACE = DELETE + INSERT, which fired CASCADE on
 *   workflow_runs → step_runs whenever saveTicket() was called during a run.
 *   Result: "WORKFLOW RUN NOT FOUND" toast + "FOREIGN KEY constraint failed" crash.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteConnection } from '../../src/infrastructure/adapters/sqlite/connection.js';
import { SqliteTicketStoreAdapter } from '../../src/infrastructure/adapters/sqlite/sqlite-ticket-store.adapter.js';
import { SqliteWorkflowRunStoreAdapter } from '../../src/infrastructure/adapters/sqlite/sqlite-workflow-run-store.adapter.js';
import { SqliteStepRunStoreAdapter } from '../../src/infrastructure/adapters/sqlite/sqlite-step-run-store.adapter.js';
import { runPendingMigrations } from '../../src/infrastructure/migrations/run-migrations.js';
import { TicketEntity } from '../../src/domain/entities/ticket.entity.js';
import { WorkflowRunEntity } from '../../src/domain/entities/workflow-run.entity.js';
import { StepRunEntity } from '../../src/domain/entities/step-run.entity.js';

// ── minimal logger (silent) ──────────────────────────────────────────────────

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

// ── helpers ──────────────────────────────────────────────────────────────────

function makeTicket(id = 'ticket-1'): TicketEntity {
  return TicketEntity.create({ id, boardId: 'board-1', displayId: 1, title: 'Test ticket' });
}

const SNAPSHOT = {
  name: 'Test WF', emoji: '🔧',
  steps: [{ id: 'step-1', name: 'S1', executorType: 'agent' as const, executorRef: 'p', position: { x: 0, y: 0 } }],
  edges: [],
  entryStepId: 'step-1',
};

function makeRun(id = 'run-1', ticketId = 'ticket-1'): WorkflowRunEntity {
  return WorkflowRunEntity.create({ id, ticketId, templateId: 'tmpl-1', templateSnapshot: SNAPSHOT, triggeredBy: '@test', triggeredFrom: 'test' });
}

function makeStepRun(id = 'sr-1', runId = 'run-1'): StepRunEntity {
  return StepRunEntity.create({ id, workflowRunId: runId, stepId: 'step-1' });
}

// ── test setup ───────────────────────────────────────────────────────────────

let conn: SqliteConnection;
let ticketStore: SqliteTicketStoreAdapter;
let runStore: SqliteWorkflowRunStoreAdapter;
let stepRunStore: SqliteStepRunStoreAdapter;

beforeEach(async () => {
  conn = new SqliteConnection(':memory:');
  await conn.init();
  await runPendingMigrations('sqlite', conn, silent as never);

  ticketStore = new SqliteTicketStoreAdapter(conn);
  runStore = new SqliteWorkflowRunStoreAdapter(conn);
  stepRunStore = new SqliteStepRunStoreAdapter(conn);

  // Seed the workflow_template referenced by FK (no CASCADE, but still required)
  conn.db.exec(`
    INSERT INTO workflow_templates (id, name, slug, steps, edges, entry_step_id, enabled, created_at, updated_at)
    VALUES ('tmpl-1', 'Test WF', 'test-wf', '[]', '[]', 'step-1', 1,
            datetime('now'), datetime('now'))
  `);
});

afterEach(() => {
  conn.close();
});

// ── AC2: saveTicket must NOT cascade-delete workflow_runs / step_runs ─────────

describe('saveTicket — no cascade on update (AC2)', () => {
  it('keeps workflow_run alive after saveTicket() updates the ticket', async () => {
    const ticket = makeTicket();
    await ticketStore.createTicket(ticket);

    const run = makeRun();
    await runStore.save(run);

    // Mutate and re-save the ticket (simulates execute-agent status change, etc.)
    ticket.status = 'doing';
    ticket.updatedAt = new Date();
    await ticketStore.saveTicket(ticket);

    const still = await runStore.getById('run-1');
    expect(still, 'workflow_run must survive saveTicket()').not.toBeNull();
    expect(still?.status).toBe('running');
  });

  it('keeps step_runs alive after saveTicket() updates the ticket', async () => {
    const ticket = makeTicket();
    await ticketStore.createTicket(ticket);

    const run = makeRun();
    await runStore.save(run);

    const sr = makeStepRun();
    await stepRunStore.save(sr);

    // Simulate multiple saveTicket calls (as execute-agent does)
    for (let i = 0; i < 3; i++) {
      ticket.updatedAt = new Date();
      await ticketStore.saveTicket(ticket);
    }

    const stepRuns = await stepRunStore.getByWorkflowRun('run-1');
    expect(stepRuns).toHaveLength(1);
    expect(stepRuns[0]?.id).toBe('sr-1');
  });

  it('updates ticket fields correctly (no regression on saveTicket semantics)', async () => {
    const ticket = makeTicket();
    await ticketStore.createTicket(ticket);

    ticket.title = 'Updated title';
    ticket.status = 'doing';
    await ticketStore.saveTicket(ticket);

    const fetched = await ticketStore.getTicketById('ticket-1');
    expect(fetched?.title).toBe('Updated title');
    expect(fetched?.status).toBe('doing');
  });
});

// ── AC3: WorkflowRunStore.save() must NOT cascade-delete step_runs ────────────

describe('WorkflowRunStore.save — no cascade on update (AC3)', () => {
  it('keeps step_runs alive after run transitions (running → needs_review → completed)', async () => {
    const ticket = makeTicket();
    await ticketStore.createTicket(ticket);

    const run = makeRun();
    await runStore.save(run);

    const sr = makeStepRun();
    await stepRunStore.save(sr);

    // Simulate run state transitions
    run.block();
    await runStore.save(run);

    run.complete();
    await runStore.save(run);

    const stepRuns = await stepRunStore.getByWorkflowRun('run-1');
    expect(stepRuns).toHaveLength(1);
    expect(stepRuns[0]?.id).toBe('sr-1');
  });

  it('updates run fields correctly (no regression on save semantics)', async () => {
    const ticket = makeTicket();
    await ticketStore.createTicket(ticket);

    const run = makeRun();
    await runStore.save(run);

    run.block();
    await runStore.save(run);

    const fetched = await runStore.getById('run-1');
    expect(fetched?.status).toBe('needs_review');
  });
});

// ── AC5: removeTicket must still cascade intentionally ────────────────────────

describe('removeTicket — intentional cascade preserved (AC5)', () => {
  it('cascade-deletes workflow_runs and step_runs when the ticket is deleted', async () => {
    const ticket = makeTicket();
    await ticketStore.createTicket(ticket);

    const run = makeRun();
    await runStore.save(run);

    const sr = makeStepRun();
    await stepRunStore.save(sr);

    await ticketStore.removeTicket('ticket-1');

    expect(await runStore.getById('run-1')).toBeNull();
    expect(await stepRunStore.getByWorkflowRun('run-1')).toHaveLength(0);
  });
});
