import { info, ok, warn } from '../../../core/colors.ts';
import { readHubState, isAlive, clearHubState } from '../_state.ts';

import type { CommandDef } from '../../../core/types.ts';

async function runHubStop(): Promise<void> {
  const state = readHubState();
  if (!state) {
    info('No event hub state found — nothing to stop.');
    return;
  }

  if (!isAlive(state.pid)) {
    warn(`Event hub state present but PID ${state.pid} is dead. Cleaning up.`);
    clearHubState();
    return;
  }

  try {
    process.kill(state.pid, 'SIGTERM');
  } catch (err) {
    warn(`Failed to signal PID ${state.pid}: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Give the process a moment to exit, then escalate if needed.
  await new Promise((r) => setTimeout(r, 300));
  if (isAlive(state.pid)) {
    try {
      process.kill(state.pid, 'SIGKILL');
    } catch {
      /* ignore */
    }
  }

  clearHubState();
  ok(`Event hub stopped (PID ${state.pid}, port ${state.port}).`);
}

const def: CommandDef = {
  name: 'stop',
  description: 'Stop the running event hub process',
  action: async () => {
    await runHubStop();
  },
};

export default def;
