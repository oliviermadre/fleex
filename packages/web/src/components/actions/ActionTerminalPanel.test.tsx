import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react';
import type { ActionRun } from '@fleex/shared';
import * as api from '../../services/api';
import { useTerminal } from '../../hooks/useTerminal';
import { resetPinnedActionsTransient, usePinnedActionsStore, type TerminalTab } from '../../stores/pinnedActionsStore';
import { ActionTerminalPanel, TERMINAL_AUTO_CLOSE_MS } from './ActionTerminalPanel';

vi.mock('../../hooks/useTerminal', () => ({ useTerminal: vi.fn() }));
vi.mock('../../services/terminalManager', () => ({
  terminalManager: { dispose: vi.fn(), setFloatingMode: vi.fn(), get: vi.fn(() => undefined) },
}));
vi.mock('../../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/api')>()),
  startActionRun: vi.fn(),
  fetchActionRuns: vi.fn(async () => []),
  cancelActionRun: vi.fn(async () => true),
  closeActionTerminal: vi.fn(async () => true),
  diagnoseBinary: vi.fn(async () => null),
}));

const run = (extra: Partial<ActionRun> = {}): ActionRun => ({
  runId: 't1', sourceId: 'kp', sourceKind: 'pinned', label: 'K8s login', command: 'platool login prod',
  startedAt: new Date(Date.now() - 14_000).toISOString(), stdout: '', stderr: '', mode: 'terminal', ...extra,
});
const tab = (extra: Partial<TerminalTab> = {}): TerminalTab => ({
  sourceId: 'kp', sourceKind: 'pinned', runId: 't1', label: 'K8s login', command: 'platool login prod', ...extra,
});

beforeEach(() => {
  resetPinnedActionsTransient();
  usePinnedActionsStore.setState({ runs: {}, running: {}, logs: null, liveOutput: {}, terminals: [], activeTerminal: null, terminalFocusNonce: 0 });
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ActionTerminalPanel', () => {
  it('opens on a terminal run started from this tab and attaches the run terminal', async () => {
    vi.mocked(api.startActionRun).mockResolvedValue({ runId: 't1', alreadyRunning: false, run: run() });
    render(<ActionTerminalPanel />);
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => {
      await usePinnedActionsStore.getState().run({ sourceId: 'kp', sourceKind: 'pinned', label: 'K8s login', command: 'platool login prod', mode: 'terminal' });
    });
    const panel = screen.getByRole('dialog', { name: 'Action terminal — K8s login' });
    expect(panel.hasAttribute('data-floating-panel')).toBe(true);
    expect(panel.textContent).toContain('platool login prod');
    expect(panel.textContent).toMatch(/running · 0:1[4-5]/);
    expect(panel.textContent).toContain('zsh -l -i · cwd ~ · stdout+stderr mixed');
    expect(vi.mocked(useTerminal).mock.calls.at(-1)![0]).toBe('action:t1');
  });

  it('shows one tab per source', () => {
    usePinnedActionsStore.setState({
      runs: { kp: [run()], gh: [run({ runId: 't2', sourceId: 'gh', label: 'GitHub' })] },
      terminals: [tab(), tab({ sourceId: 'gh', runId: 't2', label: 'GitHub', command: 'gh auth login' })],
      activeTerminal: 'gh',
    });
    render(<ActionTerminalPanel />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['●K8s login', '●GitHub']);
    expect(tabs[1]!.getAttribute('aria-selected')).toBe('true');
    fireEvent.click(tabs[0]!);
    expect(usePinnedActionsStore.getState().activeTerminal).toBe('kp');
    expect(vi.mocked(useTerminal).mock.calls.at(-1)![0]).toBe('action:t1');
  });

  it('closes itself 2 s after an exit 0 when the action asks for it, and releases the pane', () => {
    vi.useFakeTimers();
    usePinnedActionsStore.setState({ runs: { kp: [run()] }, terminals: [tab({ closeOnSuccess: true })], activeTerminal: 'kp' });
    render(<ActionTerminalPanel />);
    act(() => usePinnedActionsStore.getState().handleWsMessage({ type: 'action-run:finished', data: run({ finishedAt: new Date().toISOString(), exitCode: 0 }) }));
    expect(screen.getByRole('dialog').textContent).toContain('✓ exit 0');
    act(() => { vi.advanceTimersByTime(TERMINAL_AUTO_CLOSE_MS - 1); });
    expect(screen.queryByRole('dialog')).not.toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.closeActionTerminal).toHaveBeenCalledWith('t1');
  });

  it('never closes itself on a failure', () => {
    vi.useFakeTimers();
    usePinnedActionsStore.setState({ runs: { kp: [run()] }, terminals: [tab({ closeOnSuccess: true })], activeTerminal: 'kp' });
    render(<ActionTerminalPanel />);
    act(() => usePinnedActionsStore.getState().handleWsMessage({ type: 'action-run:finished', data: run({ finishedAt: new Date().toISOString(), exitCode: 2 }) }));
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(screen.getByRole('dialog').textContent).toContain('✗ exit 2');
    expect(screen.getByRole('button', { name: 'View logs' })).toBeTruthy();
  });

  it('does not close on success when the action does not ask for it', () => {
    vi.useFakeTimers();
    usePinnedActionsStore.setState({ runs: { kp: [run({ finishedAt: new Date().toISOString(), exitCode: 0 })] }, terminals: [tab()], activeTerminal: 'kp' });
    render(<ActionTerminalPanel />);
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(screen.queryByRole('dialog')).not.toBeNull();
  });

  it('× while running asks before stopping, then cancels the run and closes the tab', () => {
    usePinnedActionsStore.setState({ runs: { kp: [run()] }, running: { kp: 't1' }, terminals: [tab()], activeTerminal: 'kp' });
    render(<ActionTerminalPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Close terminal' }));
    expect(screen.getByText('Stop K8s login?')).toBeTruthy();
    expect(api.cancelActionRun).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByText('Stop K8s login?').parentElement!).getByRole('button', { name: 'Stop' }));
    expect(api.cancelActionRun).toHaveBeenCalledWith('t1');
    expect(usePinnedActionsStore.getState().terminals).toEqual([]);
  });

  it('⌘W closes a finished tab; Escape is left to the terminal', () => {
    usePinnedActionsStore.setState({ runs: { kp: [run({ finishedAt: new Date().toISOString(), exitCode: 0 })] }, terminals: [tab()], activeTerminal: 'kp' });
    render(<ActionTerminalPanel />);
    const term = screen.getByTestId('action-terminal');
    const escape = fireEvent.keyDown(term, { key: 'Escape' });
    expect(escape).toBe(true); // not prevented
    expect(screen.queryByRole('dialog')).not.toBeNull();
    fireEvent.keyDown(term, { key: 'w', metaKey: true });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.closeActionTerminal).toHaveBeenCalledWith('t1');
  });
});
