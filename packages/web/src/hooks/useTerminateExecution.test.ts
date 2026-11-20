/** Stopping an agent is destructive: one stray click must never kill a run, so it takes an arming click first. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { EXECUTION_STATES } from '@fleex/shared';
import * as api from '../services/api';
import { useTerminateExecution } from './useTerminateExecution';

vi.mock('../services/api', () => ({ cancelExecution: vi.fn(async () => ({})) }));

beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); });
afterEach(() => { vi.useRealTimers(); });

describe('useTerminateExecution', () => {
  it('arms on the first click and cancels on the second', async () => {
    const { result } = renderHook(() => useTerminateExecution('e1'));
    await act(async () => { await result.current.terminate(); });
    expect(result.current.state).toBe(EXECUTION_STATES.CONFIRMING);
    expect(api.cancelExecution).not.toHaveBeenCalled();
    await act(async () => { await result.current.terminate(); });
    expect(api.cancelExecution).toHaveBeenCalledWith('e1');
    expect(result.current.state).toBe(EXECUTION_STATES.DONE);
  });

  it('disarms by itself when the second click does not come', async () => {
    const { result } = renderHook(() => useTerminateExecution('e1'));
    await act(async () => { await result.current.terminate(); });
    act(() => { vi.advanceTimersByTime(1600); });
    expect(result.current.state).toBe(EXECUTION_STATES.IDLE);
    await act(async () => { await result.current.terminate(); });
    expect(api.cancelExecution).not.toHaveBeenCalled();
  });

  it('says it failed, then lets the user try again', async () => {
    vi.mocked(api.cancelExecution).mockRejectedValueOnce(new Error('down'));
    const { result } = renderHook(() => useTerminateExecution('e1'));
    await act(async () => { await result.current.terminate(); });
    await act(async () => { await result.current.terminate(); });
    expect(result.current.state).toBe(EXECUTION_STATES.ERROR);
    act(() => { vi.advanceTimersByTime(2100); });
    expect(result.current.state).toBe(EXECUTION_STATES.IDLE);
  });
});
