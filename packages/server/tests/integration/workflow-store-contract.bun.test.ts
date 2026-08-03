/**
 * SQLite half of the workflow store contract.
 *
 * Separate file because the SQLite connection imports `bun:sqlite`, which only
 * loads under the Bun runtime — run it via `bun run test:bun`. The json/pgsql
 * halves live in workflow-store-contract.test.ts.
 */
import { TicketEntity } from '../../src/domain/entities/ticket.entity.js';
import { SqliteConnection } from '../../src/infrastructure/adapters/sqlite/connection.js';
import { SqliteStepRunStoreAdapter } from '../../src/infrastructure/adapters/sqlite/sqlite-step-run-store.adapter.js';
import { SqliteTicketStoreAdapter } from '../../src/infrastructure/adapters/sqlite/sqlite-ticket-store.adapter.js';
import { SqliteWorkflowRunStoreAdapter } from '../../src/infrastructure/adapters/sqlite/sqlite-workflow-run-store.adapter.js';
import { SqliteWorkflowTemplateStoreAdapter } from '../../src/infrastructure/adapters/sqlite/sqlite-workflow-template-store.adapter.js';
import { runPendingMigrations } from '../../src/infrastructure/migrations/run-migrations.js';
import {
  runWorkflowStoreContract,
  type WorkflowStoreHarness,
} from '../contract/workflow-store-contract.js';

import { silentLogger } from './helpers/driver-harness.js';

runWorkflowStoreContract('sqlite', async (): Promise<WorkflowStoreHarness> => {
  const conn = new SqliteConnection(':memory:');
  await conn.init();
  await runPendingMigrations('sqlite', conn, silentLogger as never);

  const ticketStore = new SqliteTicketStoreAdapter(conn);

  return {
    templateStore: new SqliteWorkflowTemplateStoreAdapter(conn),
    runStore: new SqliteWorkflowRunStoreAdapter(conn),
    stepRunStore: new SqliteStepRunStoreAdapter(conn),
    async seedTicket(ticketId: string) {
      // workflow_runs.ticket_id is a FK — the ticket must exist first.
      if (await ticketStore.getTicketById(ticketId)) return;
      await ticketStore.createTicket(
        TicketEntity.create({
          id: ticketId,
          boardId: 'contract-board',
          displayId: 1,
          title: 'Contract ticket',
        }),
      );
    },
    async teardown() {
      conn.close();
    },
  };
});
