/**
 * The script station: what it decides to run for a ticket, and what it concludes from how the commands end.
 */
import { describe, it, expect } from 'vitest';
import { normaliseScript, planScript, runScript, scriptOutcomes, withEnv, type ScriptContext, type ScriptSpec, type ShellResult } from '../../src/factory/script-runner.js';
import { normaliseLayout } from '../../src/factory/engine.js';
import type { MachineSpec } from '../../src/factory/types.js';

const actions: Record<string, Record<string, string>> = {
  'acme/api': { test: 'make test', lint: 'make lint' }, 'acme/front': { test: 'pnpm test --run' }, 'acme/dmc': { lint: 'ruff check' },
};
const ctx = (repos: string[], gone: string[] = []): ScriptContext => ({
  workspace: '/ws/t1', worktrees: repos.map((r) => ({ repo: r, path: gone.includes(r) ? null : `/ws/t1/${r.split('/')[1]}` })),
  actions: (r) => actions[r] ?? {}, env: { FLEEX_TICKET_NUMBER: '142' },
});
const spec = (over: Partial<ScriptSpec> = {}): ScriptSpec => ({ lines: [], missing: 'ignore', onFail: 'all', ...over });
/** A shell that fails where it is told to, and remembers what it ran and where. */
const shell = (fail: Record<string, Partial<ShellResult>> = {}) => {
  const ran: [string, string][] = [];
  const run = async (command: string, o: { cwd: string; timeoutMs: number }): Promise<ShellResult> => {
    const last = command.split('\n').pop()!;
    ran.push([o.cwd, last]);
    return { stdout: '', stderr: '', exitCode: 0, ...(fail[last] ?? {}) };
  };
  return { run, ran };
};

describe('what a script station runs', () => {
  it('with a default action: in each repository of the ticket, what that repository calls it', () => {
    const steps = planScript(spec({ action: 'test' }), ctx(['acme/api', 'acme/front']));
    expect(steps.map((s) => [s.where, s.cwd, s.command])).toEqual([['acme/api', '/ws/t1/api', 'make test'], ['acme/front', '/ws/t1/front', 'pnpm test --run']]);
    expect(steps[0]!.from).toBe('repository · action "test"');
  });

  it('the station\'s own line for a repository wins, then its line for any repository, then the default', () => {
    const s = spec({ action: 'test', lines: [{ target: 'acme/front', kind: 'command', value: 'pnpm test --coverage' }, { target: '*', kind: 'action', value: 'lint' }] });
    expect(planScript(s, ctx(['acme/api', 'acme/front', 'acme/dmc'])).map((x) => [x.where, x.command, x.from])).toEqual([
      ['acme/api', 'make lint', 'station · any repository · action "lint"'],
      ['acme/front', 'pnpm test --coverage', 'station · command'],
      ['acme/dmc', 'ruff check', 'station · any repository · action "lint"'],
    ]);
    /* a repository can be named without its owner */
    expect(planScript(spec({ lines: [{ target: 'front', kind: 'command', value: 'x' }] }), ctx(['acme/front']))[0]!.command).toBe('x');
  });

  it('with no default action, runs only its own lines: any command, for any repository or for the ticket\'s workspace', () => {
    const s = spec({ lines: [{ target: 'workspace', kind: 'command', value: 'open http://localhost:3000' }, { target: '*', kind: 'command', value: 'git status' }] });
    expect(planScript(s, ctx(['acme/api'])).map((x) => [x.where, x.cwd, x.command])).toEqual([['workspace', '/ws/t1', 'open http://localhost:3000'], ['acme/api', '/ws/t1/api', 'git status']]);
    /* a ticket with no repository still has its workspace */
    expect(planScript(s, ctx([])).map((x) => x.where)).toEqual(['workspace']);
    expect(planScript(spec(), ctx(['acme/api']))[0]).toMatchObject({ command: null, from: 'nothing to run' });
  });

  it('has nothing to run where a repository does not define the action', () => {
    expect(planScript(spec({ action: 'test' }), ctx(['acme/dmc']))[0]).toMatchObject({ command: null, from: 'repository · action "test"' });
  });
});

describe('what it concludes', () => {
  it('ok when every command ends well, each run in its own worktree with the ticket in its environment', async () => {
    const sh = shell(), res = await runScript(spec({ action: 'test' }), ctx(['acme/api', 'acme/front']), sh.run);
    expect(res).toMatchObject({ status: 'completed', outcome: 'ok', executionId: null, error: null });
    expect(res.reply).toContain('$ make test');
    expect(sh.ran).toEqual([['/ws/t1/api', 'make test'], ['/ws/t1/front', 'pnpm test --run']]);
    expect(withEnv('make test', { FLEEX_TICKET_TITLE: "it's here" })).toBe("export FLEEX_TICKET_TITLE='it'\\''s here'\nmake test");
  });

  it('ko as soon as one fails, with what failed and the end of what it said; the others still run unless told to stop', async () => {
    const fail = { 'make test': { exitCode: 2, stderr: '3 tests failed' } };
    const all = shell(fail), res = await runScript(spec({ action: 'test' }), ctx(['acme/api', 'acme/front']), all.run);
    expect(res.outcome).toBe('ko');
    expect(res.error).toContain('✗ acme/api $ make test · exit 2'); expect(res.error).toContain('3 tests failed'); expect(res.error).toContain('✓ acme/front');
    expect(all.ran).toHaveLength(2);
    const stop = shell(fail), stopped = await runScript(spec({ action: 'test', onFail: 'stop' }), ctx(['acme/api', 'acme/front']), stop.run);
    expect(stop.ran).toHaveLength(1);
    expect(stopped.error).toContain('acme/front: not run');
  });

  it('a command that runs out of time, or cannot be run, is a failure', async () => {
    const late = await runScript(spec({ action: 'test', timeoutSec: 5 }), ctx(['acme/api']), shell({ 'make test': { timedOut: true } }).run);
    expect(late.outcome).toBe('ko'); expect(late.error).toContain('timed out after 5 s');
    const broken = await runScript(spec({ action: 'test' }), ctx(['acme/api']), async () => { throw new Error('no shell'); });
    expect(broken.outcome).toBe('ko'); expect(broken.error).toContain('no shell');
  });

  it('a repository there is nothing to run for is skipped, a failure, or its own way out, as the station says', async () => {
    const run = (missing: ScriptSpec['missing']) => runScript(spec({ action: 'test', missing }), ctx(['acme/api', 'acme/dmc']), shell().run);
    expect((await run('ignore')).outcome).toBe('ok');
    expect((await run('ko')).outcome).toBe('ko');
    const own = await run('own');
    expect(own.outcome).toBe('unconfigured'); expect(own.error).toContain('acme/dmc');
    /* a real failure is still a failure */
    expect((await runScript(spec({ action: 'test', missing: 'own' }), ctx(['acme/api', 'acme/dmc']), shell({ 'make test': { exitCode: 1 } }).run)).outcome).toBe('ko');
  });

  it('a ticket with no repository and no workspace line has nothing to run: the same rule applies', async () => {
    expect((await runScript(spec({ action: 'test' }), ctx([]), shell().run)).outcome).toBe('ok');
    expect((await runScript(spec({ action: 'test', missing: 'own' }), ctx([]), shell().run)).outcome).toBe('unconfigured');
  });

  it('a repository whose worktree is not on disk is a failure: nothing was checked', async () => {
    const res = await runScript(spec({ action: 'test' }), ctx(['acme/api'], ['acme/api']), shell().run);
    expect(res.outcome).toBe('ko'); expect(res.error).toContain('its worktree is not on disk');
  });
});

describe('what a layout keeps of a script station', () => {
  it('lines that can be run, one per target, and the ways out that follow from what it is told', () => {
    const s = normaliseScript({ action: ' test ', missing: 'own', onFail: 'stop', timeoutSec: 99999, lines: [
      { target: 'acme/api', kind: 'command', value: ' make e2e ' }, { target: 'acme/api', kind: 'command', value: 'twice' }, { target: 'workspace', kind: 'action', value: 'open x' },
      { target: '*', kind: 'action', value: 'lint' }, { target: '', kind: 'command', value: 'x' }, { target: 'acme/front', kind: 'command', value: '' },
    ] });
    expect(s).toEqual({ action: 'test', missing: 'own', onFail: 'stop', timeoutSec: 1800, lines: [
      { target: 'acme/api', kind: 'command', value: 'make e2e' }, { target: 'workspace', kind: 'command', value: 'open x' }, { target: '*', kind: 'action', value: 'lint' },
    ] });
    expect(scriptOutcomes(s)).toEqual(['ok', 'ko', 'unconfigured']);
    expect(normaliseScript(undefined)).toEqual({ lines: [], missing: 'ignore', onFail: 'all' });
    const out = normaliseLayout({ w: 20, h: 20, machines: [
      { id: 's', kind: 'station', x: 0, y: 0, w: 5, h: 4, name: 'On arrival', exec: 'script', outcomes: ['whatever'], cap: 2, script: { lines: [], missing: 'own' } } as unknown as MachineSpec,
      { id: 'a', kind: 'station', x: 8, y: 0, w: 5, h: 4, name: 'Agent', exec: 'agent', outcomes: ['ok'], cap: 2, script: { lines: [] } } as unknown as MachineSpec,
    ] }).machines as (MachineSpec & { outcomes: string[]; script?: ScriptSpec })[];
    expect(out[0]!.outcomes).toEqual(['ok', 'ko', 'unconfigured']);
    expect(out[0]!.script).toEqual({ lines: [], missing: 'own', onFail: 'all' });
    expect('script' in out[1]!).toBe(false);
  });
});

describe('a script station on an item', () => {
  it('passes the item in its environment, the same names for every source, each field of its own as FLEEX_ITEM_FIELD_*', async () => {
    const { itemEnv } = await import('../../src/factory/item-env.js');
    const env = itemEnv({ id: 'i1', floorId: 'default', source: 'gmail', sourceKey: '1a20cdcfb877b396', title: "Re: l'offre; rm -rf /", author: 'Ana <ana@acme.com>', excerpt: '', url: null, tags: ['finance', 'reason:mention'], fields: { labels: ['INBOX', 'IMPORTANT'], attachment: true, 'x-thing': 'v' }, messages: 2, lastActivityAt: '2026-11-20T08:00:00.000Z', intakeId: 'in', machineId: null, state: null, archivedAt: null, archivedReason: null, createdAt: '', updatedAt: '' });
    expect(env).toMatchObject({
      FLEEX_ITEM_ID: 'i1', FLEEX_ITEM_SOURCE: 'gmail', FLEEX_ITEM_KEY: '1a20cdcfb877b396', FLEEX_ITEM_TITLE: "Re: l'offre; rm -rf /", FLEEX_ITEM_AUTHOR: 'Ana <ana@acme.com>',
      FLEEX_ITEM_URL: '', FLEEX_ITEM_TAGS: 'finance,reason:mention', FLEEX_ITEM_MESSAGES: '2',
      FLEEX_ITEM_FIELD_LABELS: 'INBOX,IMPORTANT', FLEEX_ITEM_FIELD_ATTACHMENT: 'yes', FLEEX_ITEM_FIELD_X_THING: 'v',
    });
    expect(JSON.parse(env['FLEEX_ITEM_JSON']!)).toMatchObject({ key: '1a20cdcfb877b396', fields: { labels: ['INBOX', 'IMPORTANT'] } });
    /* exported, quoted: a subject cannot become a command */
    const { withEnv } = await import('../../src/factory/script-runner.js');
    expect(withEnv('gog gmail archive "$FLEEX_ITEM_KEY"', { FLEEX_ITEM_TITLE: env['FLEEX_ITEM_TITLE']! })).toContain("export FLEEX_ITEM_TITLE='Re: l'\\''offre; rm -rf /'");
  });
});
