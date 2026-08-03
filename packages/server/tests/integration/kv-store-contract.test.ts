/**
 * Runs the KV store contract against every driver reachable from a plain Node
 * test run: `json` always, `pgsql` when FLEEX_TEST_PGSQL_URL is set.
 *
 * SQLite lives in kv-store-contract.bun.test.ts (bun:sqlite is Bun-only).
 */
import { describe } from 'vitest';

import { JsonKvStore } from '../../src/infrastructure/adapters/json-kv-store.adapter.js';
import { runKvStoreContract, type KvStoreHarness } from '../contract/kv-store-contract.js';

import {
  MemoryHostFs,
  migratePgsqlOnce,
  silentLogger,
  uniqueHome,
} from './helpers/driver-harness.js';

// ── json ─────────────────────────────────────────────────────────────────────

runKvStoreContract('json', async (): Promise<KvStoreHarness> => {
  const store = new JsonKvStore(new MemoryHostFs(), uniqueHome(), silentLogger);
  await store.init();
  return { store, async teardown() {} };
});

// ── pgsql (opt-in) ───────────────────────────────────────────────────────────

const PGSQL_URL = process.env['FLEEX_TEST_PGSQL_URL'];

if (!PGSQL_URL) {
  describe.skip('kv store contract — pgsql (set FLEEX_TEST_PGSQL_URL to run)', () => {});
} else {
  runKvStoreContract('pgsql', async (): Promise<KvStoreHarness> => {
    const { PgConnection } = await import('../../src/infrastructure/adapters/pgsql/connection.js');
    const { PgKvStoreAdapter } =
      await import('../../src/infrastructure/adapters/pgsql/pg-kv-store.adapter.js');

    const connection = new PgConnection(PGSQL_URL);
    await connection.init();
    await migratePgsqlOnce(connection);
    await connection.query('DELETE FROM kv_store');

    return {
      store: new PgKvStoreAdapter(connection),
      async teardown() {
        await connection.query('DELETE FROM kv_store');
        await connection.close();
      },
    };
  });
}
