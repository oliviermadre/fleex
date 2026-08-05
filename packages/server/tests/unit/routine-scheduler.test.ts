import { describe, it, expect, vi } from 'vitest';
import type { RoutineTrigger } from '@fleex/shared';
import { RoutineEntity } from '../../src/domain/entities/routine.entity.js';
import { RoutineSchedulerService } from '../../src/domain/services/routine-scheduler.js';
import {
  assertTriggerValid,
  computeNextRunAt,
  nextRunTimes,
} from '../../src/domain/services/routine-schedule.js';
import { InvalidRoutineTriggerError } from '../../src/domain/errors.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

function makeRoutine(trigger: RoutineTrigger, overrides: Partial<{
  id: string; overlapPolicy: 'skip' | 'queue'; nextRunAt: Date | null; enabled: boolean;
}> = {}): RoutineEntity {
  const r = RoutineEntity.create({
    id: overrides.id ?? 'r-1',
    name: 'Dependency sweep',
    target: { kind: 'workflow' as const, ref: 'tmpl-1' },
    trigger,
    ...(overrides.overlapPolicy ? { overlapPolicy: overrides.overlapPolicy } : {}),
  });
  if (overrides.nextRunAt !== undefined) r.schedule(overrides.nextRunAt);
  if (overrides.enabled !== undefined) r.enabled = overrides.enabled;
  return r;
}

/** In-memory routine store; `getDue` / `getEnabled` mirror the SQL predicates. */
function makeStore(routines: RoutineEntity[]) {
  const byId = new Map(routines.map((r) => [r.id, r]));
  return {
    saves: [] as RoutineEntity[],
    getAll: async () => [...byId.values()],
    getById: async (id: string) => byId.get(id) ?? null,
    getBySlug: async () => null,
    getEnabled: async () => [...byId.values()].filter((r) => r.enabled),
    getDue: async (now: Date) => [...byId.values()].filter(
      (r) => r.enabled && r.nextRunAt !== null && r.nextRunAt.getTime() <= now.getTime(),
    ),
    save: async function (this: { saves: RoutineEntity[] }, r: RoutineEntity) {
      byId.set(r.id, r);
      this.saves.push(r);
    },
    delete: async () => {},
  };
}

function makeScheduler(routines: RoutineEntity[], activeRun: { id: string } | null = null) {
  const store = makeStore(routines);
  const runStore = { getActiveByRoutine: vi.fn().mockResolvedValue(activeRun) };
  const runRoutine = { execute: vi.fn().mockResolvedValue({ id: 'run-new' }) };
  const eventBus = { emit: vi.fn(), on: vi.fn() };
  const scheduler = new RoutineSchedulerService(eventBus as never, logger as never);
  scheduler.setDeps({ routineStore: store as never, runStore: runStore as never, runRoutine: runRoutine as never });
  return { scheduler, store, runStore, runRoutine, eventBus };
}

const PARIS = 'Europe/Paris';

describe('RoutineSchedulerService — a restart must not spawn a backlog of runs', () => {
  it('fires a 5-minute cron ONCE after a two-hour outage, not 24 times', async () => {
    // The whole point of the recompute: 24 slots elapsed while the process was
    // down. Replaying them would launch 24 concurrent agent sessions the moment
    // the server comes back — a thundering herd caused purely by our own
    // downtime. One run is the correct answer.
    const bootedAt = new Date('2026-08-04T12:00:00Z');
    const wentDownAt = new Date('2026-08-04T10:00:00Z');
    const routine = makeRoutine(
      { kind: 'cron', cron: '*/5 * * * *', timezone: PARIS },
      { nextRunAt: wentDownAt },
    );
    const { scheduler, runRoutine, store } = makeScheduler([routine]);

    await scheduler.tick(bootedAt);

    expect(runRoutine.execute).toHaveBeenCalledTimes(1);
    // And it is re-armed on the next slot after *now*, never on a missed one.
    const rearmed = (await store.getById('r-1'))!;
    expect(rearmed.nextRunAt!.getTime()).toBeGreaterThan(bootedAt.getTime());
    expect(rearmed.nextRunAt!.toISOString()).toBe('2026-08-04T12:05:00.000Z');
  });

  it('boot recompute moves a stale next_run_at forward instead of leaving it due', async () => {
    // A routine edited (or simply idle) while the process was down carries a
    // next_run_at from another era. Recomputing at boot is what stops the very
    // first tick from treating that stale instant as "due now".
    const bootedAt = new Date('2026-08-04T12:00:00Z');
    const routine = makeRoutine(
      { kind: 'cron', cron: '0 9 * * *', timezone: PARIS },
      { nextRunAt: new Date('2026-01-01T00:00:00Z') },
    );
    const { scheduler, store } = makeScheduler([routine]);

    await scheduler.recomputeAll(bootedAt);

    const rearmed = (await store.getById('r-1'))!;
    expect(rearmed.nextRunAt!.getTime()).toBeGreaterThan(bootedAt.getTime());
    // 09:00 Paris on 5 Aug is 07:00 UTC (CEST, +2) — the timezone is honoured,
    // not silently reduced to UTC.
    expect(rearmed.nextRunAt!.toISOString()).toBe('2026-08-05T07:00:00.000Z');
  });

  it('leaves a one-shot armed at its missed instant so a single intent is not lost', async () => {
    // Symmetrical to the cron rule but for the opposite reason: a `once` has no
    // backlog to replay, so dropping it would silently lose the only run the
    // author asked for.
    const missedAt = new Date('2026-08-04T09:00:00Z');
    const routine = makeRoutine({ kind: 'once', runAt: missedAt.toISOString(), timezone: PARIS });
    const { scheduler, store } = makeScheduler([routine]);

    await scheduler.recomputeAll(new Date('2026-08-04T12:00:00Z'));

    expect((await store.getById('r-1'))!.nextRunAt!.toISOString()).toBe(missedAt.toISOString());
  });
});

describe('RoutineSchedulerService — overlapPolicy', () => {
  it('skip: does not start a second run while one is active, and says so', async () => {
    // Two runs of the same routine would race on the same worktree and the same
    // subject. The skip must be announced, otherwise the routine looks like it
    // simply stopped firing.
    const now = new Date('2026-08-04T12:00:00Z');
    const routine = makeRoutine(
      { kind: 'cron', cron: '*/5 * * * *', timezone: PARIS },
      { overlapPolicy: 'skip', nextRunAt: now },
    );
    const { scheduler, runRoutine, eventBus, store } = makeScheduler([routine], { id: 'run-active' });

    await scheduler.tick(now);

    expect(runRoutine.execute).not.toHaveBeenCalled();
    expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
      type: 'routine.run_skipped', routineId: 'r-1', activeRunId: 'run-active', reason: 'overlap',
    }));
    // The occurrence is dropped: the schedule moves on rather than retrying.
    expect((await store.getById('r-1'))!.nextRunAt!.getTime()).toBeGreaterThan(now.getTime());
  });

  it('queue: holds the occurrence so the next free tick runs it', async () => {
    // `queue` means "run it as soon as the routine is free", so the due instant
    // must NOT be advanced — otherwise the occurrence is silently a skip.
    const now = new Date('2026-08-04T12:00:00Z');
    const routine = makeRoutine(
      { kind: 'cron', cron: '*/5 * * * *', timezone: PARIS },
      { overlapPolicy: 'queue', nextRunAt: now },
    );
    const { scheduler, runRoutine, runStore, store } = makeScheduler([routine], { id: 'run-active' });

    await scheduler.tick(now);
    expect(runRoutine.execute).not.toHaveBeenCalled();
    expect((await store.getById('r-1'))!.nextRunAt!.getTime()).toBe(now.getTime());

    // The active run ends; the very next tick picks the held occurrence up.
    runStore.getActiveByRoutine.mockResolvedValue(null);
    await scheduler.tick(new Date('2026-08-04T12:01:00Z'));
    expect(runRoutine.execute).toHaveBeenCalledTimes(1);
  });
});

describe('RoutineSchedulerService — a one-shot fires exactly once', () => {
  it('disables itself after firing so a reboot cannot re-fire it', async () => {
    // Clearing next_run_at alone is not enough: the row outlives the process,
    // and the next boot recompute would happily re-arm the same past instant.
    const now = new Date('2026-08-04T12:00:00Z');
    const routine = makeRoutine(
      { kind: 'once', runAt: '2026-08-04T11:59:00Z', timezone: PARIS },
      { nextRunAt: new Date('2026-08-04T11:59:00Z') },
    );
    const { scheduler, runRoutine, store } = makeScheduler([routine]);

    await scheduler.tick(now);
    expect(runRoutine.execute).toHaveBeenCalledTimes(1);

    const after = (await store.getById('r-1'))!;
    expect(after.enabled).toBe(false);
    expect(after.nextRunAt).toBeNull();

    // Second tick — and a full boot recompute — must find nothing to do.
    await scheduler.recomputeAll(now);
    await scheduler.tick(new Date('2026-08-04T12:05:00Z'));
    expect(runRoutine.execute).toHaveBeenCalledTimes(1);
  });

  it('marks the launch as scheduled so the announcement can tell it from a click', async () => {
    // `routine.run_started` is emitted by RunRoutineUseCase, not here — that is
    // the single door every launch goes through. All the scheduler owes the
    // event is the origin: `triggeredFrom: 'schedule'`.
    const now = new Date('2026-08-04T12:00:00Z');
    const routine = makeRoutine(
      { kind: 'once', runAt: now.toISOString(), timezone: PARIS },
      { nextRunAt: now },
    );
    const { scheduler, runRoutine } = makeScheduler([routine]);

    await scheduler.tick(now);

    expect(runRoutine.execute).toHaveBeenCalledWith(expect.objectContaining({
      routineId: 'r-1', triggeredFrom: 'schedule',
    }));
  });

  it('still advances the schedule when the launch throws', async () => {
    // A routine whose template was deleted must not retry every 60 s forever.
    const now = new Date('2026-08-04T12:00:00Z');
    const routine = makeRoutine(
      { kind: 'cron', cron: '*/5 * * * *', timezone: PARIS },
      { nextRunAt: now },
    );
    const { scheduler, runRoutine, store } = makeScheduler([routine]);
    runRoutine.execute.mockRejectedValue(new Error('template gone'));

    await scheduler.tick(now);

    expect((await store.getById('r-1'))!.nextRunAt!.getTime()).toBeGreaterThan(now.getTime());
  });
});

describe('trigger validation — a malformed schedule is refused, never silently inert', () => {
  it('rejects an unparseable cron expression', () => {
    // Stored as-is, this routine would sit in the list looking armed while the
    // scheduler could never derive a fire time from it.
    expect(() => assertTriggerValid({ kind: 'cron', cron: 'every monday', timezone: PARIS }))
      .toThrow(InvalidRoutineTriggerError);
  });

  it('rejects a 6-field (seconds) cron because the tick is once a minute', () => {
    // Accepting it would fire once a minute, not every ten seconds, and the
    // author would blame the engine rather than the expression.
    expect(() => assertTriggerValid({ kind: 'cron', cron: '*/10 * * * * *', timezone: PARIS }))
      .toThrow(/5 fields/);
  });

  it('rejects an unknown timezone — "Europe/Pariz" must not resolve to UTC', () => {
    expect(() => assertTriggerValid({ kind: 'cron', cron: '0 9 * * *', timezone: 'Europe/Pariz' }))
      .toThrow(/not a known IANA timezone/);
  });

  it('rejects a non-ISO runAt', () => {
    expect(() => assertTriggerValid({ kind: 'once', runAt: 'tomorrow morning', timezone: PARIS }))
      .toThrow(/valid ISO date-time/);
  });

  it('accepts manual with nothing else and schedules nothing', () => {
    expect(() => assertTriggerValid({ kind: 'manual' })).not.toThrow();
    expect(computeNextRunAt({ kind: 'manual' }, new Date())).toBeNull();
  });

  it('previews fire times in the routine timezone, across a DST boundary', () => {
    // 09:00 Paris is 08:00 UTC in winter (CET) and 07:00 UTC in summer (CEST).
    // A preview that shows the same UTC hour on both sides of the change is the
    // bug this dependency exists to avoid.
    const winter = nextRunTimes(
      { kind: 'cron', cron: '0 9 * * *', timezone: PARIS },
      new Date('2026-01-15T00:00:00Z'), 1,
    );
    const summer = nextRunTimes(
      { kind: 'cron', cron: '0 9 * * *', timezone: PARIS },
      new Date('2026-07-15T00:00:00Z'), 1,
    );
    expect(winter[0]!.toISOString()).toBe('2026-01-15T08:00:00.000Z');
    expect(summer[0]!.toISOString()).toBe('2026-07-15T07:00:00.000Z');
  });

  it('previews nothing for a once whose moment has passed', () => {
    expect(nextRunTimes(
      { kind: 'once', runAt: '2020-01-01T00:00:00Z', timezone: PARIS },
      new Date('2026-08-04T12:00:00Z'), 5,
    )).toEqual([]);
  });
});
