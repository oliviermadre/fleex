import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react';
import type { ActionRun } from '@fleex/shared';
import * as api from '../../services/api';
import { useTerminal } from '../../hooks/useTerminal';
import { resetPinnedActionsTransient, usePinnedActionsStore, type TerminalTab } from '../../stores/pinnedActionsStore';
import { ActionTerminalPanel, TERMINAL_AUTO_CLOSE_MS } from './ActionTerminalPanel';
import { anchoredBox, setTerminalAnchor } from './terminalAnchor';

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
  usePinnedActionsStore.setState({ runs: {}, running: {}, logs: null, liveOutput: {}, terminals: [], activeTerminal: null, terminalFocusNonce: 0, terminalMinimized: false });
  setTerminalAnchor(null);
  document.getElementById('fleex-desktop-titlebar')?.remove();
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

const K9S = { sourceId: 'kp', sourceKind: 'pinned' as const, label: 'K8s login', command: 'platool login prod', mode: 'terminal' as const };

describe('ActionTerminalPanel · minimize (k9s stays open, out of the way)', () => {
  it('Minimize hides the panel without ending the session; clicking the action brings it back as it was', async () => {
    vi.mocked(api.startActionRun).mockResolvedValue({ runId: 't1', alreadyRunning: false, run: run() });
    render(<ActionTerminalPanel />);
    await act(async () => { await usePinnedActionsStore.getState().run(K9S); });
    fireEvent.click(screen.getByRole('button', { name: 'Minimize' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.cancelActionRun).not.toHaveBeenCalled();
    expect(api.closeActionTerminal).not.toHaveBeenCalled();
    expect(usePinnedActionsStore.getState().terminals).toHaveLength(1);

    // Re-click: the same run comes back, nothing new is started.
    await act(async () => { await usePinnedActionsStore.getState().run(K9S); });
    expect(screen.getByRole('dialog', { name: 'Action terminal — K8s login' })).toBeTruthy();
    expect(api.startActionRun).toHaveBeenCalledTimes(1);
    expect(vi.mocked(useTerminal).mock.calls.at(-1)![0]).toBe('action:t1');
  });

  it('a finished run behind a minimized panel is shown again, not re-run; a click on the visible finished tab re-runs', async () => {
    usePinnedActionsStore.setState({ runs: { kp: [run({ finishedAt: new Date().toISOString(), exitCode: 0 })] }, terminals: [tab()], activeTerminal: 'kp', terminalMinimized: true });
    render(<ActionTerminalPanel />);
    await act(async () => { await usePinnedActionsStore.getState().run(K9S); });
    expect(api.startActionRun).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();

    vi.mocked(api.startActionRun).mockResolvedValue({ runId: 't2', alreadyRunning: false, run: run({ runId: 't2' }) });
    await act(async () => { await usePinnedActionsStore.getState().run(K9S); });
    expect(api.startActionRun).toHaveBeenCalledTimes(1);
  });

  it('Close still ends the session (confirm, then stop) — unlike Minimize', () => {
    usePinnedActionsStore.setState({ runs: { kp: [run()] }, terminals: [tab()], activeTerminal: 'kp' });
    render(<ActionTerminalPanel />);
    expect(screen.getByRole('button', { name: 'Close terminal' }).getAttribute('title')).toMatch(/ends the session/);
    fireEvent.click(screen.getByRole('button', { name: 'Close terminal' }));
    expect(screen.getByText('Stop K8s login?')).toBeTruthy();
  });

  it('a run ending while its panel is minimized gets its toast (nothing on screen shows it)', async () => {
    const { useToastStore } = await import('../../stores/toastStore');
    useToastStore.setState({ toasts: [] });
    usePinnedActionsStore.setState({ runs: { kp: [run()] }, running: { kp: 't1' }, terminals: [tab()], activeTerminal: 'kp', terminalMinimized: true });
    act(() => {
      usePinnedActionsStore.getState().handleWsMessage({ type: 'action-run:finished', data: run({ finishedAt: new Date().toISOString(), exitCode: 3 }) } as never);
    });
    expect(useToastStore.getState().toasts.some((t) => t.message.includes('K8s login'))).toBe(true);
  });
});

describe('ActionTerminalPanel · placement', () => {
  it('opens under the action button that started it, like the bar popovers', () => {
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.getBoundingClientRect = () => ({ left: 900, right: 928, top: 10, bottom: 38, width: 28, height: 28, x: 900, y: 10, toJSON: () => ({}) }) as DOMRect;
    setTerminalAnchor(button);
    usePinnedActionsStore.setState({ runs: { kp: [run()] }, terminals: [tab()], activeTerminal: 'kp' });
    render(<ActionTerminalPanel />);
    const panel = screen.getByRole('dialog');
    expect(panel.getAttribute('data-placement')).toBe('anchored');
    expect(panel.style.top).toBe('46px');
    button.remove();
  });

  it('falls back to the bottom-right corner when the button is gone', () => {
    usePinnedActionsStore.setState({ runs: { kp: [run()] }, terminals: [tab()], activeTerminal: 'kp' });
    render(<ActionTerminalPanel />);
    expect(screen.getByRole('dialog').getAttribute('data-placement')).toBe('corner');
  });

  it('full screen stays below the desktop title bar, so its buttons remain clickable', () => {
    const bar = document.createElement('div');
    bar.id = 'fleex-desktop-titlebar';
    bar.getBoundingClientRect = () => ({ bottom: 38 }) as DOMRect;
    document.body.appendChild(bar);
    usePinnedActionsStore.setState({ runs: { kp: [run()] }, terminals: [tab()], activeTerminal: 'kp' });
    render(<ActionTerminalPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Full screen' }));
    const panel = screen.getByRole('dialog');
    expect(panel.getAttribute('data-placement')).toBe('full-screen');
    expect(panel.style.top).toBe('54px');
  });
});

describe('anchoredBox', () => {
  const rect = (left: number, bottom: number) => ({ left, right: left + 28, bottom, width: 28 }) as DOMRect;
  it('centres under the button and stays inside the viewport', () => {
    expect(anchoredBox(rect(500, 40), { width: 1440, height: 900 })).toEqual({ top: 48, left: 194, width: 640, height: 360 });
    expect(anchoredBox(rect(1400, 40), { width: 1440, height: 900 })!.left).toBe(1440 - 640 - 8);
    expect(anchoredBox(rect(0, 40), { width: 1440, height: 900 })!.left).toBe(8);
  });
  it('gives up (corner) when there is no room left under the button', () => {
    expect(anchoredBox(rect(500, 700), { width: 1440, height: 900 })).toBeNull();
  });
});
