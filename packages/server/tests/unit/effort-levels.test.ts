import { describe, it, expect } from 'vitest';
import { EFFORT_LEVELS, FALLBACK_MODELS, inferModelCapabilities, isEffortLevel, resolveEffortLevel } from '@fleex/shared';

/**
 * The effort ladder grew one rung at a time, so "supports effort" is NOT the same
 * as "supports every level". Sending a level the model doesn't accept is a hard
 * 400 from the API, so these cases are the contract that keeps that from ever
 * reaching the SDK.
 */
describe('inferModelCapabilities — effort ladder per model', () => {
  const cases: Array<[string, string[]]> = [
    // Full ladder: Opus ≥ 4.7, Sonnet 5, and the Fable line.
    ['claude-opus-5', ['low', 'medium', 'high', 'xhigh', 'max']],
    ['claude-opus-4-8', ['low', 'medium', 'high', 'xhigh', 'max']],
    ['claude-opus-4-7', ['low', 'medium', 'high', 'xhigh', 'max']],
    ['claude-sonnet-5', ['low', 'medium', 'high', 'xhigh', 'max']],
    ['claude-fable-5', ['low', 'medium', 'high', 'xhigh', 'max']],
    // Gated on `isFable`, not on version weight — every Fable minor inherits the
    // full ladder, so a new one must never silently lose `xhigh`/`max`.
    ['claude-fable-5-1', ['low', 'medium', 'high', 'xhigh', 'max']],
    // 4.6 generation: `max` yes, `xhigh` no — it shipped with Opus 4.7.
    ['claude-opus-4-6', ['low', 'medium', 'high', 'max']],
    ['claude-sonnet-4-6', ['low', 'medium', 'high', 'max']],
    // Opus 4.5 predates `max` too.
    ['claude-opus-4-5', ['low', 'medium', 'high']],
    // No effort parameter at all.
    ['claude-haiku-4-5', []],
    ['claude-sonnet-4-5', []],
    ['gpt-something', []],
  ];

  for (const [id, expected] of cases) {
    it(`${id} → [${expected.join(', ')}]`, () => {
      const caps = inferModelCapabilities(id);
      expect(caps.effortLevels).toEqual(expected);
      expect(caps.supportsEffort).toBe(expected.length > 0);
    });
  }

  it('always lists levels ascending, matching the canonical ladder order', () => {
    for (const { id } of FALLBACK_MODELS) {
      const levels = inferModelCapabilities(id).effortLevels;
      const ranks = levels.map((l) => EFFORT_LEVELS.indexOf(l));
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    }
  });
});

describe('resolveEffortLevel', () => {
  it('passes through a level the model supports', () => {
    expect(resolveEffortLevel('claude-opus-5', 'xhigh')).toBe('xhigh');
    expect(resolveEffortLevel('claude-opus-5', 'max')).toBe('max');
    expect(resolveEffortLevel('claude-sonnet-4-6', 'max')).toBe('max');
  });

  it('clamps down to the highest level the model accepts', () => {
    // xhigh never shipped on Sonnet 4.6 / Opus 4.6 — 'high' is the next rung down.
    expect(resolveEffortLevel('claude-sonnet-4-6', 'xhigh')).toBe('high');
    expect(resolveEffortLevel('claude-opus-4-6', 'xhigh')).toBe('high');
    // Opus 4.5 has no xhigh AND no max.
    expect(resolveEffortLevel('claude-opus-4-5', 'max')).toBe('high');
    expect(resolveEffortLevel('claude-opus-4-5', 'xhigh')).toBe('high');
  });

  it('returns undefined for models without an effort parameter', () => {
    expect(resolveEffortLevel('claude-haiku-4-5', 'high')).toBeUndefined();
    expect(resolveEffortLevel('claude-haiku-4-5', 'max')).toBeUndefined();
  });

  it('returns undefined for absent or unrecognised values', () => {
    expect(resolveEffortLevel('claude-opus-5', null)).toBeUndefined();
    expect(resolveEffortLevel('claude-opus-5', undefined)).toBeUndefined();
    expect(resolveEffortLevel('claude-opus-5', '')).toBeUndefined();
    // A stale enum value read back from an older DB row must not be forwarded.
    expect(resolveEffortLevel('claude-opus-5', 'ultra')).toBeUndefined();
    expect(resolveEffortLevel('claude-opus-5', 'HIGH')).toBeUndefined();
  });

  it('never returns a level outside the model’s own list', () => {
    const requests = [...EFFORT_LEVELS, 'ultra', ''];
    for (const { id } of FALLBACK_MODELS) {
      const allowed = inferModelCapabilities(id).effortLevels;
      for (const req of requests) {
        const resolved = resolveEffortLevel(id, req);
        if (resolved !== undefined) expect(allowed).toContain(resolved);
      }
    }
  });
});

describe('isEffortLevel', () => {
  it('accepts the full ladder including the newer rungs', () => {
    expect(EFFORT_LEVELS.every(isEffortLevel)).toBe(true);
    expect(isEffortLevel('xhigh')).toBe(true);
    expect(isEffortLevel('max')).toBe(true);
  });

  it('rejects non-levels', () => {
    for (const v of ['', 'ultra', 'High', null, undefined, 3, {}]) {
      expect(isEffortLevel(v)).toBe(false);
    }
  });
});
