import { describe, it, expect, vi } from 'vitest';
import type { RoutineTrigger } from '@fleex/shared';
import type { RoutineClaim } from '../../src/application/ports/routine-store.port.js';
import type { KvStorePort } from '../../src/application/ports/kv-store.port.js';
import { RoutineEntity } from '../../src/domain/entities/routine.entity.js';
import { RoutineSchedulerService, type MissedSlot } from '../../src/domain/services/routine-scheduler.js';
import { KvMissedSlotRecorder, listMissedSlots } from '../../src/application/services/missed-slots.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
const HOURLY: RoutineTrigger = { kind: 'cron', cron: '0 * * * *', timezone: 'UTC' };
const D = (s: string) => new Date(s);

function routine(trigger: RoutineTrigger, nextRunAt: Date | null, enabled = true) {
  const r = RoutineEntity.create({ id: 'r1', name: 'Hourly', target: { kind: 'workflow', ref: 'tpl' }, trigger });
  r.schedule(nextRunAt);
  r.enabled = enabled;
  return r;
}

function scheduler(r: RoutineEntity) {
  const store = {
    getEnabled: async () => (r.enabled ? [r] : []),
    getDue: async (now: Date) => (r.enabled && r.nextRunAt && r.nextRunAt <= now ? [r] : []),
    claimDue: async (c: RoutineClaim) => { r.nextRunAt = c.nextRunAt; return true; },
    rearm: async (_id: string, next: Date | null) => { r.nextRunAt = next; },
  };
  const recorded: MissedSlot[] = [];
  const s = new RoutineSchedulerService({ emit: vi.fn(), on: vi.fn() } as never, logger as never, 'test');
  s.setDeps({
    routineStore: store as never,
    runStore: { getActiveByRoutine: async () => null } as never,
    runRoutine: { execute: vi.fn().mockResolvedValue({ id: 'run' }) } as never,
  });
  s.setMissedSlotRecorder({ record: async (slots) => { recorded.push(...slots); } });
  const slots = () => recorded.map((m) => m.slotAt.toISOString());
  return { s, recorded, slots };
}

describe('RoutineSchedulerService — missed slots (agenda R3 scheduler_down)', () => {
  it('records every slot from the stale next_run_at to now at boot recompute', async () => {
    const { s, recorded, slots } = scheduler(routine(HOURLY, D('2026-11-05T02:00:00Z')));
    await s.recomputeAll(D('2026-11-05T04:30:00Z'));
    expect(slots()).toEqual(['2026-11-05T02:00:00.000Z', '2026-11-05T03:00:00.000Z', '2026-11-05T04:00:00.000Z']);
    expect(recorded.every((m) => m.routineId === 'r1' && m.detectedAt.toISOString() === '2026-11-05T04:30:00.000Z')).toBe(true);
  });

  it('records the slots after the observed one that a late tick jumps over — the observed one fires', async () => {
    const { s, slots } = scheduler(routine(HOURLY, D('2026-11-05T02:00:00Z')));
    await s.tick(D('2026-11-05T04:10:00Z'));
    expect(slots()).toEqual(['2026-11-05T03:00:00.000Z', '2026-11-05T04:00:00.000Z']);
  });

  it('records nothing for an on-time tick, a disabled routine or a one-shot', async () => {
    const onTime = scheduler(routine(HOURLY, D('2026-11-05T02:00:00Z')));
    await onTime.s.tick(D('2026-11-05T02:00:30Z'));
    expect(onTime.recorded).toEqual([]);

    const off = scheduler(routine(HOURLY, D('2026-11-05T02:00:00Z'), false));
    await off.s.recomputeAll(D('2026-11-05T04:30:00Z'));
    await off.s.tick(D('2026-11-05T04:30:00Z'));
    expect(off.recorded).toEqual([]);

    const once = scheduler(routine({ kind: 'once', runAt: '2026-11-05T02:00:00Z', timezone: 'UTC' }, D('2026-11-05T02:00:00Z')));
    await once.s.recomputeAll(D('2026-11-05T04:30:00Z'));
    await once.s.tick(D('2026-11-05T04:30:00Z'));
    expect(once.recorded).toEqual([]);
  });

  it('caps one detection at 500 slots', async () => {
    const { s, recorded } = scheduler(routine({ kind: 'cron', cron: '* * * * *', timezone: 'UTC' }, D('2026-11-01T00:00:00Z')));
    await s.recomputeAll(D('2026-11-05T00:00:00Z'));
    expect(recorded).toHaveLength(500);
  });

  it('keeps scheduling when the recorder fails', async () => {
    const r = routine(HOURLY, D('2026-11-05T02:00:00Z'));
    const { s } = scheduler(r);
    s.setMissedSlotRecorder({ record: async () => { throw new Error('kv down'); } });
    await s.recomputeAll(D('2026-11-05T04:30:00Z'));
    expect(r.nextRunAt?.toISOString()).toBe('2026-11-05T05:00:00.000Z');
  });
});

describe('KvMissedSlotRecorder', () => {
  it('writes one key per slot, idempotently, and reads them back', async () => {
    const data = new Map<string, string>();
    const kv: KvStorePort = {
      get: async (k) => data.get(k) ?? null,
      set: async (k, v) => { data.set(k, v); },
      delete: async (k) => { data.delete(k); },
      listByPrefix: async (p) => [...data].filter(([k]) => k.startsWith(p)).map(([key, value]) => ({ key, value })),
    };
    const rec = new KvMissedSlotRecorder(kv);
    const slot = { routineId: 'r1', slotAt: D('2026-11-05T03:00:00Z'), detectedAt: D('2026-11-05T04:30:00Z') };
    await rec.record([slot]);
    await rec.record([slot]);
    expect([...data.keys()]).toEqual(['agenda:missed:r1:2026-11-05T03:00:00.000Z']);
    expect(await listMissedSlots(kv)).toEqual([
      { routineId: 'r1', slotAt: '2026-11-05T03:00:00.000Z', detectedAt: '2026-11-05T04:30:00.000Z', reason: 'scheduler_down' },
    ]);
  });
});
