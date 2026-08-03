/**
 * SQLite half of the KV store contract — see workflow-store-contract.bun.test.ts
 * for why this is a separate `.bun.test.ts` file.
 */
import { SqliteConnection } from '../../src/infrastructure/adapters/sqlite/connection.js';
import { SqliteKvStoreAdapter } from '../../src/infrastructure/adapters/sqlite/sqlite-kv-store.adapter.js';
import { runPendingMigrations } from '../../src/infrastructure/migrations/run-migrations.js';
import { runKvStoreContract, type KvStoreHarness } from '../contract/kv-store-contract.js';

import { silentLogger } from './helpers/driver-harness.js';

runKvStoreContract('sqlite', async (): Promise<KvStoreHarness> => {
  const conn = new SqliteConnection(':memory:');
  await conn.init();
  await runPendingMigrations('sqlite', conn, silentLogger as never);

  return {
    store: new SqliteKvStoreAdapter(conn),
    async teardown() {
      conn.close();
    },
  };
});
