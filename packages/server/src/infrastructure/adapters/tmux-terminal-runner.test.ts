import { describe, it, expect, vi } from 'vitest';
import { TmuxTerminalRunner, stripTerminalOutput, shellQuote } from './tmux-terminal-runner.js';
import type { ExecFn, HostFs } from '../host/types.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

function fakeTmux(paneStates: ('gone' | string)[], sessions: string[] = []) {
  const calls: string[][] = [];
  const execFn: ExecFn = vi.fn(async (_cmd: string, args: string[]) => {
    calls.push(args);
    if (args[0] === 'list-panes') {
      const next = paneStates.length > 1 ? paneStates.shift()! : paneStates[0]!;
      if (next === 'gone') throw new Error("can't find session");
      return { stdout: next, stderr: '' };
    }
    if (args[0] === 'list-sessions') return { stdout: sessions.join('\n'), stderr: '' };
    return { stdout: '', stderr: '' };
  });
  const hostFs = { readTail: vi.fn(async () => '\x1b[32mPulling\x1b[0m…\r\ndone\r\n'), rm: vi.fn(async () => {}) } as unknown as HostFs;
  const timers: (() => void)[] = [];
  // Only the poll timers advance; the 4 h safety net never fires here.
  const runner = new TmuxTerminalRunner(execFn, hostFs, '/tmp', logger, {
    instanceTag: '3000',
    pollMs: 1000,
    setTimer: (fn, ms) => { if (ms === 1000) timers.push(fn); return timers.length; },
    clearTimer: () => {},
  });
  const tick = async () => { const due = timers.splice(0); for (const f of due) f(); await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); };
  return { runner, calls, tick, hostFs };
}

describe('TmuxTerminalRunner', () => {
  it('runs an interactive login zsh, waits until capture is set up, and reads the real exit code', async () => {
    const t = fakeTmux(['0 0', '1 3']);
    const name = t.runner.sessionNameFor('kp');
    const handle = await t.runner.start({ runId: 'r1', command: "platool kubernetes connect -e 'prod'", cwd: '/Users/me', sessionName: name });
    const create = t.calls.find((a) => a[0] === 'new-session')!;
    expect(create.at(-1)).toBe(`tmux wait-for 'fxgo_r1'; exec /bin/zsh -l -i -c 'platool kubernetes connect -e '\\''prod'\\'''`);
    // remain-on-exit + pipe-pane come before the command is released.
    const order = t.calls.map((a) => a[0]);
    expect(order.indexOf('pipe-pane')).toBeLessThan(order.lastIndexOf('wait-for'));
    expect(t.calls.some((a) => a.includes('remain-on-exit'))).toBe(true);
    await t.tick(); await t.tick();
    expect(await handle.done).toEqual({ exitCode: 3, output: 'Pulling…\ndone\n', cancelled: false, timedOut: false });
  });

  it('a session killed before the end (panel closed) is a cancel with exit 130', async () => {
    const t = fakeTmux(['gone']);
    const handle = await t.runner.start({ runId: 'r2', command: 'sleep 600', cwd: '/', sessionName: t.runner.sessionNameFor('kp') });
    await t.tick();
    expect(await handle.done).toMatchObject({ exitCode: 130, cancelled: true });
  });

  it('names sessions outside fleex_ (never adopted as user sessions) and per instance', () => {
    const t = fakeTmux(['gone']);
    expect(t.runner.sessionNameFor('draft:a b')).toBe('fxact_3000_draft_a_b');
  });

  it('at startup kills only its own leftover action terminals, not another instance’s nor user sessions', async () => {
    const t = fakeTmux(['gone'], ['fleex_abc', 'fxact_3000_kp', 'fxact_3001_kp', 'work']);
    expect(await t.runner.killOrphans()).toBe(1);
    expect(t.calls.filter((a) => a[0] === 'kill-session').map((a) => a[2])).toEqual(['fxact_3000_kp']);
  });
});

describe('terminal output helpers', () => {
  it('strips colours and carriage returns, and quotes for sh', () => {
    expect(stripTerminalOutput('\x1b]0;title\x07\x1b[1mhi\x1b[0m\r\n')).toBe('hi\n');
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
  });
});

describe('TmuxTerminalRunner · safety net', () => {
  it('a terminal left open past the max duration is killed and reported as a timeout, not a cancel', async () => {
    const calls: string[][] = [];
    const execFn = vi.fn(async (_c: string, args: string[]) => {
      calls.push(args);
      if (args[0] === 'list-panes') throw new Error('gone');
      return { stdout: '', stderr: '' };
    }) as unknown as ExecFn;
    const hostFs = { readTail: vi.fn(async () => ''), rm: vi.fn(async () => {}) } as unknown as HostFs;
    let guard: () => void = () => {};
    const polls: (() => void)[] = [];
    const runner = new TmuxTerminalRunner(execFn, hostFs, '/tmp', logger, {
      pollMs: 1000, maxMs: 5000,
      setTimer: (fn, ms) => { if (ms === 5000) guard = fn; else polls.push(fn); return 0; },
      clearTimer: () => {},
    });
    const handle = await runner.start({ runId: 'r3', command: 'gcloud auth login', cwd: '/', sessionName: runner.sessionNameFor('g') });
    guard();
    polls.splice(0).forEach((p) => p());
    expect(await handle.done).toMatchObject({ exitCode: 130, timedOut: true, cancelled: false });
    expect(calls.some((a) => a[0] === 'kill-session')).toBe(true);
  });
});
