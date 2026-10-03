import { describe, it, expect } from 'vitest';
import { ciLabel, ciHue, ciTooltip, formatCheckDuration, mergeBlockReason, mergeMethodLabel } from './prCi';

describe('ciLabel / ciHue', () => {
  it('maps each chip status to the label and colour the user reads at a glance', () => {
    expect(ciLabel('passed')).toBe('CI passed');
    expect(ciLabel('failed')).toBe('CI failed');
    expect(ciLabel('running')).toBe('CI running');
    expect(ciLabel('none')).toBe('No CI');
    expect(ciLabel('error')).toBe('CI ?');
    expect(ciHue('passed')).toBe('green');
    expect(ciHue('failed')).toBe('red');
    expect(ciHue('running')).toBe('yellow');
    expect(ciHue('error')).toBe('gray');
  });
});

describe('ciTooltip', () => {
  it('lists only non-empty buckets, passed first', () => {
    expect(ciTooltip({ running: 2, fail: 1, pass: 3, skip: 0 })).toBe('3 passed · 1 failed · 2 running');
  });
  it('is empty when there is nothing to count', () => {
    expect(ciTooltip({})).toBe('');
  });
});

describe('mergeBlockReason', () => {
  const ok = { isDraft: false, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN' } as const;

  it('lets a clean PR merge with no message', () => {
    expect(mergeBlockReason(ok)).toEqual({ blocked: false, message: null });
  });

  it('blocks a draft before anything else, since GitHub refuses drafts outright', () => {
    expect(mergeBlockReason({ ...ok, isDraft: true, mergeable: 'CONFLICTING' }).message).toMatch(/Draft PR/);
  });

  it.each([
    [{ mergeable: 'CONFLICTING' }, 'Merge conflicts'],
    [{ mergeStateStatus: 'DIRTY' }, 'Merge conflicts'],
    [{ mergeStateStatus: 'BEHIND' }, 'Branch is behind base — update it on GitHub'],
    [{ mergeStateStatus: 'BLOCKED' }, 'Blocked by branch protection (reviews or required checks)'],
    [{ mergeable: 'UNKNOWN' }, 'Checking mergeability…'],
    [{ mergeStateStatus: 'UNKNOWN' }, 'Checking mergeability…'],
  ] as const)('blocks %o', (patch, message) => {
    expect(mergeBlockReason({ ...ok, ...patch })).toEqual({ blocked: true, message });
  });

  it('allows UNSTABLE and HAS_HOOKS, warning only for UNSTABLE', () => {
    expect(mergeBlockReason({ ...ok, mergeStateStatus: 'UNSTABLE' })).toEqual({ blocked: false, message: 'Some non-required checks failed' });
    expect(mergeBlockReason({ ...ok, mergeStateStatus: 'HAS_HOOKS' })).toEqual({ blocked: false, message: null });
  });
});

describe('formatCheckDuration', () => {
  const at = (s: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, s)).toISOString();
  it('formats finished checks', () => {
    expect(formatCheckDuration({ bucket: 'pass', startedAt: at(0), completedAt: at(134) })).toBe('2m 14s');
    expect(formatCheckDuration({ bucket: 'fail', startedAt: at(0), completedAt: at(9) })).toBe('9s');
    expect(formatCheckDuration({ bucket: 'pass', startedAt: at(0), completedAt: at(3725) })).toBe('1h 2m');
  });
  it('says running/pending instead of a duration while the check is not done', () => {
    expect(formatCheckDuration({ bucket: 'running', startedAt: at(0), completedAt: null })).toBe('running');
    expect(formatCheckDuration({ bucket: 'pending', startedAt: null, completedAt: null })).toBe('pending');
  });
  it('shows nothing when GitHub gave no times', () => {
    expect(formatCheckDuration({ bucket: 'pass', startedAt: null, completedAt: null })).toBe('');
  });
});

describe('mergeMethodLabel', () => {
  it('uses GitHub wording', () => {
    expect(mergeMethodLabel('squash')).toBe('Squash and merge');
    expect(mergeMethodLabel('merge')).toBe('Create a merge commit');
    expect(mergeMethodLabel('rebase')).toBe('Rebase and merge');
  });
});
