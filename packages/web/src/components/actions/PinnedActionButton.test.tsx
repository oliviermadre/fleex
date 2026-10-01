import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { PinnedIcon } from '@fleex/shared';
import * as api from '../../services/api';
import { resetPinnedActionsTransient, usePinnedActionsStore } from '../../stores/pinnedActionsStore';
import { PinnedActionButton } from './PinnedActionButton';

vi.mock('../../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/api')>()),
  fetchActionRuns: vi.fn(async () => []),
  cancelActionRun: vi.fn(async () => true),
}));

const action: PinnedIcon = { id: 'kp', icon: '', iconType: 'svg', label: 'Deploy', actionType: 'shell', actionValue: 'make deploy' };

beforeEach(() => {
  resetPinnedActionsTransient();
  usePinnedActionsStore.setState({ statuses: {}, runs: {}, running: {}, logs: null, liveOutput: {}, terminals: [], activeTerminal: null, terminalFocusNonce: 0 });
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('PinnedActionButton while a run is in flight', () => {
  it('the context menu offers "View live output" (the logs on that run) and "Stop"', () => {
    usePinnedActionsStore.setState({ running: { kp: 'r1' } });
    render(<PinnedActionButton action={action} kind="pinned" onRun={() => {}} />);
    const button = screen.getByRole('button', { name: 'Deploy' });
    fireEvent.contextMenu(button);
    fireEvent.click(screen.getByRole('menuitem', { name: 'View live output' }));
    expect(usePinnedActionsStore.getState().logs).toMatchObject({ sourceId: 'kp', runId: 'r1' });

    fireEvent.contextMenu(button);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Stop' }));
    expect(api.cancelActionRun).toHaveBeenCalledWith('r1');
  });

  it('"View live output" of a terminal run brings its panel to the front, and so does a click', () => {
    const onRun = vi.fn();
    usePinnedActionsStore.setState({
      running: { kp: 't1' },
      terminals: [
        { key: 'kp', sourceId: 'kp', sourceKind: 'pinned', runId: 't1', label: 'Deploy', command: 'make deploy' },
        { key: 'gh', sourceId: 'gh', sourceKind: 'pinned', runId: 't2', label: 'GitHub', command: 'gh auth login' },
      ],
      activeTerminal: 'gh',
    });
    render(<PinnedActionButton action={{ ...action, runMode: 'terminal' }} kind="pinned" onRun={onRun} />);
    const button = screen.getByRole('button', { name: 'Deploy' });
    fireEvent.contextMenu(button);
    fireEvent.click(screen.getByRole('menuitem', { name: 'View live output' }));
    expect(usePinnedActionsStore.getState().activeTerminal).toBe('kp');
    fireEvent.click(button);
    expect(onRun).toHaveBeenCalled();
  });

  it('offers neither when nothing runs', () => {
    render(<PinnedActionButton action={action} kind="pinned" onRun={() => {}} />);
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Deploy' }));
    expect(screen.queryByRole('menuitem', { name: 'Stop' })).toBeNull();
  });
});
