import { describe, it, expect } from 'vitest';
import type { PrCheck } from '@fleex/shared';
import { aggregateCiStatus, allowedMergeMethods, checkRunBucket, countsFromStates, sortChecks, toCiBucket } from './pr-ci.js';

describe('toCiBucket', () => {
  it.each([
    ['QUEUED', 'pending'], ['PENDING', 'pending'], ['WAITING', 'pending'], ['REQUESTED', 'pending'],
    ['IN_PROGRESS', 'running'],
    ['SUCCESS', 'pass'],
    ['NEUTRAL', 'skip'], ['SKIPPED', 'skip'], ['STALE', 'skip'],
    ['FAILURE', 'fail'], ['TIMED_OUT', 'fail'], ['STARTUP_FAILURE', 'fail'], ['ACTION_REQUIRED', 'fail'],
    ['CANCELLED', 'cancel'],
    ['EXPECTED', 'pending'], ['ERROR', 'fail'],
  ])('%s → %s', (state, bucket) => {
    expect(toCiBucket(state)).toBe(bucket);
  });

  it('never reports an unknown state as passed, so a new GitHub state cannot fake a green chip', () => {
    expect(toCiBucket('SOMETHING_NEW')).toBe('pending');
    expect(toCiBucket(null)).toBe('pending');
  });
});

describe('checkRunBucket', () => {
  it('reads the status while the run is not completed, the conclusion after', () => {
    expect(checkRunBucket('IN_PROGRESS', null)).toBe('running');
    expect(checkRunBucket('COMPLETED', 'FAILURE')).toBe('fail');
    expect(checkRunBucket('COMPLETED', null)).toBe('skip');
  });
});

describe('aggregateCiStatus', () => {
  it('has nothing to report with no checks', () => {
    expect(aggregateCiStatus({})).toBe('none');
  });

  it('turns red as soon as one check failed or was cancelled, even while others still run', () => {
    expect(aggregateCiStatus({ pass: 5, running: 2, fail: 1 })).toBe('failed');
    expect(aggregateCiStatus({ pass: 5, cancel: 1 })).toBe('failed');
  });

  it('is running while any check is pending or in progress and none failed', () => {
    expect(aggregateCiStatus({ pass: 3, pending: 1 })).toBe('running');
    expect(aggregateCiStatus({ running: 1 })).toBe('running');
  });

  it('passes when every check passed or was skipped', () => {
    expect(aggregateCiStatus({ pass: 3, skip: 2 })).toBe('passed');
  });
});

describe('countsFromStates', () => {
  it('folds GitHub state rows into buckets, adding to existing counts', () => {
    const counts = countsFromStates([{ state: 'SUCCESS', count: 2 }, { state: 'NEUTRAL', count: 1 }, { state: 'FAILURE', count: 0 }]);
    expect(countsFromStates([{ state: 'SUCCESS', count: 1 }, { state: 'ERROR', count: 1 }], counts))
      .toEqual({ pass: 3, skip: 1, fail: 1 });
  });
});

describe('sortChecks', () => {
  const check = (name: string, bucket: PrCheck['bucket']): PrCheck =>
    ({ name, bucket, detailsUrl: null, startedAt: null, completedAt: null });

  it('lists what needs attention first: failed, running, pending, cancelled, passed, skipped — then by name', () => {
    const sorted = sortChecks([
      check('skip', 'skip'), check('b-pass', 'pass'), check('a-pass', 'pass'), check('cancel', 'cancel'),
      check('pending', 'pending'), check('running', 'running'), check('fail', 'fail'),
    ]);
    expect(sorted.map((c) => c.name)).toEqual(['fail', 'running', 'pending', 'cancel', 'a-pass', 'b-pass', 'skip']);
  });
});

describe('allowedMergeMethods', () => {
  it('only offers what the repository allows, its default first', () => {
    expect(allowedMergeMethods({
      mergeCommitAllowed: true, squashMergeAllowed: true, rebaseMergeAllowed: false, viewerDefaultMergeMethod: 'SQUASH',
    })).toEqual(['squash', 'merge']);
  });

  it('ignores a default the repository no longer allows', () => {
    expect(allowedMergeMethods({
      mergeCommitAllowed: false, squashMergeAllowed: false, rebaseMergeAllowed: true, viewerDefaultMergeMethod: 'MERGE',
    })).toEqual(['rebase']);
  });
});
