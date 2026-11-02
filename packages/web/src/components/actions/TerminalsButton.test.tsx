import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import type { ActionRun } from '@fleex/shared';
import * as api from '../../services/api';
import { resetPinnedActionsTransient, usePinnedActionsStore, type TerminalTab } from '../../stores/pinnedActionsStore';
import { TerminalsButton } from './TerminalsButton';

vi.mock('../../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/api')>()),
  startActionRun: vi.fn(),
  startScratchShell: vi.fn(),
}));

const tab = (key: string): TerminalTab => ({ key, sourceId: key, sourceKind: 'pinned', runId: `r-${key}`, label: key, command: 'cmd' });
const run = (key: string, finished = false): ActionRun => ({
  runId: `r-${key}`, sourceId: key, sourceKind: 'pinned', label: key, command: 'cmd', mode: 'terminal',
  startedAt: '2026-11-02T10:00:00.000Z', stdout: '', stderr: '', ...(finished ? { finishedAt: '2026-11-02T10:01:00.000Z', exitCode: 0 } : {}),
});
const button = () => screen.getByRole('button', { name: /terminal/i });

beforeEach(() => {
  resetPinnedActionsTransient();
  usePinnedActionsStore.setState({ runs: {}, running: {}, terminals: [], activeTerminal: null, terminalFocusNonce: 0, terminalMinimized: false });
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('TerminalsButton', () => {
  it('counts only the terminals still running; finished-but-open tabs get a faint dot, not a count', () => {
    usePinnedActionsStore.setState({
      terminals: [tab('a'), tab('b'), tab('c')],
      runs: { a: [run('a')], b: [run('b', true)], c: [run('c')] },
      activeTerminal: 'a',
      terminalMinimized: true,
    });
    render(<TerminalsButton />);
    expect(screen.getByTestId('terminals-badge').textContent).toBe('2');
    expect(screen.getByTestId('terminals-finished-dot')).toBeTruthy();
    expect(button().getAttribute('aria-label')).toBe('Terminals — 2 running · 1 finished · ⌃`');
  });

  it('hides the badge at 0 and offers a new terminal when there is none', () => {
    render(<TerminalsButton />);
    expect(screen.queryByTestId('terminals-badge')).toBeNull();
    expect(button().getAttribute('aria-label')).toBe('New terminal · ⌃`');
  });

  it('drops the count when a command ends', () => {
    usePinnedActionsStore.setState({ terminals: [tab('a')], runs: { a: [run('a')] }, terminalMinimized: true });
    render(<TerminalsButton />);
    expect(screen.getByTestId('terminals-badge').textContent).toBe('1');
    act(() => usePinnedActionsStore.getState().handleWsMessage({ type: 'action-run:finished', data: run('a', true) }));
    expect(screen.queryByTestId('terminals-badge')).toBeNull();
  });

  it('a click reopens the hidden panel without starting any run, a second click hides it', () => {
    usePinnedActionsStore.setState({ terminals: [tab('a')], runs: { a: [run('a')] }, activeTerminal: 'a', terminalMinimized: true });
    render(<TerminalsButton />);
    expect(button().getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(button());
    expect(usePinnedActionsStore.getState()).toMatchObject({ terminalMinimized: false, activeTerminal: 'a' });
    expect(button().getAttribute('aria-pressed')).toBe('true');
    expect(api.startActionRun).not.toHaveBeenCalled();
    expect(api.startScratchShell).not.toHaveBeenCalled();
    fireEvent.click(button());
    expect(usePinnedActionsStore.getState().terminalMinimized).toBe(true);
  });

  it('with no terminal, a click opens a free shell', async () => {
    vi.mocked(api.startScratchShell).mockResolvedValueOnce({ runId: 's1', run: { ...run('scratch:1'), runId: 's1', sourceKind: 'scratch' } });
    render(<TerminalsButton />);
    await act(async () => fireEvent.click(button()));
    expect(api.startScratchShell).toHaveBeenCalledTimes(1);
    expect(usePinnedActionsStore.getState().terminals.map((t) => t.label)).toEqual(['Shell 1']);
  });
});
