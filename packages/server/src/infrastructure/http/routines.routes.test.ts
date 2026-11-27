import { describe, it, expect } from 'vitest';
import { routineAttention } from './routines.routes.js';

// A routine run has no ticket: this is the only signal its owner gets.

describe('routineAttention', () => {
  it('raises a failure when nothing is active and the latest run failed', () => {
    expect(routineAttention(null, 'failed')).toEqual({ awaitingAttention: false, lastRunFailed: true });
  });

  it('lets a newer run supersede the failure', () => {
    expect(routineAttention('running', 'failed').lastRunFailed).toBe(false);
    expect(routineAttention(null, 'completed').lastRunFailed).toBe(false);
  });

  it('keeps "waiting" for a run paused on a gate or a question', () => {
    expect(routineAttention('needs_review', null)).toEqual({ awaitingAttention: true, lastRunFailed: false });
    expect(routineAttention('blocked', null).awaitingAttention).toBe(true);
  });

  it('asks nothing of a routine that never ran', () => {
    expect(routineAttention(null, null)).toEqual({ awaitingAttention: false, lastRunFailed: false });
  });
});
