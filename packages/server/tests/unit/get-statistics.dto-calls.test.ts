/**
 * AC4 — `toDTO()` is a materialisation boundary, not a per-bucket helper.
 *
 * The pre-refactor implementation re-derived DTOs inside the per-bucket loops,
 * so the conversion count scaled with `buckets × entities`. Over a year of daily
 * buckets that is ~365× more allocations than the response actually needs. These
 * tests pin the invariant that made the rewrite worthwhile: widening the window
 * must not change how often any entity is converted.
 */
process.env['TZ'] = 'UTC';

import { describe, it, expect, vi } from 'vitest';

import { buildFixture, TZ_OFFSET_MINUTES } from '../helpers/statistics-fixture.js';

/** A year of daily buckets — the case that made the old behaviour pathological. */
const YEAR_FROM = '2026-01-01T00:00:00.000Z';
const YEAR_TO = '2026-12-31T00:00:00.000Z';

interface HasToDTO {
  toDTO(): unknown;
}

function spyOnAll(entities: readonly unknown[]) {
  return entities.map((e) => vi.spyOn(e as HasToDTO, 'toDTO'));
}

describe('GetStatisticsUseCase — toDTO() call budget (AC4)', () => {
  it('converts each entity at most once, regardless of bucket count', async () => {
    const fx = buildFixture();

    const spies = {
      tickets: spyOnAll(fx.tickets),
      comments: spyOnAll(fx.comments),
      mentions: spyOnAll(fx.mentions),
      deliverables: spyOnAll(fx.deliverables),
    };

    await fx.useCase.execute({
      from: YEAR_FROM,
      to: YEAR_TO,
      granularity: 'day',
      tzOffsetMinutes: TZ_OFFSET_MINUTES,
    });

    for (const [kind, group] of Object.entries(spies)) {
      for (const [i, spy] of group.entries()) {
        expect(
          spy.mock.calls.length,
          `${kind}[${i}].toDTO() called ${spy.mock.calls.length}× — must be at most once`,
        ).toBeLessThanOrEqual(1);
      }
    }
  });

  it('does not convert more entities for 365 buckets than for 1', async () => {
    const countFor = async (from: string, to: string, granularity: 'day' | 'month') => {
      const fx = buildFixture();
      const spies = [
        ...spyOnAll(fx.tickets),
        ...spyOnAll(fx.comments),
        ...spyOnAll(fx.mentions),
        ...spyOnAll(fx.deliverables),
      ];
      await fx.useCase.execute({ from, to, granularity, tzOffsetMinutes: TZ_OFFSET_MINUTES });
      return spies.reduce((n, s) => n + s.mock.calls.length, 0);
    };

    const oneBucket = await countFor(
      '2026-06-01T00:00:00.000Z',
      '2026-06-08T00:00:00.000Z',
      'month',
    );
    const manyBuckets = await countFor(YEAR_FROM, YEAR_TO, 'day');

    // Not just "equal" — the count must be flat in the number of buckets.
    expect(manyBuckets).toBe(oneBucket);
  });
});
