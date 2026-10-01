import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PinnedIcon } from '@fleex/shared';
import { PinnedStatusService, type ProbeExecFn } from './pinned-status.service.js';

const icon = (id: string, command: string | null, extra: Partial<PinnedIcon> = {}): PinnedIcon => ({
  id,
  icon: '',
  iconType: 'svg',
  label: id,
  actionType: 'shell',
  actionValue: 'true',
  ...(command ? { status: { command, intervalSec: 60 } } : {}),
  ...extra,
});

/** An exec whose calls stay pending until the test settles them, to observe concurrency. */
function controllableExec() {
  const pending: { command: string; resolve: (exitCode: number) => void }[] = [];
  const exec: ProbeExecFn = (command) =>
    new Promise((resolve) => {
      pending.push({ command, resolve: (exitCode) => resolve({ stdout: '', stderr: '', exitCode }) });
    });
  return { exec: vi.fn(exec), pending };
}

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

describe('PinnedStatusService', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does not probe while no client is connected, then probes everything on the first connection', async () => {
    const { exec, pending } = controllableExec();
    const svc = new PinnedStatusService({ exec, cwd: '/home', broadcast: vi.fn() });
    svc.configure([icon('gh', 'gh auth status'), icon('gc', 'gcloud auth print-access-token')]);

    await vi.advanceTimersByTimeAsync(120_000);
    expect(exec).not.toHaveBeenCalled();

    svc.clientConnected();
    expect(exec).toHaveBeenCalledTimes(2);
    pending.forEach((p) => p.resolve(0));
    await flush();
    expect(svc.getSnapshots().map((s) => s.status)).toEqual(['ok', 'ok']);
  });

  it('pauses probing when the last client leaves', async () => {
    const { exec, pending } = controllableExec();
    const svc = new PinnedStatusService({ exec, cwd: '/home', broadcast: vi.fn() });
    svc.configure([icon('gh', 'gh auth status')]);
    svc.clientConnected();
    pending[0]!.resolve(0);
    await flush();
    svc.clientDisconnected();

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('never stacks two probes for the same icon: a tick during a slow probe is skipped', async () => {
    const { exec, pending } = controllableExec();
    const svc = new PinnedStatusService({ exec, cwd: '/home', broadcast: vi.fn() });
    // 15 s interval, 60 s timeout: several ticks land while the probe still runs.
    svc.configure([icon('slow', 'sleep 100', { status: { command: 'sleep 100', intervalSec: 15, timeoutSec: 60 } })]);
    svc.clientConnected();
    expect(exec).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(45_000);
    svc.refresh('slow');
    expect(exec).toHaveBeenCalledTimes(1);

    pending[0]!.resolve(0);
    await flush();
    svc.refresh('slow');
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it('runs at most 4 probes at once and queues the rest', async () => {
    const { exec, pending } = controllableExec();
    const svc = new PinnedStatusService({ exec, cwd: '/home', broadcast: vi.fn() });
    svc.configure(Array.from({ length: 6 }, (_, i) => icon(`i${i}`, `probe ${i}`)));
    svc.clientConnected();
    expect(exec).toHaveBeenCalledTimes(4);

    pending[0]!.resolve(0);
    await flush();
    expect(exec).toHaveBeenCalledTimes(5);
  });

  it('a timed-out probe goes grey without blocking the others', async () => {
    const exec: ProbeExecFn = vi.fn(async (command) =>
      command === 'sleep 30'
        ? { stdout: '', stderr: '', exitCode: 1, timedOut: true }
        : { stdout: '', stderr: '', exitCode: 0 },
    );
    const svc = new PinnedStatusService({ exec, cwd: '/home', broadcast: vi.fn() });
    svc.configure([icon('slow', 'sleep 30'), icon('fast', 'true')]);
    svc.clientConnected();
    await flush();
    const byId = Object.fromEntries(svc.getSnapshots().map((s) => [s.iconId, s]));
    expect(byId['slow']).toMatchObject({ status: 'unknown', tooltip: 'Probe failed: timeout' });
    expect(byId['fast']).toMatchObject({ status: 'ok' });
  });

  it('re-probes on the interval', async () => {
    const exec: ProbeExecFn = vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 }));
    const svc = new PinnedStatusService({ exec, cwd: '/home', broadcast: vi.fn() });
    svc.configure([icon('gh', 'gh auth status')]);
    svc.clientConnected();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it('reprogrammes on config change without restart: new probe fires, removed icon leaves the snapshot', async () => {
    const exec: ProbeExecFn = vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 }));
    const broadcast = vi.fn();
    const svc = new PinnedStatusService({ exec, cwd: '/home', broadcast });
    svc.configure([icon('a', 'true'), icon('b', 'true')]);
    svc.clientConnected();
    await flush();

    svc.configure([icon('a', 'true'), icon('c', 'echo hi')]);
    await flush();
    expect(svc.getSnapshots().map((s) => s.iconId).sort()).toEqual(['a', 'c']);
    expect(exec).toHaveBeenLastCalledWith('echo hi', expect.anything());
    expect(broadcast).toHaveBeenCalledWith('pinned-status:snapshot', expect.any(Array));
  });

  it('never probes a hidden action', async () => {
    const exec: ProbeExecFn = vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 }));
    const svc = new PinnedStatusService({ exec, cwd: '/home', broadcast: vi.fn() });
    svc.configure([icon('hidden', 'true', { enabled: false })]);
    svc.clientConnected();
    expect(exec).not.toHaveBeenCalled();
    expect(svc.getSnapshots()).toEqual([]);
  });

  it('drops the result of a probe whose command changed while it ran', async () => {
    const { exec, pending } = controllableExec();
    const svc = new PinnedStatusService({ exec, cwd: '/home', broadcast: vi.fn() });
    svc.configure([icon('a', 'old')]);
    svc.clientConnected();
    svc.configure([icon('a', 'new')]);
    pending[0]!.resolve(1); // old → would be ko
    await flush();
    expect(svc.getSnapshots()[0]!.status).not.toBe('ko');
  });

  it('runs probes in the home directory with the configured timeout', async () => {
    const exec: ProbeExecFn = vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 }));
    const svc = new PinnedStatusService({ exec, cwd: '/Users/me', broadcast: vi.fn() });
    svc.configure([icon('a', 'true', { status: { command: 'true', intervalSec: 60, timeoutSec: 7 } })]);
    svc.clientConnected();
    expect(exec).toHaveBeenCalledWith('true', { cwd: '/Users/me', timeoutMs: 7000 });
  });
});
