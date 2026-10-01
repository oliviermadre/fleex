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

describe('PinnedActionButton: menu commands vs left click', () => {
  const k9s: PinnedIcon = {
    id: 'k9s', icon: '', iconType: 'svg', label: 'k9s', actionType: 'shell', actionValue: 'k9s',
    status: { command: 'true', intervalSec: 60 },
    conditionalActions: [{ id: 'stg', label: 'k9s staging', when: ['ok'], actionType: 'shell', actionValue: 'k9s --context staging' }],
    clickByStatus: { ok: 'main', unknown: 'menu' },
  };

  it('the menu always lists the main command and dims a command not meant for this status (still clickable)', () => {
    usePinnedActionsStore.setState({ statuses: { k9s: { iconId: 'k9s', status: 'ko', probing: false } } });
    render(<PinnedActionButton action={k9s} kind="pinned" onRun={() => {}} />);
    fireEvent.contextMenu(screen.getByRole('button', { name: /k9s/ }));
    expect(screen.getByRole('menuitem', { name: /^k9s main/ })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'k9s staging' }).className).toContain('text-faint');
  });

  it('a status whose left click is "open the menu" opens it instead of running anything', () => {
    const onRun = vi.fn();
    usePinnedActionsStore.setState({ statuses: { k9s: { iconId: 'k9s', status: 'unknown', probing: false } } });
    render(<PinnedActionButton action={k9s} kind="pinned" onRun={onRun} />);
    fireEvent.click(screen.getByRole('button', { name: /k9s/ }));
    expect(onRun).not.toHaveBeenCalled();
    expect(screen.getByRole('menuitem', { name: 'k9s staging' })).toBeTruthy();
  });

  it('in OK the left click runs the main command even though "k9s staging" is offered in OK', () => {
    const onRun = vi.fn();
    usePinnedActionsStore.setState({ statuses: { k9s: { iconId: 'k9s', status: 'ok', probing: false } } });
    render(<PinnedActionButton action={k9s} kind="pinned" onRun={onRun} />);
    fireEvent.click(screen.getByRole('button', { name: /k9s/ }));
    expect(onRun).toHaveBeenCalled();
  });
});
