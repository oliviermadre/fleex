import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react';
import type { ActionRun } from '@fleex/shared';
import * as api from '../../services/api';
import { useTerminal } from '../../hooks/useTerminal';
import { resetPinnedActionsTransient, TERMINAL_GEOMETRY_KEY, usePinnedActionsStore, type TerminalTab } from '../../stores/pinnedActionsStore';
import { ActionTerminalPanel, TERMINAL_AUTO_CLOSE_MS } from './ActionTerminalPanel';
import { useSettingsStore } from '../../stores/settingsStore';

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
  key: extra.key ?? extra.sourceId ?? 'kp',
});

beforeEach(() => {
  resetPinnedActionsTransient();
  usePinnedActionsStore.setState({ runs: {}, running: {}, logs: null, liveOutput: {}, terminals: [], activeTerminal: null, terminalFocusNonce: 0, terminalMinimized: false, terminalGeometry: null });
  localStorage.removeItem(TERMINAL_GEOMETRY_KEY);
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

  it('shows one tab per action command', () => {
    usePinnedActionsStore.setState({
      runs: { kp: [run()], gh: [run({ runId: 't2', sourceId: 'gh', label: 'GitHub' })] },
      terminals: [tab(), tab({ sourceId: 'gh', runId: 't2', label: 'GitHub', command: 'gh auth login' })],
      activeTerminal: 'gh',
    });
    render(<ActionTerminalPanel />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['K8s login', 'GitHub']);
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

  it("a tab's × kills that terminal at once — no confirm — ending the session and closing the tab", () => {
    usePinnedActionsStore.setState({ runs: { kp: [run()] }, running: { kp: 't1' }, terminals: [tab()], activeTerminal: 'kp' });
    render(<ActionTerminalPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Kill K8s login' }));
    expect(api.closeActionTerminal).toHaveBeenCalledWith('t1');
    expect(usePinnedActionsStore.getState().terminals).toEqual([]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Kill re-reads the action state (probe), so its dot is right at once', () => {
    usePinnedActionsStore.setState({ runs: { kp: [run({ finishedAt: new Date().toISOString(), exitCode: 0 })] }, terminals: [tab()], activeTerminal: 'kp' });
    const refresh = vi.fn(async () => {});
    usePinnedActionsStore.setState({ refresh });
    useSettingsStore.setState((st) => ({ settings: { ...st.settings, pinnedIcons: [{ id: 'kp', label: 'K8s', icon: '', iconType: 'svg', actionType: 'shell', actionValue: 'k9s', status: { command: 'true', intervalSec: 60 } }] } }));
    render(<ActionTerminalPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Kill K8s login' }));
    expect(refresh).toHaveBeenCalledWith('kp');
  });

  it("⌘W hides like the bar's × (the session lives on); Escape is left to the terminal", () => {
    usePinnedActionsStore.setState({ runs: { kp: [run()] }, terminals: [tab()], activeTerminal: 'kp' });
    render(<ActionTerminalPanel />);
    const term = screen.getByTestId('action-terminal');
    const escape = fireEvent.keyDown(term, { key: 'Escape' });
    expect(escape).toBe(true); // not prevented
    expect(screen.queryByRole('dialog')).not.toBeNull();
    fireEvent.keyDown(term, { key: 'w', metaKey: true });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(usePinnedActionsStore.getState().terminals).toHaveLength(1);
    expect(api.closeActionTerminal).not.toHaveBeenCalled();
  });
});

const K9S = { sourceId: 'kp', sourceKind: 'pinned' as const, label: 'K8s login', command: 'platool login prod', mode: 'terminal' as const };

describe('ActionTerminalPanel · hide (k9s stays open, out of the way)', () => {
  it("the bar's × hides the panel without ending the session; clicking the action brings it back as it was", async () => {
    vi.mocked(api.startActionRun).mockResolvedValue({ runId: 't1', alreadyRunning: false, run: run() });
    render(<ActionTerminalPanel />);
    await act(async () => { await usePinnedActionsStore.getState().run(K9S); });
    fireEvent.click(screen.getByRole('button', { name: /^Hide/ }));

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

  it('a finished run behind a hidden panel is shown again, not re-run; a click on the visible finished tab re-runs', async () => {
    usePinnedActionsStore.setState({ runs: { kp: [run({ finishedAt: new Date().toISOString(), exitCode: 0 })] }, terminals: [tab()], activeTerminal: 'kp', terminalMinimized: true });
    render(<ActionTerminalPanel />);
    await act(async () => { await usePinnedActionsStore.getState().run(K9S); });
    expect(api.startActionRun).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();

    vi.mocked(api.startActionRun).mockResolvedValue({ runId: 't2', alreadyRunning: false, run: run({ runId: 't2' }) });
    await act(async () => { await usePinnedActionsStore.getState().run(K9S); });
    expect(api.startActionRun).toHaveBeenCalledTimes(1);
  });

  it('the bar has + (maximize) and × (hide), with tooltips; killing is only on the tabs', () => {
    usePinnedActionsStore.setState({ runs: { kp: [run()] }, terminals: [tab()], activeTerminal: 'kp' });
    render(<ActionTerminalPanel />);
    const order = [...document.querySelectorAll('[data-window-button]')].map((b) => b.getAttribute('data-window-button'));
    expect(order).toEqual(['maximize', 'hide']);
    fireEvent.mouseEnter(screen.getByRole('button', { name: /^Hide/ }));
    expect(screen.getByRole('tooltip').textContent).toMatch(/keep running/);
    fireEvent.click(screen.getByRole('button', { name: /^Maximize/ }));
    expect(screen.getByRole('button', { name: /^Restore size/ })).toBeTruthy();
  });

  it('the tab bar is there even with a single terminal, so its kill × is always reachable', () => {
    usePinnedActionsStore.setState({ runs: { kp: [run()] }, terminals: [tab()], activeTerminal: 'kp' });
    render(<ActionTerminalPanel />);
    expect(screen.getAllByRole('tab')).toHaveLength(1);
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Kill K8s login' }));
    expect(screen.getByRole('tooltip').textContent).toBe('Kill this terminal');
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

const box = (el: HTMLElement) => ({ x: parseFloat(el.style.left), y: parseFloat(el.style.top), width: parseFloat(el.style.width), height: parseFloat(el.style.height) });
const titleBar = (bottom: number) => {
  const bar = document.createElement('div');
  bar.id = 'fleex-desktop-titlebar';
  bar.getBoundingClientRect = () => ({ bottom }) as DOMRect;
  document.body.appendChild(bar);
};

describe('ActionTerminalPanel · placement', () => {
  it('first time: centred, 66 % of the window each way — never under the button or in a corner', () => {
    usePinnedActionsStore.setState({ runs: { kp: [run()] }, terminals: [tab()], activeTerminal: 'kp' });
    render(<ActionTerminalPanel />);
    const b = box(screen.getByRole('dialog'));
    expect(b.width).toBe(Math.round(window.innerWidth * 0.66));
    expect(b.height).toBe(Math.round(window.innerHeight * 0.66));
    expect(b.x).toBe(Math.round((window.innerWidth - b.width) / 2));
    expect(b.y).toBe(Math.round((window.innerHeight - b.height) / 2));
  });

  it('in the desktop app, centres in the space below the title bar', () => {
    titleBar(38);
    usePinnedActionsStore.setState({ runs: { kp: [run()] }, terminals: [tab()], activeTerminal: 'kp' });
    render(<ActionTerminalPanel />);
    const b = box(screen.getByRole('dialog'));
    expect(b.height).toBe(Math.round((window.innerHeight - 38) * 0.66));
    expect(b.y).toBe(Math.round(38 + (window.innerHeight - 38 - b.height) / 2));
  });

  it('reopens where it was last left, even after every terminal was closed (and across reloads)', () => {
    usePinnedActionsStore.setState({ runs: { kp: [run()] }, terminals: [tab()], activeTerminal: 'kp' });
    const { unmount } = render(<ActionTerminalPanel />);
    const bar = document.querySelector('[data-terminal-bar]')!;
    const before = box(screen.getByRole('dialog'));
    fireEvent.mouseDown(bar, { button: 0, clientX: 300, clientY: 200 });
    fireEvent.mouseMove(window, { clientX: 250, clientY: 180 });
    fireEvent.mouseUp(window);
    const moved = box(screen.getByRole('dialog'));
    expect(moved).toEqual({ ...before, x: before.x - 50, y: before.y - 20 });

    // The last terminal is killed: the panel goes, its place stays — in this browser's storage too.
    fireEvent.click(screen.getByRole('button', { name: 'Kill K8s login' }));
    expect(JSON.parse(localStorage.getItem(TERMINAL_GEOMETRY_KEY)!)).toEqual(moved);
    unmount();

    usePinnedActionsStore.setState({ terminals: [tab({ runId: 't2' })], activeTerminal: 'kp', runs: { kp: [run({ runId: 't2' })] } });
    render(<ActionTerminalPanel />);
    expect(box(screen.getByRole('dialog'))).toEqual(moved);
  });

  it('a saved place outside of today\'s window is brought back inside it', () => {
    usePinnedActionsStore.setState({ terminalGeometry: { x: 5000, y: -300, width: 5000, height: 600 }, runs: { kp: [run()] }, terminals: [tab()], activeTerminal: 'kp' });
    render(<ActionTerminalPanel />);
    expect(box(screen.getByRole('dialog'))).toEqual({ x: 0, y: 0, width: window.innerWidth, height: 600 });
  });

  it('dragging the bar keeps the panel inside the viewport and below the title bar', () => {
    titleBar(38);
    usePinnedActionsStore.setState({ runs: { kp: [run()] }, terminals: [tab()], activeTerminal: 'kp' });
    render(<ActionTerminalPanel />);
    const bar = document.querySelector('[data-terminal-bar]')!;
    fireEvent.mouseDown(bar, { button: 0, clientX: 300, clientY: 200 });
    fireEvent.mouseMove(window, { clientX: -5000, clientY: -5000 });
    fireEvent.mouseUp(window);
    let b = box(screen.getByRole('dialog'));
    expect([b.x, b.y]).toEqual([0, 38]);
    fireEvent.mouseDown(bar, { button: 0, clientX: 300, clientY: 200 });
    fireEvent.mouseMove(window, { clientX: 9000, clientY: 9000 });
    fireEvent.mouseUp(window);
    b = box(screen.getByRole('dialog'));
    expect([b.x + b.width, b.y + b.height]).toEqual([window.innerWidth, window.innerHeight]);
  });

  it('a press on a bar button does not start a drag', () => {
    usePinnedActionsStore.setState({ runs: { kp: [run()] }, terminals: [tab()], activeTerminal: 'kp' });
    render(<ActionTerminalPanel />);
    const before = box(screen.getByRole('dialog'));
    fireEvent.mouseDown(screen.getByRole('button', { name: /^Maximize/ }), { button: 0, clientX: 300, clientY: 200 });
    fireEvent.mouseMove(window, { clientX: 100, clientY: 100 });
    fireEvent.mouseUp(window);
    expect(box(screen.getByRole('dialog'))).toEqual(before);
  });

  it('double-clicking the bar maximizes, and again restores', () => {
    usePinnedActionsStore.setState({ runs: { kp: [run()] }, terminals: [tab()], activeTerminal: 'kp' });
    render(<ActionTerminalPanel />);
    const bar = document.querySelector('[data-terminal-bar]')!;
    fireEvent.doubleClick(bar);
    expect(screen.getByRole('dialog').getAttribute('data-placement')).toBe('maximized');
    fireEvent.doubleClick(bar);
    expect(screen.getByRole('dialog').getAttribute('data-placement')).toBe('floating');
  });

  it('maximized stays below the desktop title bar, so its buttons remain clickable', () => {
    titleBar(38);
    usePinnedActionsStore.setState({ runs: { kp: [run()] }, terminals: [tab()], activeTerminal: 'kp' });
    render(<ActionTerminalPanel />);
    fireEvent.click(screen.getByRole('button', { name: /^Maximize/ }));
    const panel = screen.getByRole('dialog');
    expect(panel.getAttribute('data-placement')).toBe('maximized');
    expect(panel.style.top).toBe('54px');
  });
});

describe('ActionTerminalPanel · resize', () => {
  it('has grips on every edge and corner; a resize sticks across Minimize and back', () => {
    usePinnedActionsStore.setState({ runs: { kp: [run()] }, terminals: [tab()], activeTerminal: 'kp' });
    vi.useFakeTimers();
    render(<ActionTerminalPanel />);
    const grips = document.querySelectorAll('[data-resize]');
    expect([...grips].map((g) => g.getAttribute('data-resize')).sort()).toEqual(['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w']);

    const before = box(screen.getByRole('dialog'));
    const se = document.querySelector('[data-resize="se"]')!;
    fireEvent.mouseDown(se, { button: 0, clientX: 500, clientY: 500 });
    fireEvent.mouseMove(window, { clientX: 540, clientY: 520 });
    fireEvent.mouseUp(window);
    act(() => { vi.advanceTimersByTime(10); });
    expect(box(screen.getByRole('dialog'))).toEqual({ ...before, width: before.width + 40, height: before.height + 20 });

    act(() => usePinnedActionsStore.getState().minimizeTerminal());
    act(() => usePinnedActionsStore.getState().focusTerminal('kp'));
    expect(box(screen.getByRole('dialog'))).toEqual({ ...before, width: before.width + 40, height: before.height + 20 });
  });

  it('cannot be shrunk below a usable terminal', () => {
    usePinnedActionsStore.setState({ runs: { kp: [run()] }, terminals: [tab()], activeTerminal: 'kp' });
    render(<ActionTerminalPanel />);
    fireEvent.mouseDown(document.querySelector('[data-resize="se"]')!, { button: 0, clientX: 500, clientY: 500 });
    fireEvent.mouseMove(window, { clientX: 0, clientY: 0 });
    fireEvent.mouseUp(window);
    expect(screen.getByRole('dialog').style.width).toBe('420px');
    expect(screen.getByRole('dialog').style.height).toBe('220px');
  });

  it('an edge pulled past the viewport stops at it — the panel never leaves the screen', () => {
    titleBar(38);
    usePinnedActionsStore.setState({ runs: { kp: [run()] }, terminals: [tab()], activeTerminal: 'kp' });
    render(<ActionTerminalPanel />);
    const before = box(screen.getByRole('dialog'));
    fireEvent.mouseDown(document.querySelector('[data-resize="nw"]')!, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: -5000, clientY: -5000 });
    fireEvent.mouseUp(window);
    const b = box(screen.getByRole('dialog'));
    expect([b.x, b.y]).toEqual([0, 38]);
    // The opposite corner did not move.
    expect([b.x + b.width, b.y + b.height]).toEqual([before.x + before.width, before.y + before.height]);
  });

  it('maximized has no grips', () => {
    usePinnedActionsStore.setState({ runs: { kp: [run()] }, terminals: [tab()], activeTerminal: 'kp' });
    render(<ActionTerminalPanel />);
    fireEvent.click(screen.getByRole('button', { name: /^Maximize/ }));
    expect(document.querySelectorAll('[data-resize]')).toHaveLength(0);
  });
});
