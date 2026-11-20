import { useCallback, useEffect, useRef, useState } from 'react';
import { EXECUTION_STATES, type ExecutionState } from '@fleex/shared';
import { cancelExecution } from '../services/api';

/**
 * Stopping a running agent takes two clicks: the first one arms the button (it falls back after 1.5s), the second
 * one cancels the execution. Shared by every place that shows a live run (floating log panel, the floor's peek card).
 */
export function useTerminateExecution(executionId: string) {
  const [state, setState] = useState<ExecutionState>(EXECUTION_STATES.IDLE);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const later = (next: ExecutionState, ms: number) => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setState(next), ms); };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  /* another run shown in the same place starts unarmed */
  useEffect(() => { if (timer.current) clearTimeout(timer.current); setState(EXECUTION_STATES.IDLE); }, [executionId]);

  const terminate = useCallback(async () => {
    if (state === EXECUTION_STATES.IDLE) {
      setState(EXECUTION_STATES.CONFIRMING);
      later(EXECUTION_STATES.IDLE, 1500);
    } else if (state === EXECUTION_STATES.CONFIRMING) {
      if (timer.current) clearTimeout(timer.current);
      setState(EXECUTION_STATES.TERMINATING);
      try {
        await cancelExecution(executionId);
        setState(EXECUTION_STATES.DONE);
      } catch {
        setState(EXECUTION_STATES.ERROR);
        later(EXECUTION_STATES.IDLE, 2000);
      }
    }
  }, [state, executionId]);

  return { state, terminate };
}
