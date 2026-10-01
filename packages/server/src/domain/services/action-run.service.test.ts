import { describe, it, expect, vi } from 'vitest';
import type { ActionRunRequest } from '@fleex/shared';
import {
  ActionRunService,
  RUNS_PER_SOURCE,
  RUNS_TOTAL,
  RUN_OUTPUT_MAX_BYTES,
  clampActionTimeout,
  type RunExecFn,
} from './action-run.service.js';

const req = (sourceId: string, command = 'true', extra: Partial<ActionRunRequest> = {}): ActionRunRequest => ({
  sourceId,
  sourceKind: 'pinned',
  label: sourceId,
  command,
  ...extra,
});

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

describe('ActionRunService', () => {
  it('keeps the exit code and output of a run, and announces start then finish', async () => {
    const exec: RunExecFn = vi.fn(async () => ({ stdout: 'out', stderr: 'boom\nmore', exitCode: 3 }));
    const broadcast = vi.fn();
    const svc = new ActionRunService({ exec, defaultCwd: '/home', broadcast });

    const started = svc.start(req('gh', 'exit 3'));
    expect(started.ok).toBe(true);
    await flush();

    expect(broadcast.mock.calls.map((c) => c[0])).toEqual(['action-run:started', 'action-run:finished']);
    expect(svc.list('gh')[0]).toMatchObject({ exitCode: 3, stdout: 'out', stderr: 'boom\nmore' });
  });

  it('refuses a second run of the same source while one is in flight, pointing at the running one', async () => {
    let finish!: () => void;
    const exec: RunExecFn = () => new Promise((resolve) => { finish = () => resolve({ stdout: '', stderr: '', exitCode: 0 }); });
    const svc = new ActionRunService({ exec, defaultCwd: '/home', broadcast: vi.fn() });

    const first = svc.start(req('gh'));
    const second = svc.start(req('gh'));
    expect(second).toEqual({ ok: false, runningRunId: first.ok ? first.run.runId : '' });

    finish();
    await flush();
    expect(svc.start(req('gh')).ok).toBe(true);
  });

  it('uses a 300 s default timeout — long enough for a browser login — capped at 1800 s', async () => {
    const exec: RunExecFn = vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 }));
    const svc = new ActionRunService({ exec, defaultCwd: '/home', broadcast: vi.fn() });
    svc.start(req('a'));
    svc.start(req('b', 'true', { timeoutSec: 99_999, cwd: '/ws' }));
    expect(exec).toHaveBeenNthCalledWith(1, 'true', { cwd: '/home', timeoutMs: 300_000 });
    expect(exec).toHaveBeenNthCalledWith(2, 'true', { cwd: '/ws', timeoutMs: 1_800_000 });
    expect(clampActionTimeout(undefined)).toBe(300);
  });

  it('flags a timeout so the UI can say so instead of showing a bare exit 1', async () => {
    const exec: RunExecFn = async () => ({ stdout: '', stderr: '', exitCode: 1, timedOut: true });
    const svc = new ActionRunService({ exec, defaultCwd: '/home', broadcast: vi.fn() });
    svc.start(req('a'));
    await flush();
    expect(svc.list('a')[0]!.timedOut).toBe(true);
  });

  it('records a gateway failure as a finished run with the error in stderr', async () => {
    const exec: RunExecFn = async () => { throw new Error('gateway down'); };
    const svc = new ActionRunService({ exec, defaultCwd: '/home', broadcast: vi.fn() });
    svc.start(req('a'));
    await flush();
    expect(svc.list('a')[0]).toMatchObject({ stderr: 'error: gateway down' });
    expect(svc.list('a')[0]!.exitCode).toBeUndefined();
    expect(svc.isRunning('a')).toBe(false);
  });

  it('calls onFinished so the icon can be re-probed right away', async () => {
    const onFinished = vi.fn();
    const svc = new ActionRunService({ exec: async () => ({ stdout: '', stderr: '', exitCode: 0 }), defaultCwd: '/h', broadcast: vi.fn(), onFinished });
    svc.start(req('kp'));
    await flush();
    expect(onFinished).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 'kp', exitCode: 0 }));
  });

  it('keeps 20 runs per source and 200 overall, newest first', async () => {
    const svc = new ActionRunService({ exec: async () => ({ stdout: '', stderr: '', exitCode: 0 }), defaultCwd: '/h', broadcast: vi.fn() });
    for (let i = 0; i < 25; i += 1) {
      svc.start(req('a', `echo ${i}`));
      await flush();
    }
    const runs = svc.list('a');
    expect(runs).toHaveLength(RUNS_PER_SOURCE);
    expect(runs[0]!.command).toBe('echo 24');

    for (let i = 0; i < RUNS_TOTAL + 10; i += 1) {
      svc.start(req(`s${i}`));
      await flush();
    }
    expect(svc.list()).toHaveLength(RUNS_TOTAL);
  });

  it('truncates huge output to its tail', async () => {
    const big = 'x'.repeat(RUN_OUTPUT_MAX_BYTES + 100) + 'END';
    const svc = new ActionRunService({ exec: async () => ({ stdout: big, stderr: '', exitCode: 0 }), defaultCwd: '/h', broadcast: vi.fn() });
    svc.start(req('a'));
    await flush();
    const out = svc.list('a')[0]!.stdout;
    expect(out.endsWith('END')).toBe(true);
    expect(out.length).toBeLessThan(big.length);
  });
});
