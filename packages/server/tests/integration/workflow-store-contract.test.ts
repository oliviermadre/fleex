/**
 * Runs the workflow store contract against every driver reachable from a plain
 * Node test run: `json` always, `pgsql` when FLEEX_TEST_PGSQL_URL is set.
 *
 * SQLite lives in workflow-store-contract.bun.test.ts — its driver imports
 * `bun:sqlite` and only loads under the Bun runtime.
 */
import { describe } from 'vitest';
import { runWorkflowStoreContract, type WorkflowStoreHarness } from '../contract/workflow-store-contract.js';
import { JsonWorkflowTemplateStore } from '../../src/infrastructure/adapters/json-workflow-template-store.adapter.js';
import { JsonWorkflowRunStore } from '../../src/infrastructure/adapters/json-workflow-run-store.adapter.js';
import { JsonStepRunStore } from '../../src/infrastructure/adapters/json-step-run-store.adapter.js';
import { MemoryHostFs, migratePgsqlOnce, silentLogger, uniqueHome } from './helpers/driver-harness.js';

// ── json ─────────────────────────────────────────────────────────────────────

runWorkflowStoreContract('json', async (): Promise<WorkflowStoreHarness> => {
  const hostFs = new MemoryHostFs();
  const home = uniqueHome();

  const templateStore = new JsonWorkflowTemplateStore(hostFs, home, silentLogger);
  const runStore = new JsonWorkflowRunStore(hostFs, home, silentLogger);
  const stepRunStore = new JsonStepRunStore(hostFs, home, silentLogger);
  await templateStore.init();
  await runStore.init();
  await stepRunStore.init();

  return {
    templateStore,
    runStore,
    stepRunStore,
    // json has no foreign keys — nothing to seed.
    async seedTicket() {},
    async teardown() {},
  };
});

// ── pgsql (opt-in) ───────────────────────────────────────────────────────────

const PGSQL_URL = process.env['FLEEX_TEST_PGSQL_URL'];

if (!PGSQL_URL) {
  describe.skip('workflow store contract — pgsql (set FLEEX_TEST_PGSQL_URL to run)', () => {});
} else {
  runWorkflowStoreContract('pgsql', async (): Promise<WorkflowStoreHarness> => {
    const { PgConnection } = await import('../../src/infrastructure/adapters/pgsql/connection.js');
    const { PgWorkflowTemplateStore } = await import('../../src/infrastructure/adapters/pgsql/pg-workflow-template-store.adapter.js');
    const { PgWorkflowRunStore } = await import('../../src/infrastructure/adapters/pgsql/pg-workflow-run-store.adapter.js');
    const { PgStepRunStore } = await import('../../src/infrastructure/adapters/pgsql/pg-step-run-store.adapter.js');
    const { PgTicketStore } = await import('../../src/infrastructure/adapters/pgsql/pg-ticket-store.adapter.js');
    const { TicketEntity } = await import('../../src/domain/entities/ticket.entity.js');

    const connection = new PgConnection(PGSQL_URL);
    await connection.init();
    await migratePgsqlOnce(connection);

    // Start from a clean slate; children first to respect the FK chain.
    await connection.query('DELETE FROM step_runs');
    await connection.query('DELETE FROM workflow_runs');
    await connection.query('DELETE FROM workflow_templates');
    await connection.query("DELETE FROM tickets WHERE id LIKE 'ticket-%'");
    await connection.query("DELETE FROM boards WHERE id = 'contract-board'");

    const ticketStore = new PgTicketStore(connection);

    return {
      templateStore: new PgWorkflowTemplateStore(connection),
      runStore: new PgWorkflowRunStore(connection),
      stepRunStore: new PgStepRunStore(connection),
      async seedTicket(ticketId: string) {
        // workflow_runs.ticket_id is a FK — the ticket (and its board) must exist.
        // Insert through the real store rather than hand-rolled SQL so a future
        // NOT NULL column breaks the adapter, not just this fixture.
        await connection.query(
          `INSERT INTO boards (id, name, created_at, updated_at)
           VALUES ('contract-board', 'Contract', NOW(), NOW())
           ON CONFLICT (id) DO NOTHING`,
        );
        if (await ticketStore.getTicketById(ticketId)) return;
        await ticketStore.createTicket(TicketEntity.create({
          id: ticketId, boardId: 'contract-board', displayId: 1, title: 'Contract ticket',
        }));
      },
      async teardown() {
        await connection.query('DELETE FROM step_runs');
        await connection.query('DELETE FROM workflow_runs');
        await connection.query('DELETE FROM workflow_templates');
        await connection.query("DELETE FROM tickets WHERE id LIKE 'ticket-%'");
        await connection.close();
      },
    };
  });
}
