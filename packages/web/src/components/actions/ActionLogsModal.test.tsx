import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import type { ActionRun } from '@fleex/shared';
import * as api from '../../services/api';
import { resetPinnedActionsTransient, usePinnedActionsStore } from '../../stores/pinnedActionsStore';
import { ActionLogsModal } from './ActionLogsModal';

vi.mock('../../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/api')>()),
  fetchActionRuns: vi.fn(async () => []),
  cancelActionRun: vi.fn(async () => true),
  diagnoseBinary: vi.fn(async () => null),
}));

const running: ActionRun = {
  runId: 'r1', sourceId: 'kp', sourceKind: 'pinned', label: 'Deploy', command: 'make deploy',
  startedAt: new Date(Date.now() - 12_000).toISOString(), stdout: '', stderr: '',
};

const openOn = (run: ActionRun) => {
  // loadRuns would replace the list with the (mocked, empty) server answer.
  vi.mocked(api.fetchActionRuns).mockResolvedValue([run]);
  usePinnedActionsStore.setState({ runs: { kp: [run] }, running: { kp: run.runId } });
  usePinnedActionsStore.getState().openLogs({ sourceId: 'kp', label: 'Deploy', runId: run.runId });
};

beforeEach(() => {
  resetPinnedActionsTransient();
  usePinnedActionsStore.setState({ statuses: {}, runs: {}, running: {}, logs: null, liveOutput: {}, terminals: [], activeTerminal: null, capabilities: { liveOutput: true, terminal: true } });
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('ActionLogsModal — a run in flight', () => {
  it('shows the live output in seq order, the running badge and what was not shown live', async () => {
    openOn(running);
    render(<ActionLogsModal />);
    const { handleWsMessage } = usePinnedActionsStore.getState();
    act(() => {
      handleWsMessage({ type: 'action-run:output', data: { runId: 'r1', sourceId: 'kp', stream: 'stdout', chunk: 'second\n', seq: 1, dropped: 42 } });
      handleWsMessage({ type: 'action-run:output', data: { runId: 'r1', sourceId: 'kp', stream: 'stderr', chunk: 'first\n', seq: 0 } });
    });
    expect(screen.getByTestId('live-output').textContent).toBe('first\nsecond\n');
    expect(screen.getByText('… 42 bytes not shown live (see the final log)')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toMatch(/running · 1[2-3] s/);
  });

  it('Stop cancels the run', async () => {
    openOn(running);
    render(<ActionLogsModal />);
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(api.cancelActionRun).toHaveBeenCalledWith('r1');
  });

  it('says so when the gateway cannot stream output yet', () => {
    usePinnedActionsStore.setState({ capabilities: { liveOutput: false, terminal: false } });
    openOn(running);
    render(<ActionLogsModal />);
    expect(screen.getByText('Live output unavailable — restart the gateway to enable it.')).toBeTruthy();
    expect(screen.queryByTestId('live-output')).toBeNull();
  });

  it('notes that a terminal run mixes stdout and stderr', () => {
    openOn({ ...running, mode: 'terminal', finishedAt: new Date().toISOString(), exitCode: 0, stdout: 'all of it' });
    render(<ActionLogsModal />);
    expect(screen.getByText(/stdout and stderr are mixed/)).toBeTruthy();
  });

  it('a no-tty failure offers "Run in a terminal", which re-runs in terminal mode', async () => {
    const startActionRun = vi.spyOn(api, 'startActionRun').mockResolvedValue({ runId: 'r2', alreadyRunning: false });
    const failed = { ...running, finishedAt: new Date().toISOString(), exitCode: 1, stderr: 'the input device is not a TTY' };
    openOn(failed);
    usePinnedActionsStore.setState({ running: {} });
    render(<ActionLogsModal />);
    fireEvent.click(screen.getByRole('button', { name: 'Run in a terminal' }));
    await vi.waitFor(() => expect(startActionRun).toHaveBeenCalledWith(expect.objectContaining({ command: 'make deploy', mode: 'terminal' })));
    startActionRun.mockRestore();
  });
});
