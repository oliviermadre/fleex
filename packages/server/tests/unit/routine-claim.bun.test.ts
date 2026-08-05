/**
 * Integration tests — the routine claim against a real SQLite database.
 *
 * The in-memory fake in `routine-scheduler.test.ts` asserts the scheduler acts
 * correctly *given* a compare-and-swap; these assert the compare-and-swap is
 * actually there in SQL. Two Fleex instances on one machine (`~/.fleex/repo`
 * plus a QA worktree) really do share `~/.fleex/fleex.db`, so this is the
 * codepath that decides whether a daily routine fires once or twice.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteConnection } from '../../src/infrastructure/adapters/sqlite/connection.js';
import { SqliteRoutineStoreAdapter } from '../../src/infrastructure/adapters/sqlite/sqlite-routine-store.adapter.js';
import { RoutineEntity } from '../../src/domain/entities/routine.entity.js';
import { runPendingMigrations } from '../../src/infrastructure/migrations/run-migrations.js';

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

const DUE = new Date('2026-08-04T12:00:00.000Z');
const NEXT = new Date('2026-08-04T12:05:00.000Z');

let conn: SqliteConnection;
let store: SqliteRoutineStoreAdapter;

function makeRoutine(nextRunAt: Date | null = DUE): RoutineEntity {
  const r = RoutineEntity.create({
    id: 'routine-1',
    name: 'Dependency sweep',
    target: { kind: 'workflow', ref: 'tmpl-1' },
    trigger: { kind: 'cron', cron: '*/5 * * * *', timezone: 'Europe/Paris' },
  });
  r.schedule(nextRunAt);
  return r;
}

beforeEach(async () => {
  conn = new SqliteConnection(':memory:');
  await conn.init();
  await runPendingMigrations('sqlite', conn, silent as never);
  store = new SqliteRoutineStoreAdapter(conn);

  // A workflow target is an FK to workflow_templates — required even though
  // nothing here ever runs the template.
  conn.db.exec(`
    INSERT INTO workflow_templates (id, name, slug, steps, edges, entry_step_id, enabled, created_at, updated_at)
    VALUES ('tmpl-1', 'Test WF', 'test-wf', '[]', '[]', 'step-1', 1,
            datetime('now'), datetime('now'))
  `);
});

afterEach(() => {
  conn.close();
});

describe('SqliteRoutineStoreAdapter.claimDue — one occurrence, one winner', () => {
  it('gives the occurrence to the first claimant and refuses the second', async () => {
    await store.save(makeRoutine());

    // Both instances read the same due row, then both try to take it.
    const [first, second] = [
      await store.claimDue({
        id: 'routine-1', observedNextRunAt: DUE, nextRunAt: NEXT,
        claimedBy: 'mbp:3000', claimedAt: DUE,
      }),
      await store.claimDue({
        id: 'routine-1', observedNextRunAt: DUE, nextRunAt: NEXT,
        claimedBy: 'imac:3000', claimedAt: DUE,
      }),
    ];

    expect(first).toBe(true);
    expect(second).toBe(false);

    const after = (await store.getById('routine-1'))!;
    expect(after.nextRunAt!.toISOString()).toBe(NEXT.toISOString());
    expect(after.lastClaimedBy).toBe('mbp:3000');
    expect(after.lastClaimedAt!.toISOString()).toBe(DUE.toISOString());
  });

  it('refuses a claim on a routine that was disarmed meanwhile', async () => {
    // Someone disabled the routine from the other machine between the read and
    // the claim. `next_run_at` is null, so the witness cannot match.
    await store.save(makeRoutine(null));

    const won = await store.claimDue({
      id: 'routine-1', observedNextRunAt: DUE, nextRunAt: NEXT,
      claimedBy: 'mbp:3000', claimedAt: DUE,
    });
    expect(won).toBe(false);
    expect((await store.getById('routine-1'))!.nextRunAt).toBeNull();
  });

  it('refuses a claim on a routine that no longer exists', async () => {
    const won = await store.claimDue({
      id: 'ghost', observedNextRunAt: DUE, nextRunAt: NEXT,
      claimedBy: 'mbp:3000', claimedAt: DUE,
    });
    expect(won).toBe(false);
  });

  it('disarms and disables a one-shot in the same atomic write', async () => {
    // Two statements would leave a window in which the routine is disarmed but
    // still enabled — and a boot recompute landing there re-arms it.
    const once = RoutineEntity.create({
      id: 'routine-1', name: 'One shot',
      target: { kind: 'workflow', ref: 'tmpl-1' },
      trigger: { kind: 'once', runAt: DUE.toISOString(), timezone: 'Europe/Paris' },
    });
    once.schedule(DUE);
    await store.save(once);

    expect(await store.claimDue({
      id: 'routine-1', observedNextRunAt: DUE, nextRunAt: null, disable: true,
      claimedBy: 'mbp:3000', claimedAt: DUE,
    })).toBe(true);

    const after = (await store.getById('routine-1'))!;
    expect(after.nextRunAt).toBeNull();
    expect(after.enabled).toBe(false);
    // …and the disarmed row is invisible to the next tick, on any instance.
    expect(await store.getDue(new Date('2026-08-04T13:00:00Z'))).toHaveLength(0);
  });

  it('leaves enabled alone when the claim does not disable', async () => {
    await store.save(makeRoutine());
    await store.claimDue({
      id: 'routine-1', observedNextRunAt: DUE, nextRunAt: NEXT,
      claimedBy: 'mbp:3000', claimedAt: DUE,
    });
    expect((await store.getById('routine-1'))!.enabled).toBe(true);
  });

  it('does not disturb the run pointer another instance just recorded', async () => {
    // The regression this replaced: the scheduler used to write the whole row
    // from an entity it had read seconds earlier, reverting the `last_run_id`
    // the winning instance had recorded in between.
    await store.save(makeRoutine());

    // The winner's real sequence: claim the occurrence, then record the run it
    // launched (RunRoutineUseCase does that through a full-row save).
    expect(await store.claimDue({
      id: 'routine-1', observedNextRunAt: DUE, nextRunAt: NEXT,
      claimedBy: 'mbp:3000', claimedAt: DUE,
    })).toBe(true);
    const winner = (await store.getById('routine-1'))!;
    winner.recordRun('run-42');
    await store.save(winner);

    // The loser gets here late, still holding the witness it read before the
    // claim. It must bounce off rather than write anything.
    expect(await store.claimDue({
      id: 'routine-1', observedNextRunAt: DUE, nextRunAt: NEXT,
      claimedBy: 'imac:3000', claimedAt: DUE,
    })).toBe(false);

    expect((await store.getById('routine-1'))!.lastRunId).toBe('run-42');
  });

  it('keeps a recorded claim through an ordinary save', async () => {
    // `save()` is the full-row upsert used by every edit. It must not carry the
    // claim columns, or renaming a routine on one machine would erase the trace
    // of where its last occurrence ran.
    await store.save(makeRoutine());
    await store.claimDue({
      id: 'routine-1', observedNextRunAt: DUE, nextRunAt: NEXT,
      claimedBy: 'mbp:3000', claimedAt: DUE,
    });

    const edited = (await store.getById('routine-1'))!;
    edited.update({ name: 'Renamed sweep' });
    await store.save(edited);

    const after = (await store.getById('routine-1'))!;
    expect(after.name).toBe('Renamed sweep');
    expect(after.lastClaimedBy).toBe('mbp:3000');
  });
});

describe('SqliteRoutineStoreAdapter.rearm — the boot recompute writes narrowly', () => {
  it('moves next_run_at without touching the rest of the row', async () => {
    const routine = makeRoutine();
    routine.recordRun('run-7');
    await store.save(routine);

    await store.rearm('routine-1', NEXT);

    const after = (await store.getById('routine-1'))!;
    expect(after.nextRunAt!.toISOString()).toBe(NEXT.toISOString());
    expect(after.lastRunId).toBe('run-7');
    expect(after.enabled).toBe(true);
  });

  it('disarms with null', async () => {
    await store.save(makeRoutine());
    await store.rearm('routine-1', null);
    expect((await store.getById('routine-1'))!.nextRunAt).toBeNull();
  });
});
