import { describe, it, expect } from 'vitest';

import { deriveWorktreeVerdict, isRemovableVerdict, VERDICT_META } from './worktreeVerdict';

const base = { commitsAhead: 0, commitsBehind: 0 };

describe('deriveWorktreeVerdict', () => {
  it('merged PR wins over everything', () => {
    expect(
      deriveWorktreeVerdict({ ...base, commitsBehind: 5, prState: 'merged', ticketStatus: 'done' }),
    ).toBe('merged_removable');
  });
  it('closed/missing ticket → stale (unless merged)', () => {
    expect(deriveWorktreeVerdict({ ...base, ticketStatus: 'done' })).toBe('stale_removable');
    expect(deriveWorktreeVerdict({ ...base, ticketStatus: 'cancelled' })).toBe('stale_removable');
    expect(deriveWorktreeVerdict({ ...base, ticketMissing: true })).toBe('stale_removable');
  });
  it('behind → needs rebase (even when also ahead)', () => {
    expect(
      deriveWorktreeVerdict({ commitsAhead: 2, commitsBehind: 3, ticketStatus: 'doing' }),
    ).toBe('needs_rebase');
  });
  it('ahead only → ready to push', () => {
    expect(
      deriveWorktreeVerdict({
        commitsAhead: 2,
        commitsBehind: 0,
        ticketStatus: 'doing',
        prState: 'open',
      }),
    ).toBe('ready_to_push');
  });
  it('clean → up to date', () => {
    expect(deriveWorktreeVerdict({ ...base, ticketStatus: 'doing' })).toBe('up_to_date');
  });
});

describe('helpers', () => {
  it('isRemovableVerdict flags the two removable states', () => {
    expect(isRemovableVerdict('merged_removable')).toBe(true);
    expect(isRemovableVerdict('stale_removable')).toBe(true);
    expect(isRemovableVerdict('ready_to_push')).toBe(false);
  });
  it('every verdict has a label and a hue', () => {
    for (const meta of Object.values(VERDICT_META)) {
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.hue).toBeTruthy();
    }
  });
});
