import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ActionRun, PinnedIcon } from '@fleex/shared';
import { appendLiveOutput, resetPinnedActionsTransient, usePinnedActionsStore, START_TOAST_DELAY_MS } from './pinnedActionsStore';
import { useToastStore } from './toastStore';
import { useSettingsStore } from './settingsStore';
import * as api from '../services/api';

vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  startActionRun: vi.fn(async () => ({ runId: 'r1', alreadyRunning: false })),
  fetchActionRuns: vi.fn(async () => []),
  cancelActionRun: vi.fn(async () => true),
  closeActionTerminal: vi.fn(async () => true),
  fetchActionRunCapabilities: vi.fn(async () => ({ liveOutput: true, terminal: true })),
  updateConfig: vi.fn(async () => ({})),
}));

const run = (extra: Partial<ActionRun>): ActionRun => ({
  runId: 'r1',
  sourceId: 'kp',
  sourceKind: 'pinned',
  label: 'K8s prod',
  command: 'platool login prod',
  startedAt: '2026-10-01T10:00:00.000Z',
  finishedAt: '2026-10-01T10:00:03.200Z',
  stdout: '',
  stderr: '',
  ...extra,
});

beforeEach(() => {
  resetPinnedActionsTransient();
  usePinnedActionsStore.setState({ statuses: {}, runs: {}, running: {}, logs: null, liveOutput: {}, terminals: [], activeTerminal: null, terminalFocusNonce: 0, capabilities: null });
  useToastStore.setState({ toasts: [] });
  vi.clearAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('run feedback', () => {
  it('toasts a failure with the exit code and the first stderr line, and offers the logs', () => {
    const { handleWsMessage } = usePinnedActionsStore.getState();
    handleWsMessage({ type: 'action-run:started', data: run({ finishedAt: undefined }) });
    expect(usePinnedActionsStore.getState().running['kp']).toBe('r1');

    handleWsMessage({ type: 'action-run:finished', data: run({ exitCode: 3, stderr: '\nerror: VPN required\nmore' }) });
    const toast = useToastStore.getState().toasts[0]!;
    expect(toast.type).toBe('error');
    expect(toast.message).toContain('exit 3');
    expect(toast.detail).toBe('error: VPN required');

    toast.action!.onClick();
    expect(usePinnedActionsStore.getState().logs).toMatchObject({ sourceId: 'kp', runId: 'r1' });
    expect(usePinnedActionsStore.getState().running['kp']).toBeUndefined();
  });

  it('toasts a success with its duration', () => {
    usePinnedActionsStore.getState().handleWsMessage({ type: 'action-run:finished', data: run({ exitCode: 0 }) });
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: 'success', message: '✓ K8s prod (3.2 s)' });
  });

  it('says "timed out" instead of a bare exit code', () => {
    usePinnedActionsStore.getState().handleWsMessage({ type: 'action-run:finished', data: run({ exitCode: 1, timedOut: true }) });
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: 'warning', message: 'K8s prod — Timed out' });
  });

  it('says why when it can: a command not found names the program instead of "exit 127"', () => {
    usePinnedActionsStore.getState().handleWsMessage({ type: 'action-run:finished', data: run({ exitCode: 127, stderr: 'zsh:1: command not found: platool' }) });
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: 'error', message: '✗ K8s prod — Command not found: platool' });
  });

  it('says "needs a terminal" for a docker run -it without TTY', () => {
    usePinnedActionsStore.getState().handleWsMessage({ type: 'action-run:finished', data: run({ exitCode: 1, stderr: 'the input device is not a TTY' }) });
    expect(useToastStore.getState().toasts[0]!.message).toBe('✗ K8s prod — This command needs a terminal');
  });

  it('stays silent for a Settings "Try" run — its result is shown inline there', () => {
    usePinnedActionsStore.getState().handleWsMessage({ type: 'action-run:finished', data: run({ sourceId: 'draft:kp', exitCode: 1 }) });
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});

describe('executePinnedAction', () => {
  const icon: PinnedIcon = {
    id: 'kp',
    icon: '',
    iconType: 'svg',
    label: 'K8s prod',
    actionType: 'shell',
    actionValue: 'platool login prod',
    status: { command: 'kubectl --context prod cluster-info', intervalSec: 60 },
    conditionalActions: [{ id: 'r', label: 'Disconnect from prod', when: ['ok'], actionType: 'shell', actionValue: 'platool logout prod' }],
  };

  it('logs out when the probe says ok — the click follows the status', async () => {
    usePinnedActionsStore.setState({ statuses: { kp: { iconId: 'kp', status: 'ok', probing: false } } });
    useSettingsStore.getState().executePinnedAction(icon);
    await Promise.resolve();
    expect(api.startActionRun).toHaveBeenCalledWith(expect.objectContaining({ command: 'platool logout prod', label: 'Disconnect from prod' }));
  });

  it('falls back to the default action (log in) when ko', async () => {
    usePinnedActionsStore.setState({ statuses: { kp: { iconId: 'kp', status: 'ko', probing: false } } });
    useSettingsStore.getState().executePinnedAction(icon);
    await Promise.resolve();
    expect(api.startActionRun).toHaveBeenCalledWith(expect.objectContaining({ command: 'platool login prod', sourceId: 'kp' }));
  });

  it('does not start a second run while one is in flight', async () => {
    usePinnedActionsStore.setState({ running: { kp: 'r0' } });
    useSettingsStore.getState().executePinnedAction(icon);
    await Promise.resolve();
    expect(api.startActionRun).not.toHaveBeenCalled();
  });
});

describe('reconcileRuns (after a WS reconnect)', () => {
  it('clears a spinner whose run finished while the socket was down, and records the run', async () => {
    usePinnedActionsStore.setState({ running: { kp: 'r1' } });
    vi.mocked(api.fetchActionRuns).mockResolvedValueOnce([run({ exitCode: 0 })]);
    await usePinnedActionsStore.getState().reconcileRuns();
    expect(usePinnedActionsStore.getState().running['kp']).toBeUndefined();
    expect(usePinnedActionsStore.getState().runs['kp']?.[0]).toMatchObject({ runId: 'r1', exitCode: 0 });
  });

  it('clears a spinner the server no longer knows about (server restarted)', async () => {
    usePinnedActionsStore.setState({ running: { kp: 'gone' } });
    vi.mocked(api.fetchActionRuns).mockResolvedValueOnce([]);
    await usePinnedActionsStore.getState().reconcileRuns();
    expect(usePinnedActionsStore.getState().running['kp']).toBeUndefined();
  });

  it('keeps runs still in flight on the server, optimistic "pending" ones, and runs started during the fetch', async () => {
    usePinnedActionsStore.setState({ running: { kp: 'r1', other: 'pending' } });
    vi.mocked(api.fetchActionRuns).mockImplementationOnce(async () => {
      usePinnedActionsStore.getState().handleWsMessage({ type: 'action-run:started', data: run({ runId: 'r9', sourceId: 'late', finishedAt: undefined }) });
      return [run({ finishedAt: undefined })];
    });
    await usePinnedActionsStore.getState().reconcileRuns();
    expect(usePinnedActionsStore.getState().running).toEqual({ kp: 'r1', other: 'pending', late: 'r9' });
  });
});

describe('executeWorkspaceAction', () => {
  const action = { id: 'w', icon: '', iconType: 'svg' as const, label: 'Open', actionType: 'shell' as const, actionValue: 'ls {{workspace_path}}' };
  const context = { workspace_path: '/base/workspaces/abc123-x', workspace_name: 'abc123-x', ticket_id: 'abc123', ticket_slug: 'x', ticket_display_id: '1' };

  it('runs in the ticket workspace once ensure-workspace succeeded', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await useSettingsStore.getState().executeWorkspaceAction(action, context);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain('/tickets/abc123/ensure-workspace');
    expect(api.startActionRun).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/base/workspaces/abc123-x' }));
  });

  it('omits cwd when ensure-workspace failed, so the server default applies', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    try {
      await useSettingsStore.getState().executeWorkspaceAction(action, context);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(api.startActionRun).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.startActionRun).mock.calls[0]![0]).not.toHaveProperty('cwd');
  });
});

const chunk = (seq: number, text: string, extra: { dropped?: number; stream?: 'stdout' | 'stderr' } = {}) => ({
  type: 'action-run:output' as const,
  data: { runId: 'r1', sourceId: 'kp', stream: extra.stream ?? ('stdout' as const), chunk: text, seq, ...(extra.dropped ? { dropped: extra.dropped } : {}) },
});

describe('live output', () => {
  it('orders stdout and stderr chunks by seq, whatever order they arrive in', () => {
    const { handleWsMessage } = usePinnedActionsStore.getState();
    handleWsMessage({ type: 'action-run:started', data: run({ finishedAt: undefined }) });
    handleWsMessage(chunk(2, 'three\n'));
    handleWsMessage(chunk(0, 'one\n'));
    handleWsMessage(chunk(1, 'two\n', { stream: 'stderr' }));
    handleWsMessage(chunk(1, 'two\n', { stream: 'stderr' })); // a duplicate is ignored
    expect(usePinnedActionsStore.getState().liveOutput['r1']!.text).toBe('one\ntwo\nthree\n');
  });

  it('keeps only the tail past the client cap and counts what was cut, plus what the server dropped', () => {
    let live = appendLiveOutput(undefined, chunk(0, 'aaaaa').data, 8);
    live = appendLiveOutput(live, chunk(1, 'bbbbb', { dropped: 100 }).data, 8);
    expect(live.text).toBe('aaabbbbb');
    expect(live.dropped).toBe(102);
    // A late chunk older than what was cut does not come back: it only adds to the count.
    live = appendLiveOutput(live, chunk(-1, 'zz').data, 8);
    expect(live.text).toBe('aaabbbbb');
    expect(live.dropped).toBe(104);
  });

  it('is dropped once the final log arrives, and a late chunk does not bring it back', () => {
    const { handleWsMessage } = usePinnedActionsStore.getState();
    handleWsMessage({ type: 'action-run:started', data: run({ finishedAt: undefined }) });
    handleWsMessage(chunk(0, 'one'));
    handleWsMessage({ type: 'action-run:finished', data: run({ exitCode: 0, stdout: 'one' }) });
    handleWsMessage(chunk(1, 'late'));
    expect(usePinnedActionsStore.getState().liveOutput['r1']).toBeUndefined();
  });
});

describe('start toast', () => {
  it('appears only once a run has lasted 3 s, and the final toast replaces it', () => {
    vi.useFakeTimers();
    const { handleWsMessage } = usePinnedActionsStore.getState();
    handleWsMessage({ type: 'action-run:started', data: run({ finishedAt: undefined }) });
    vi.advanceTimersByTime(START_TOAST_DELAY_MS - 1);
    expect(useToastStore.getState().toasts).toHaveLength(0);
    vi.advanceTimersByTime(1);
    const toast = useToastStore.getState().toasts[0]!;
    expect(toast).toMatchObject({ type: 'info', message: 'K8s prod running…' });
    expect(toast.action?.label).toBe('View output');
    toast.action!.onClick();
    expect(usePinnedActionsStore.getState().logs).toMatchObject({ sourceId: 'kp', runId: 'r1' });

    handleWsMessage({ type: 'action-run:finished', data: run({ exitCode: 0 }) });
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual(['✓ K8s prod (3.2 s)']);
  });

  it('never shows for a run that finishes quickly', () => {
    vi.useFakeTimers();
    const { handleWsMessage } = usePinnedActionsStore.getState();
    handleWsMessage({ type: 'action-run:started', data: run({ finishedAt: undefined }) });
    vi.advanceTimersByTime(1000);
    handleWsMessage({ type: 'action-run:finished', data: run({ exitCode: 0, finishedAt: '2026-10-01T10:00:01.000Z' }) });
    vi.advanceTimersByTime(START_TOAST_DELAY_MS + 500);
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual(['✓ K8s prod (1.0 s)']);
  });

  it('is not shown for a terminal run (its panel says it all)', () => {
    vi.useFakeTimers();
    usePinnedActionsStore.getState().handleWsMessage({ type: 'action-run:started', data: run({ finishedAt: undefined, mode: 'terminal' }) });
    vi.advanceTimersByTime(10_000);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});

describe('failures that need a terminal', () => {
  it('a no-tty failure toast offers "Run in a terminal", which re-runs the same command in terminal mode', async () => {
    usePinnedActionsStore.getState().handleWsMessage({ type: 'action-run:finished', data: run({ exitCode: 1, stderr: 'the input device is not a TTY' }) });
    const toast = useToastStore.getState().toasts[0]!;
    expect(toast.action?.label).toBe('Run in a terminal');
    vi.mocked(api.startActionRun).mockResolvedValueOnce({ runId: 'r2', alreadyRunning: false });
    toast.action!.onClick();
    await vi.waitFor(() => expect(api.startActionRun).toHaveBeenCalled());
    expect(api.startActionRun).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 'kp', command: 'platool login prod', mode: 'terminal' }));
    await vi.waitFor(() => expect(usePinnedActionsStore.getState().terminals).toMatchObject([{ sourceId: 'kp', runId: 'r2' }]));
  });

  it('keeps "View logs" for an ordinary failure', () => {
    usePinnedActionsStore.getState().handleWsMessage({ type: 'action-run:finished', data: run({ exitCode: 3, stderr: 'boom' }) });
    expect(useToastStore.getState().toasts[0]!.action?.label).toBe('View logs');
  });

  it('says "stopped" for a cancelled run', () => {
    usePinnedActionsStore.getState().handleWsMessage({ type: 'action-run:finished', data: run({ cancelled: true, exitCode: 130 }) });
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: 'info', message: 'K8s prod — stopped' });
  });
});

describe('run modes', () => {
  const base: PinnedIcon = {
    id: 'kp',
    icon: '',
    iconType: 'svg',
    label: 'K8s prod',
    actionType: 'shell',
    actionValue: 'platool login prod',
    actionTimeoutSec: 60,
    runMode: 'terminal',
    status: { command: 'kubectl --context prod cluster-info', intervalSec: 60 },
    conditionalActions: [{ id: 'r', label: 'Disconnect from prod', when: ['ok'], actionType: 'shell', actionValue: 'platool logout prod', runMode: 'background' }],
  };

  it('executePinnedAction passes the resolved run mode: the rule wins over the action', async () => {
    usePinnedActionsStore.setState({ statuses: { kp: { iconId: 'kp', status: 'ok', probing: false } } });
    useSettingsStore.getState().executePinnedAction(base);
    await Promise.resolve();
    expect(api.startActionRun).toHaveBeenLastCalledWith(expect.objectContaining({ command: 'platool logout prod', mode: 'background' }));

    usePinnedActionsStore.setState({ running: {}, statuses: { kp: { iconId: 'kp', status: 'ko', probing: false } } });
    useSettingsStore.getState().executePinnedAction(base);
    await Promise.resolve();
    const last = vi.mocked(api.startActionRun).mock.calls.at(-1)![0];
    expect(last).toMatchObject({ command: 'platool login prod', mode: 'terminal' });
    // A terminal has no timeout.
    expect(last).not.toHaveProperty('timeoutSec');
  });

  it('executeWorkspaceAction passes the action run mode', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    try {
      await useSettingsStore.getState().executeWorkspaceAction(
        { id: 'w', icon: '', iconType: 'svg', label: 'Shell', actionType: 'shell', actionValue: 'ls', runMode: 'terminal' },
        { workspace_path: '/w', workspace_name: 'w', ticket_id: 't', ticket_slug: 's', ticket_display_id: '1' },
      );
    } finally {
      vi.unstubAllGlobals();
    }
    expect(api.startActionRun).toHaveBeenCalledWith(expect.objectContaining({ mode: 'terminal', cwd: '/w' }));
  });

  it('opens the terminal panel when a terminal run starts from this tab, one tab per source', async () => {
    const { run: start } = usePinnedActionsStore.getState();
    vi.mocked(api.startActionRun).mockResolvedValueOnce({ runId: 't1', alreadyRunning: false, run: run({ runId: 't1', finishedAt: undefined, mode: 'terminal' }) });
    await start({ sourceId: 'kp', sourceKind: 'pinned', label: 'K8s prod', command: 'platool login prod', mode: 'terminal' });
    vi.mocked(api.startActionRun).mockResolvedValueOnce({ runId: 't2', alreadyRunning: false });
    await start({ sourceId: 'gh', sourceKind: 'pinned', label: 'GitHub', command: 'gh auth login', mode: 'terminal' });
    const s = usePinnedActionsStore.getState();
    expect(s.terminals.map((t) => [t.sourceId, t.runId])).toEqual([['kp', 't1'], ['gh', 't2']]);
    expect(s.activeTerminal).toBe('gh');
  });

  it('a second click on a source whose terminal run is in flight brings its panel to the front', async () => {
    usePinnedActionsStore.setState({
      running: { kp: 't1' },
      terminals: [
        { sourceId: 'kp', sourceKind: 'pinned', runId: 't1', label: 'K8s prod', command: 'platool login prod' },
        { sourceId: 'gh', sourceKind: 'pinned', runId: 't2', label: 'GitHub', command: 'gh auth login' },
      ],
      activeTerminal: 'gh',
    });
    useSettingsStore.getState().executePinnedAction({ ...base, status: undefined });
    await Promise.resolve();
    expect(api.startActionRun).not.toHaveBeenCalled();
    expect(usePinnedActionsStore.getState().activeTerminal).toBe('kp');
    expect(usePinnedActionsStore.getState().terminalFocusNonce).toBe(1);
  });

  it('a 409 on a terminal run (started from another tab) opens its panel instead of erroring', async () => {
    vi.mocked(api.startActionRun).mockResolvedValueOnce({ runId: 't9', alreadyRunning: true });
    await usePinnedActionsStore.getState().run({ sourceId: 'kp', sourceKind: 'pinned', label: 'K8s prod', command: 'platool login prod', mode: 'terminal' });
    expect(usePinnedActionsStore.getState().terminals).toMatchObject([{ sourceId: 'kp', runId: 't9' }]);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('cancelRun calls the cancel API', async () => {
    await usePinnedActionsStore.getState().cancelRun('r1');
    expect(api.cancelActionRun).toHaveBeenCalledWith('r1');
  });
});

describe('alwaysRunInTerminal', () => {
  const icon: PinnedIcon = {
    id: 'kp', icon: '', iconType: 'svg', label: 'K8s prod', actionType: 'shell', actionValue: 'platool login prod',
    status: { command: 'kubectl cluster-info', intervalSec: 60 },
    conditionalActions: [{ id: 'r', label: 'Disconnect from prod', when: ['ok'], actionType: 'shell', actionValue: 'platool logout prod' }],
  };
  const stored = () => useSettingsStore.getState().settings.pinnedIcons.find((i) => i.id === 'kp')!;

  beforeEach(() => {
    useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, pinnedIcons: [icon] } });
  });

  it('persists runMode terminal on the action, re-runs it in a terminal, and Undo restores it', async () => {
    await useSettingsStore.getState().alwaysRunInTerminal(run({ exitCode: 1, stderr: 'not a tty' }));
    expect(stored().runMode).toBe('terminal');
    expect(stored().conditionalActions![0]!.runMode).toBeUndefined();
    expect(api.updateConfig).toHaveBeenCalledWith({ pinnedIcons: [expect.objectContaining({ id: 'kp', runMode: 'terminal' })] });
    expect(api.startActionRun).toHaveBeenCalledWith(expect.objectContaining({ command: 'platool login prod', mode: 'terminal' }));

    const toast = useToastStore.getState().toasts.find((t) => t.action?.label === 'Undo')!;
    toast.action!.onClick();
    expect(stored()).not.toHaveProperty('runMode');
  });

  it('persists it on the rule the run came from', async () => {
    usePinnedActionsStore.setState({ statuses: { kp: { iconId: 'kp', status: 'ok', probing: false } } });
    useSettingsStore.getState().executePinnedAction(icon);
    await vi.waitFor(() => expect(api.startActionRun).toHaveBeenCalled());
    usePinnedActionsStore.setState({ running: {} });

    await useSettingsStore.getState().alwaysRunInTerminal(run({ command: 'platool logout prod', label: 'Disconnect from prod', exitCode: 1, stderr: 'not a tty' }));
    expect(stored().conditionalActions![0]!.runMode).toBe('terminal');
    expect(stored().runMode).toBeUndefined();
  });

  it('finds the rule by its command after a reload (no remembered origin)', async () => {
    await useSettingsStore.getState().alwaysRunInTerminal(run({ runId: 'old', command: 'platool logout prod', exitCode: 1 }));
    expect(stored().conditionalActions![0]!.runMode).toBe('terminal');
  });
});
