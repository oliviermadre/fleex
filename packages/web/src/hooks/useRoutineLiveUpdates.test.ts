import { describe, it, expect } from 'vitest';
import { routineIdForMessage } from './useRoutineLiveUpdates';

// The Routines screen has no polling and no refresh button worth using: if this
// predicate says "not mine", the row, the badge and the DAG stay frozen until
// the user reloads the page — the exact bug this shipped to fix.

describe('routineIdForMessage', () => {
  it('claims workflow events anchored to a routine', () => {
    // Every step transition of a routine run arrives this way. Missing any of
    // them means a step that never leaves "running" on screen.
    expect(routineIdForMessage({
      type: 'workflow:step_completed',
      data: { workflowRunId: 'w1', ticketId: null, routineId: 'r-1' },
    })).toBe('r-1');

    // The one that raises the "waiting" badge.
    expect(routineIdForMessage({
      type: 'workflow:needs_review',
      data: { workflowRunId: 'w1', ticketId: null, routineId: 'r-1' },
    })).toBe('r-1');
  });

  it('claims routine lifecycle events', () => {
    expect(routineIdForMessage({
      type: 'routine:run_started',
      data: { routineId: 'r-1', workflowRunId: 'w1' },
    })).toBe('r-1');
  });

  it('ignores ticket-anchored workflow events', () => {
    // Refetching the routine list on every ticket step would put the whole app's
    // workflow traffic on a screen that has nothing to do with it.
    expect(routineIdForMessage({
      type: 'workflow:step_completed',
      data: { workflowRunId: 'w1', ticketId: 't-1', routineId: null },
    })).toBeNull();
  });

  it('ignores unrelated channel traffic', () => {
    expect(routineIdForMessage({ type: 'comment:created', data: { routineId: 'r-1' } })).toBeNull();
    expect(routineIdForMessage({ type: 'ticket:updated', data: { ticketId: 't-1' } })).toBeNull();
  });

  it('survives malformed payloads', () => {
    // A push with no data must not throw inside the socket handler: that would
    // tear down the subscription and freeze the screen for good.
    expect(routineIdForMessage({ type: 'workflow:run_completed', data: null })).toBeNull();
    expect(routineIdForMessage({ type: 'workflow:run_completed', data: undefined })).toBeNull();
  });
});
