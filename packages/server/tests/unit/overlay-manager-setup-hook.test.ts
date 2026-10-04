import { describe, expect, it } from 'vitest';
import { OverlayManager } from '../../src/application/services/overlay-manager.js';
import { RepoPathResolver } from '../../src/domain/services/repo-path-resolver.js';
import type { ExecFn } from '../../src/infrastructure/host/types.js';
import { FakeConfigPort, FakeGitPort, FakeHostFs, FakeLoggerPort } from '../helpers/fakes.js';

const WS = '/base/workspaces/775c62-repo-actions';
const WT = `${WS}/fleex`;

function setup() {
  const calls: { cmd: string; args: string[]; cwd?: string }[] = [];
  const execFn: ExecFn = async (cmd, args, opts) => {
    calls.push({ cmd, args, cwd: opts?.cwd });
    return { stdout: '', stderr: '' };
  };
  const hostFs = new FakeHostFs();
  hostFs.writeFile(`${WS}/.fleex.json`, JSON.stringify({ ticketId: 'T-775' }));
  const config = new FakeConfigPort();
  const mgr = new OverlayManager(hostFs, new RepoPathResolver('/base'), execFn, config, new FakeLoggerPort(), new FakeGitPort());
  const settle = async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0)); };
  const inline = () => calls.find((c) => c.args.includes('-c'));
  return { mgr, hostFs, config, calls, settle, inline };
}

describe('Setup hook (formerly post-checkout)', () => {
  it('runs the personal Setup with the FLEEX_* environment and the {{…}} substitutions', async () => {
    // WHY (acceptance 7): scripts can rely on FLEEX_WORKTREE_PATH / FLEEX_BRANCH, and old {{branch}} scripts keep working.
    const { mgr, config, settle, inline } = setup();
    config.update({ worktreeConfigs: { 'o/fleex': { hooks: { setup: 'echo {{branch}}' } } } });
    expect(mgr.firePostCheckoutHooks('o', 'fleex', WT, 'feat/x')).toBe(true);
    await settle();
    const call = inline()!;
    expect(call.cmd).toBe('env');
    expect(call.cwd).toBe(WT);
    expect(call.args).toEqual(expect.arrayContaining([
      `FLEEX_WORKTREE_PATH=${WT}`, 'FLEEX_BRANCH=feat/x', 'FLEEX_REPO=o/fleex', 'FLEEX_TICKET_ID=T-775', `FLEEX_WORKSPACE_PATH=${WS}`,
    ]));
    expect(call.args.slice(-3)).toEqual(['bash', '-c', 'echo feat/x']);
  });

  it('an explicitly empty personal Setup disables it, even if the legacy field remains', async () => {
    const { mgr, config, settle, inline } = setup();
    config.update({ repoConfigs: { 'o/fleex': { postCheckoutHook: 'legacy' } }, worktreeConfigs: { 'o/fleex': { hooks: { setup: '' } } } });
    expect(mgr.firePostCheckoutHooks('o', 'fleex', WT, 'main')).toBe(false);
    await settle();
    expect(inline()).toBeUndefined();
  });

  it('falls back to the shared .fleex/worktree.json, then to the legacy field', async () => {
    const shared = setup();
    shared.config.update({ repoConfigs: { 'o/fleex': { postCheckoutHook: 'legacy' } } });
    shared.hostFs.writeFile(`${WT}/.fleex/worktree.json`, JSON.stringify({ hooks: { setup: 'pnpm install' } }));
    shared.mgr.firePostCheckoutHooks('o', 'fleex', WT, 'main');
    await shared.settle();
    expect(shared.inline()!.args.at(-1)).toBe('pnpm install');

    const legacy = setup();
    legacy.config.update({ repoConfigs: { 'o/fleex': { postCheckoutHook: 'legacy' } } });
    expect(legacy.mgr.firePostCheckoutHooks('o', 'fleex', WT, 'main')).toBe(true);
    await legacy.settle();
    expect(legacy.inline()!.args.at(-1)).toBe('legacy');
  });

  it('gives the environment to file hooks too', async () => {
    const { mgr, hostFs, calls, settle } = setup();
    hostFs.addDirEntries('/base/overlays/o/fleex/hooks', [{ name: '10-env.sh', isFile: true, isDirectory: false }]);
    mgr.firePostCheckoutHooks('o', 'fleex', WT, 'main');
    await settle();
    const file = calls.find((c) => c.args.at(-1) === '/base/overlays/o/fleex/hooks/10-env.sh')!;
    expect(file.cmd).toBe('env');
    expect(file.args).toContain('FLEEX_BRANCH=main');
  });

  it('runs global file hooks, then the repo ones, then the inline script — and reports the state', async () => {
    // WHY: the worktree menu shows "setup en cours / échoué", and a dependency install in a file hook
    // must be done before the inline script that relies on it.
    const { mgr, hostFs, config, calls, settle } = setup();
    const states: string[] = [];
    mgr.onSetupState = (snap) => states.push(snap.state + (snap.error ? `:${snap.error}` : ''));
    mgr.extraHookEnv = async () => ({ FLEEX_PORT: '41000' });
    hostFs.addDirEntries('/base/overlays/_global/hooks', [{ name: 'a.sh', isFile: true, isDirectory: false }]);
    hostFs.addDirEntries('/base/overlays/o/fleex/hooks', [{ name: 'b.sh', isFile: true, isDirectory: false }]);
    config.update({ worktreeConfigs: { 'o/fleex': { hooks: { setup: 'make' } } } });
    mgr.firePostCheckoutHooks('o', 'fleex', WT, 'main');
    await settle();
    expect(calls.map((c) => c.args.at(-1))).toEqual(['/base/overlays/_global/hooks/a.sh', '/base/overlays/o/fleex/hooks/b.sh', 'make']);
    expect(calls[0]!.args).toContain('FLEEX_PORT=41000');
    expect(states).toEqual(['running', 'ok']);
  });

  it('reports a failed setup, and still runs the inline script after a failing file hook', async () => {
    const calls: string[] = [];
    const hostFs = new FakeHostFs();
    const config = new FakeConfigPort();
    const mgr = new OverlayManager(hostFs, new RepoPathResolver('/base'), async (_c, args) => {
      calls.push(args.at(-1)!);
      if (args.at(-1)!.endsWith('b.sh')) throw Object.assign(new Error('x'), { stderr: 'npm ERR!' });
      return { stdout: '', stderr: '' };
    }, config, new FakeLoggerPort(), new FakeGitPort());
    const states: string[] = [];
    mgr.onSetupState = (snap) => states.push(snap.state);
    hostFs.addDirEntries('/base/overlays/o/fleex/hooks', [{ name: 'b.sh', isFile: true, isDirectory: false }]);
    config.update({ worktreeConfigs: { 'o/fleex': { hooks: { setup: 'make' } } } });
    mgr.firePostCheckoutHooks('o', 'fleex', WT, 'main');
    for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual(['/base/overlays/o/fleex/hooks/b.sh', 'make']);
    expect(states).toEqual(['running', 'failed']);
  });

  it('reports nothing when there is no hook at all', async () => {
    const { mgr, settle } = setup();
    const states: string[] = [];
    mgr.onSetupState = (snap) => states.push(snap.state);
    mgr.firePostCheckoutHooks('o', 'fleex', WT, 'main');
    await settle();
    expect(states).toEqual([]);
  });
});
