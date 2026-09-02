/**
 * Integration test — a deliverable must survive a real round-trip through the
 * database, not just through the domain layer.
 *
 * The reported bug surfaced on Supabase (Postgres 22P05), but the fix lives in
 * the domain layer precisely so that every driver behaves identically: `pg`
 * rejects a NUL in a bound `text` parameter, and SQLite bindings truncate or
 * throw depending on the implementation. This exercises the SQLite driver end
 * to end — save, then read back — which is the one runnable in CI.
 *
 * Runs under Bun only (`bun run test:bun`): `bun:sqlite` does not resolve under
 * Node, hence the `.bun.test.ts` suffix.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { hasUnstorableChars } from '@fleex/shared';
import { SqliteConnection } from '../../src/infrastructure/adapters/sqlite/connection.js';
import { SqliteDeliverableStoreAdapter } from '../../src/infrastructure/adapters/sqlite/sqlite-deliverable-store.adapter.js';
import { runPendingMigrations } from '../../src/infrastructure/migrations/run-migrations.js';
import { TicketDeliverableEntity } from '../../src/domain/entities/ticket-deliverable.entity.js';

// D5 / spec §0 — no literal escape sequence, no raw NUL in source.
const cu = (n: number) => String.fromCharCode(n);
const BS = cu(92);
const NUL = cu(0);
const escOf = (ch: string) => BS + 'u' + ch.charCodeAt(0).toString(16).padStart(4, '0');

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

/** The content that killed attempt 1 of this very ticket. */
const AUTHORED_SPEC =
  '# Spec — renderer sentinel\n\n' +
  'Use ' + NUL + ' as the placeholder: it is structurally unforgeable.\n';

let conn: SqliteConnection;
let store: SqliteDeliverableStoreAdapter;

const makeDeliverable = (id: string) =>
  TicketDeliverableEntity.create({
    id,
    ticketId: null,
    agentName: 'catalyst',
    type: 'spec',
    title: 'Spec — renderer sentinel ' + NUL,
    content: AUTHORED_SPEC,
    status: 'final',
  });

beforeEach(async () => {
  conn = new SqliteConnection(':memory:');
  await conn.init();
  await runPendingMigrations('sqlite', conn, silent as never);
  store = new SqliteDeliverableStoreAdapter(conn);
});

afterEach(() => {
  conn.close();
});

describe('deliverable persistence with an unstorable character', () => {
  it('saves without throwing', async () => {
    // AC 20, first half — this is the operation that used to fail outright.
    await expect(store.save(makeDeliverable('d-1'))).resolves.toBeUndefined();
  });

  it('reads back the escaped content identically', async () => {
    // AC 20, second half — persisted and re-hydrated content must match what
    // the domain layer produced, byte for byte.
    const entity = makeDeliverable('d-1');
    await store.save(entity);

    const read = await store.getById('d-1');

    expect(read).not.toBeNull();
    expect(read!.content).toBe(entity.content);
    expect(read!.title).toBe(entity.title);
    expect(hasUnstorableChars(read!.content)).toBe(false);
  });

  it('keeps the sentence the author was writing about', async () => {
    await store.save(makeDeliverable('d-1'));

    const read = await store.getById('d-1');

    expect(read!.content).toContain('Use ' + escOf(NUL) + ' as the placeholder');
  });

  it('stores two submissions of the same payload as identical rows', async () => {
    // AC 21 at the persistence layer — the relaunch that used to loop forever.
    await store.save(makeDeliverable('d-1'));
    await store.save(makeDeliverable('d-2'));

    const [first, second] = await Promise.all([store.getById('d-1'), store.getById('d-2')]);

    expect(second!.content).toBe(first!.content);
    expect(second!.title).toBe(first!.title);
  });
});
