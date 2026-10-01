import { describe, it, expect, vi } from 'vitest';
import type { ActionRun, ActionRunOutputChunk } from '@fleex/shared';
import { ActionRunService, OUTPUT_CHUNK_MAX_BYTES, type StreamExecHandle, type TerminalRunPort } from './action-run.service.js';
import { NdjsonParser } from '../../infrastructure/host/stream-exec.js';

const req = (extra: Record<string, unknown> = {}) => ({ sourceId: 'kp', sourceKind: 'pinned' as const, label: 'K8s', command: 'platool connect', ...extra });
const flushAll = () => new Promise((r) => setTimeout(r, 0));

/** A controllable streaming exec + a manual flush clock. */
function harness() {
  let onOutput: (s: 'stdout' | 'stderr', c: string) => void = () => {};
  let finish: (o: { exitCode: number; timedOut: boolean; cancelled: boolean }) => void = () => {};
  const cancel = vi.fn(async () => finish({ exitCode: 143, timedOut: false, cancelled: true }));
  const timers: (() => void)[] = [];
  const events: { type: string; data: ActionRun | ActionRunOutputChunk }[] = [];
  const svc = new ActionRunService({
    exec: vi.fn(async () => ({ stdout: 'buffered', stderr: '', exitCode: 0 })),
    streamExec: vi.fn(async (_c, o) => {
      onOutput = o.onOutput;
      const done = new Promise<{ exitCode: number; timedOut: boolean; cancelled: boolean }>((r) => { finish = r; });
      return { done, cancel } satisfies StreamExecHandle;
    }),
    defaultCwd: '/home',
    broadcast: (type, data) => events.push({ type, data }),
    setTimer: (fn) => { timers.push(fn); return timers.length; },
    clearTimer: () => {},
  });
  const tick = () => { const due = timers.splice(0); due.forEach((f) => f()); };
  const outputs = () => events.filter((e) => e.type === 'action-run:output').map((e) => e.data as ActionRunOutputChunk);
  return { svc, emit: (s: 'stdout' | 'stderr', c: string) => onOutput(s, c), finish: (code = 0) => finish({ exitCode: code, timedOut: false, cancelled: false }), cancel, tick, events, outputs };
}

describe('NdjsonParser', () => {
  it('reassembles lines cut across chunks and skips blank or garbled ones', () => {
    const p = new NdjsonParser();
    expect(p.push('{"t":"out","d":"a"}\n{"t":"o')).toEqual([{ t: 'out', d: 'a' }]);
    expect(p.push('ut","d":"b"}\n\n not json \n{"t":"exit","code":0}\n')).toEqual([{ t: 'out', d: 'b' }, { t: 'exit', code: 0 }]);
  });
});

describe('ActionRunService · live output', () => {
  it('batches output per tick instead of one message per write, in increasing seq', async () => {
    const h = harness();
    h.svc.start(req());
    await flushAll();
    h.emit('stdout', '1\n'); h.emit('stdout', '2\n'); h.emit('stderr', 'warn\n');
    expect(h.outputs()).toHaveLength(0);
    h.tick();
    expect(h.outputs()).toEqual([
      expect.objectContaining({ stream: 'stdout', chunk: '1\n2\n', seq: 1 }),
      expect.objectContaining({ stream: 'stderr', chunk: 'warn\n', seq: 2 }),
    ]);
    h.emit('stdout', '3\n');
    h.finish();
    await flushAll();
    // Pending output is flushed before "finished", which carries the whole log.
    expect(h.outputs().at(-1)).toMatchObject({ chunk: '3\n', seq: 3 });
    const finished = h.events.at(-1)!;
    expect(finished.type).toBe('action-run:finished');
    expect(finished.data).toMatchObject({ stdout: '1\n2\n3\n', stderr: 'warn\n', exitCode: 0, mode: 'background' });
  });

  it('never sends more than 16 KB live, and says how much it skipped', async () => {
    const h = harness();
    h.svc.start(req());
    await flushAll();
    h.emit('stdout', 'x'.repeat(OUTPUT_CHUNK_MAX_BYTES + 1000));
    h.tick();
    const [chunk] = h.outputs();
    expect(Buffer.byteLength(chunk!.chunk)).toBe(OUTPUT_CHUNK_MAX_BYTES);
    expect(chunk!.dropped).toBe(1000);
  });

  it('keeps only the 64 KB tail of a 5 MB output, with the truncated mark', async () => {
    const h = harness();
    h.svc.start(req());
    await flushAll();
    for (let i = 0; i < 80; i += 1) h.emit('stdout', `${'y'.repeat(64 * 1024 - 1)}\n`);
    h.emit('stdout', 'THE END\n');
    h.finish();
    await flushAll();
    const run = h.events.at(-1)!.data as ActionRun;
    expect(run.stdout.startsWith('…(truncated)\n')).toBe(true);
    expect(run.stdout.endsWith('THE END\n')).toBe(true);
    expect(Buffer.byteLength(run.stdout)).toBeLessThan(70 * 1024);
  });
});

describe('ActionRunService · stop', () => {
  it('Stop kills the run and marks it cancelled; a finished or unknown run cannot be stopped', async () => {
    const h = harness();
    const { run } = h.svc.start(req()) as { run: ActionRun };
    await flushAll();
    expect(await h.svc.cancel(run.runId)).toBe(true);
    await flushAll();
    expect(h.cancel).toHaveBeenCalled();
    expect(h.events.at(-1)!.data).toMatchObject({ cancelled: true, exitCode: 143 });
    expect(await h.svc.cancel(run.runId)).toBe(false);
    expect(await h.svc.cancel('nope')).toBe(false);
  });
});

describe('ActionRunService · gateway not restarted', () => {
  it('falls back to the buffered exec and flags the run, instead of failing', async () => {
    const events: { type: string; data: unknown }[] = [];
    const svc = new ActionRunService({
      exec: async () => ({ stdout: 'done', stderr: '', exitCode: 0 }),
      streamExec: async () => null,
      defaultCwd: '/home',
      broadcast: (type, data) => events.push({ type, data }),
    });
    svc.start(req());
    await flushAll(); await flushAll();
    expect(events.at(-1)!.data).toMatchObject({ stdout: 'done', exitCode: 0, liveUnavailable: true });
  });
});

describe('ActionRunService · terminal mode', () => {
  type TerminalOutcome = { exitCode: number; output: string; cancelled: boolean; timedOut: boolean };
  function terminalHarness() {
    let finish: (o: { exitCode: number; output: string; cancelled: boolean; timedOut: boolean }) => void = () => {};
    const terminal: TerminalRunPort & { close: ReturnType<typeof vi.fn> } = {
      sessionNameFor: (id) => `fxact_3000_${id}`,
      start: vi.fn(async () => ({
        done: new Promise<TerminalOutcome>((r) => { finish = r; }),
        cancel: vi.fn(async () => finish({ exitCode: 130, output: '', cancelled: true, timedOut: false })),
      })),
      close: vi.fn(async () => {}),
    };
    const events: { type: string; data: ActionRun }[] = [];
    const exec = vi.fn();
    const svc = new ActionRunService({ exec, terminal, defaultCwd: '/home', broadcast: (type, data) => events.push({ type, data: data as ActionRun }) });
    return { svc, terminal, events, exec, finish: (o: { exitCode: number; output: string }) => finish({ ...o, cancelled: false, timedOut: false }) };
  }

  it('runs in a terminal: the tmux session is known at once, the real exit code at the end', async () => {
    const t = terminalHarness();
    const res = t.svc.start(req({ mode: 'terminal' })) as { run: ActionRun };
    expect(res.run).toMatchObject({ mode: 'terminal', tmuxSession: 'fxact_3000_kp' });
    expect(await t.svc.terminalSession(res.run.runId)).toBe('fxact_3000_kp');
    t.finish({ exitCode: 3, output: 'Pulling…\nerror\n' });
    await flushAll();
    expect(t.events.at(-1)!.data).toMatchObject({ exitCode: 3, stdout: 'Pulling…\nerror\n', mode: 'terminal' });
    expect(t.exec).not.toHaveBeenCalled();
  });

  it('closing the panel of a finished run closes its terminal; of a running one, stops it', async () => {
    const t = terminalHarness();
    const { run } = t.svc.start(req({ mode: 'terminal' })) as { run: ActionRun };
    await flushAll();
    expect(await t.svc.closeTerminal(run.runId)).toBe(true);
    await flushAll();
    expect(t.events.at(-1)!.data).toMatchObject({ cancelled: true, exitCode: 130 });
    expect(await t.svc.closeTerminal(run.runId)).toBe(true);
    expect(t.terminal.close).toHaveBeenCalledWith('fxact_3000_kp');
  });

  it('a second click while a terminal run is open answers with the running run (409 path)', () => {
    const t = terminalHarness();
    const first = t.svc.start(req({ mode: 'terminal' })) as { run: ActionRun };
    expect(t.svc.start(req({ mode: 'terminal' }))).toEqual({ ok: false, runningRunId: first.run.runId });
  });
});

describe('ActionRunService · one action, several commands (rules)', () => {
  function terminalSvc() {
    const started: string[] = [];
    const terminal: TerminalRunPort = {
      sessionNameFor: (key) => `fxact_3000_${key.replace(/[^A-Za-z0-9_-]/g, '_')}`,
      start: vi.fn(async (req) => {
        started.push(req.sessionName);
        return { done: new Promise<never>(() => {}), cancel: vi.fn(async () => {}) };
      }),
      close: vi.fn(async () => {}),
    };
    const svc = new ActionRunService({ exec: vi.fn(), terminal, defaultCwd: '/home', broadcast: () => {} });
    return { svc, started };
  }

  it('k9s --context A and --context B of the same action run side by side, each in its own terminal', async () => {
    const { svc, started } = terminalSvc();
    const a = svc.start(req({ mode: 'terminal', slot: 'ctx-a', command: 'k9s --context A' })) as { ok: true; run: ActionRun };
    const b = svc.start(req({ mode: 'terminal', slot: 'ctx-b', command: 'k9s --context B' })) as { ok: true; run: ActionRun };
    expect(a.ok && b.ok).toBe(true);
    expect(a.run.tmuxSession).not.toBe(b.run.tmuxSession);
    expect(b.run).toMatchObject({ sourceId: 'kp', slot: 'ctx-b' });
    await flushAll();
    expect(started).toHaveLength(2);
    expect(svc.isRunning('kp')).toBe(true);
  });

  it('the same command twice is still refused (409 path), whatever the other commands do', () => {
    const { svc } = terminalSvc();
    const a = svc.start(req({ mode: 'terminal', slot: 'ctx-a' })) as { run: ActionRun };
    svc.start(req({ mode: 'terminal' }));
    expect(svc.start(req({ mode: 'terminal', slot: 'ctx-a' }))).toEqual({ ok: false, runningRunId: a.run.runId });
  });
});
