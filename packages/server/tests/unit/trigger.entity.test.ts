import { describe, it, expect } from 'vitest';
import { TriggerEntity } from '../../src/domain/entities/trigger.entity.js';

const base = {
  id: 't1',
  name: 'Nightly import',
  slug: 'nightly-import',
  targetType: 'workflow' as const,
  targetRef: 'github-import',
};

describe('TriggerEntity', () => {
  it('creates a cron trigger and seeds nextRunAt', () => {
    const t = TriggerEntity.create({
      ...base,
      config: { scheduleKind: 'cron', scheduleExpr: '0 * * * *' },
    });
    expect(t.mode).toBe('plan');
    expect(t.enabled).toBe(true);
    expect(t.nextRunAt).toBeInstanceOf(Date);
    expect(t.nextRunAt!.getUTCMinutes()).toBe(0);
  });

  it('disabled trigger has no nextRunAt', () => {
    const t = TriggerEntity.create({
      ...base,
      enabled: false,
      config: { scheduleKind: 'cron', scheduleExpr: '0 * * * *' },
    });
    expect(t.nextRunAt).toBeNull();
  });

  it('interval computeNextRun adds the interval', () => {
    const t = TriggerEntity.create({
      ...base,
      config: { scheduleKind: 'interval', intervalMs: 60_000 },
    });
    const from = new Date('2026-01-01T00:00:00.000Z');
    expect(t.computeNextRun(from)?.toISOString()).toBe('2026-01-01T00:01:00.000Z');
  });

  it('rejects an invalid slug', () => {
    expect(() => TriggerEntity.create({
      ...base, slug: 'Bad Slug',
      config: { scheduleKind: 'interval', intervalMs: 60_000 },
    })).toThrow(/slug/);
  });

  it('rejects a too-small interval', () => {
    expect(() => TriggerEntity.create({
      ...base,
      config: { scheduleKind: 'interval', intervalMs: 10 },
    })).toThrow(/intervalMs/);
  });

  it('rejects a cron without expression', () => {
    expect(() => TriggerEntity.create({
      ...base,
      config: { scheduleKind: 'cron' },
    })).toThrow(/scheduleExpr/);
  });

  it('isDue reflects nextRunAt vs now', () => {
    const t = TriggerEntity.create({
      ...base,
      config: { scheduleKind: 'interval', intervalMs: 60_000 },
    });
    t.nextRunAt = new Date('2026-01-01T00:00:00.000Z');
    expect(t.isDue(new Date('2026-01-01T00:00:01.000Z'))).toBe(true);
    expect(t.isDue(new Date('2025-12-31T23:59:00.000Z'))).toBe(false);
  });
});
