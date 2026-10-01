import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ActionRun, PinnedIcon } from '@fleex/shared';
import { usePinnedActionsStore } from './pinnedActionsStore';
import { useToastStore } from './toastStore';
import { useSettingsStore } from './settingsStore';
import * as api from '../services/api';

vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  startActionRun: vi.fn(async () => ({ runId: 'r1', alreadyRunning: false })),
  fetchActionRuns: vi.fn(async () => []),
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
  usePinnedActionsStore.setState({ statuses: {}, runs: {}, running: {}, logs: null });
  useToastStore.setState({ toasts: [] });
  vi.clearAllMocks();
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
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: 'warning', message: 'K8s prod timed out' });
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
