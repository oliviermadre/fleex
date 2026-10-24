import { describe, it, expect } from 'vitest';
import { shouldAnnounceRelease, type ReleaseAnnouncementInput } from './useReleaseAnnouncement';

const base: ReleaseAnnouncementInput = {
  current: 25,
  lastSeen: 24,
  toastShown: 24,
  storedCommit: 'abc1234',
  currentCommit: 'def5678',
};

describe('shouldAnnounceRelease', () => {
  it('announces a new release right after an update', () => {
    expect(shouldAnnounceRelease(base)).toBe(true);
    expect(shouldAnnounceRelease({ ...base, lastSeen: null, toastShown: null })).toBe(true);
  });

  it('stays quiet on a first-ever visit (no recorded commit)', () => {
    expect(shouldAnnounceRelease({ ...base, storedCommit: null })).toBe(false);
  });

  it('stays quiet when the app was not updated since the last visit', () => {
    expect(shouldAnnounceRelease({ ...base, storedCommit: 'def5678' })).toBe(false);
    expect(shouldAnnounceRelease({ ...base, currentCommit: null })).toBe(false);
  });

  it('stays quiet once the release was opened', () => {
    expect(shouldAnnounceRelease({ ...base, lastSeen: 25 })).toBe(false);
  });

  it('never shows the same release twice', () => {
    expect(shouldAnnounceRelease({ ...base, toastShown: 25 })).toBe(false);
  });

  it('stays quiet when there is no release', () => {
    expect(shouldAnnounceRelease({ ...base, current: null })).toBe(false);
  });
});
