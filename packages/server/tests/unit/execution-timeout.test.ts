import { describe, it, expect, vi, afterEach } from 'vitest';
import { armExecutionTimeout } from '../../src/application/utils/execution-timeout.js';

/**
 * The wall-clock budget is the ONLY hard bound on a single agent run: the stale
 * watchdog deliberately never touches a run this process owns, because it
 * cannot tell "stuck" from "slow". These tests pin the two properties every
 * SDK path depends on.
 */
describe('armExecutionTimeout', () => {
  afterEach(() => vi.useRealTimers());

  it('aborts the run once its budget expires, even while it is making progress', () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const timedOut: number[] = [];

    armExecutionTimeout(60_000, controller, (ms) => timedOut.push(ms));

    // A total-duration cap, not an inactivity timeout: nothing resets it, so a
    // healthy long run is aborted just the same. Anyone changing this to reset
    // on activity is changing the contract, not fixing a bug.
    vi.advanceTimersByTime(59_999);
    expect(controller.signal.aborted).toBe(false);

    vi.advanceTimersByTime(1);
    expect(controller.signal.aborted).toBe(true);
    expect(timedOut).toEqual([60_000]);
  });

  it('leaves a settled run alone once disarmed', () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const timedOut: number[] = [];

    const disarm = armExecutionTimeout(60_000, controller, (ms) => timedOut.push(ms));
    disarm();

    // Without this, a run that finished early would still be "aborted" later —
    // harmless on a dead controller, but it keeps a live timer per settled run.
    vi.advanceTimersByTime(120_000);
    expect(controller.signal.aborted).toBe(false);
    expect(timedOut).toEqual([]);
  });
});
