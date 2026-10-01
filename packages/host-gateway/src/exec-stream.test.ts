import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { startStreamExec, killExec, type StreamEvent } from './exec-stream';

function collect(command: string, opts: { timeout?: number } = {}) {
  const events: StreamEvent[] = [];
  const handle = startStreamExec({ command, ...opts }, (e) => events.push(e));
  return { events, ...handle };
}
const exitOf = (events: StreamEvent[]) => events.find((e) => e.t === 'exit') as Extract<StreamEvent, { t: 'exit' }>;
const alive = (pattern: string) => {
  try { execFileSync('pgrep', ['-f', pattern]); return true; } catch { return false; }
};

describe('streaming exec', () => {
  it('delivers output while the command runs, not only at the end', async () => {
    const { events, done } = collect('echo one; sleep 0.4; echo two');
    await new Promise((r) => setTimeout(r, 250));
    expect(events.filter((e) => e.t === 'out').map((e) => (e as { d: string }).d).join('')).toBe('one\n');
    await done;
    expect(exitOf(events)).toMatchObject({ code: 0, timedOut: false, cancelled: false });
  });

  it('keeps stderr apart and reports the real exit code', async () => {
    const { events, done } = collect('echo oops >&2; exit 3');
    await done;
    expect(events.find((e) => e.t === 'err')).toEqual({ t: 'err', d: 'oops\n' });
    expect(exitOf(events).code).toBe(3);
  });

  it('Stop kills the whole process group — no child survives (docker run, sleep…)', async () => {
    // Odd durations nobody else on the machine is sleeping for.
    const a = 6000 + (process.pid % 997), b = a + 1;
    const { events, done, execId } = collect(`sleep ${a} & sleep ${b}`);
    await new Promise((r) => setTimeout(r, 300));
    expect(alive(`sleep ${a}`)).toBe(true);
    expect(alive(`sleep ${b}`)).toBe(true);
    expect(killExec(execId)).toBe(true);
    await done;
    expect(exitOf(events)).toMatchObject({ cancelled: true, code: 143 });
    await new Promise((r) => setTimeout(r, 200));
    // Both the foreground and the backgrounded child are gone.
    expect(alive(`sleep ${a}`)).toBe(false);
    expect(alive(`sleep ${b}`)).toBe(false);
    expect(killExec(execId)).toBe(false);
  });

  it('times out by stopping the group and says so', async () => {
    const { events, done } = collect('sleep 30', { timeout: 300 });
    await done;
    expect(exitOf(events)).toMatchObject({ timedOut: true, cancelled: false });
  });
});
