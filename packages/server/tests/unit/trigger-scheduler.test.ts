import { describe, it, expect, vi } from 'vitest';
import { TriggerScheduler } from '../../src/domain/services/trigger-scheduler.js';
import { TriggerEntity } from '../../src/domain/entities/trigger.entity.js';
import type { TriggerStorePort, ClaimedTrigger } from '../../src/application/ports/trigger-store.port.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;

function makeTrigger(): TriggerEntity {
  return TriggerEntity.create({
    id: 't1', name: 'N', slug: 'n', targetType: 'workflow', targetRef: 'wf',
    config: { scheduleKind: 'interval', intervalMs: 60_000 },
  });
}

describe('TriggerScheduler', () => {
  it('claims due triggers and runs each', async () => {
    const trigger = makeTrigger();
    const claimed: ClaimedTrigger[] = [{ trigger, scheduledFor: new Date() }];
    const store = {
      claimDue: vi.fn(async () => claimed),
    } as unknown as TriggerStorePort;

    const scheduler = new TriggerScheduler(store, logger);
    const runner = vi.fn(async () => {});
    scheduler.setRunner(runner);

    await scheduler.tick(new Date());

    expect(store.claimDue).toHaveBeenCalledOnce();
    expect(runner).toHaveBeenCalledOnce();
    expect(runner).toHaveBeenCalledWith(claimed[0]);
  });

  it('does nothing when no runner is set', async () => {
    const store = { claimDue: vi.fn(async () => []) } as unknown as TriggerStorePort;
    const scheduler = new TriggerScheduler(store, logger);
    await scheduler.tick(new Date());
    expect(store.claimDue).not.toHaveBeenCalled();
  });

  it('continues past a runner that throws', async () => {
    const claimed: ClaimedTrigger[] = [
      { trigger: makeTrigger(), scheduledFor: new Date() },
      { trigger: makeTrigger(), scheduledFor: new Date() },
    ];
    const store = { claimDue: vi.fn(async () => claimed) } as unknown as TriggerStorePort;
    const scheduler = new TriggerScheduler(store, logger);
    const runner = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);
    scheduler.setRunner(runner);

    await scheduler.tick(new Date());
    expect(runner).toHaveBeenCalledTimes(2);
  });
});
