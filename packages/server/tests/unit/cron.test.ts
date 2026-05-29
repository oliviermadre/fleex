import { describe, it, expect } from 'vitest';
import { nextCronTime, parseCron, assertValidCron } from '../../src/domain/services/cron.js';

describe('cron', () => {
  describe('parseCron', () => {
    it('rejects expressions without 5 fields', () => {
      expect(() => parseCron('* * * *')).toThrow(/5 fields/);
      expect(() => parseCron('* * * * * *')).toThrow(/5 fields/);
    });

    it('rejects out-of-range values', () => {
      expect(() => parseCron('60 * * * *')).toThrow();
      expect(() => parseCron('* 24 * * *')).toThrow();
    });

    it('accepts steps, ranges and lists', () => {
      expect(() => assertValidCron('*/15 0-6,12 1-15 */2 1-5')).not.toThrow();
    });
  });

  describe('nextCronTime (UTC)', () => {
    it('every minute -> next whole minute', () => {
      const from = new Date('2026-01-01T00:00:30.000Z');
      const next = nextCronTime('* * * * *', from);
      expect(next?.toISOString()).toBe('2026-01-01T00:01:00.000Z');
    });

    it('hourly at minute 0', () => {
      const from = new Date('2026-01-01T10:15:00.000Z');
      const next = nextCronTime('0 * * * *', from);
      expect(next?.toISOString()).toBe('2026-01-01T11:00:00.000Z');
    });

    it('every 15 minutes', () => {
      const from = new Date('2026-01-01T10:07:00.000Z');
      expect(nextCronTime('*/15 * * * *', from)?.toISOString()).toBe('2026-01-01T10:15:00.000Z');
    });

    it('daily at 09:30', () => {
      const from = new Date('2026-01-01T10:00:00.000Z');
      const next = nextCronTime('30 9 * * *', from);
      expect(next?.toISOString()).toBe('2026-01-02T09:30:00.000Z');
    });

    it('day-of-week: next Monday 00:00 (Sunday=0)', () => {
      // 2026-01-01 is a Thursday.
      const from = new Date('2026-01-01T00:00:00.000Z');
      const next = nextCronTime('0 0 * * 1', from);
      expect(next?.getUTCDay()).toBe(1);
      expect(next?.toISOString()).toBe('2026-01-05T00:00:00.000Z');
    });

    it('dom OR dow when both restricted', () => {
      // minute 0, hour 0, dom=15, dow=1(Mon). Either should match.
      const from = new Date('2026-01-01T00:00:00.000Z');
      const next = nextCronTime('0 0 15 * 1', from);
      // First match after Jan 1 (Thu): Mon Jan 5 (dow) precedes the 15th (dom).
      expect(next?.toISOString()).toBe('2026-01-05T00:00:00.000Z');
    });
  });

  describe('nextCronTime (timezone)', () => {
    it('daily at 00:00 in a +ve offset zone resolves to the right UTC instant', () => {
      // Tokyo is UTC+9 year-round. 00:00 JST == 15:00 UTC previous day.
      const from = new Date('2026-03-10T05:00:00.000Z');
      const next = nextCronTime('0 0 * * *', from, 'Asia/Tokyo');
      expect(next?.toISOString()).toBe('2026-03-10T15:00:00.000Z');
    });
  });
});
