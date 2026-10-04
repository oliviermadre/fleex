import { describe, expect, it } from 'vitest';
import { sanitizeKeyValue, PORT_RANGE_BASE, PORT_RANGE_SLOT } from '../../src/application/services/worktree-actions.service.js';
import { FLEEX, FakeTmux, SECOND, flush, setup } from '../helpers/worktree-actions-harness.js';

const overlay = {
  listOverlayFilesRecursive: async () => ['.env', 'apps/web/.env'],
  listHookScripts: async (dir: string) => (dir.endsWith('_global/hooks') ? ['/base/overlays/_global/hooks/00-env.sh'] : ['/base/overlays/oliviermadre/fleex/hooks/10-deps.sh']),
  ensureOverlayDirs: async () => {},
};

const sharedFile = `${FLEEX}/.fleex/worktree.json`;

describe('settings and layers', () => {
  it('reads both layers raw, the overlay files and the file hooks in run order', async () => {
    const { service, hostFs, config } = setup({ overlay });
    config.update({ worktreeConfigs: { 'oliviermadre/fleex': { hooks: { setup: 'pnpm i' } } } });
    hostFs.writeFile(sharedFile, JSON.stringify({ server: { start: 'launch:web' } }));
    const s = await service.settings('oliviermadre/fleex', FLEEX);
    expect(s.personal).toEqual({ hooks: { setup: 'pnpm i' } });
    expect(s.shared).toEqual({ server: { start: 'launch:web' } });
    expect(s.view?.start?.id).toBe('launch:web');
    expect(s.overlayFiles).toEqual(['.env', 'apps/web/.env']);
    expect(s.fileHooks).toEqual({ global: ['/base/overlays/_global/hooks/00-env.sh'], repo: ['/base/overlays/oliviermadre/fleex/hooks/10-deps.sh'] });
    expect(s.hookTimeoutSeconds).toBe(60);
  });

  it('writes the shared layer as stable, reviewable JSON (version first), never touching launch.json', async () => {
    // WHY (acceptance 10): Fleex writes .fleex/worktree.json for the team to commit, and nothing else.
    const { service, hostFs } = setup({ overlay });
    const launchBefore = await hostFs.readFile(`${FLEEX}/.claude/launch.json`);
    await service.setKey('oliviermadre/fleex', FLEEX, 'shared', 'server.start', 'launch:web');
    await service.setKey('oliviermadre/fleex', FLEEX, 'shared', 'action:migrate', { cmd: 'make db-migrate', mode: 'background' });
    expect(hostFs.createdDirs.has(`${FLEEX}/.fleex`)).toBe(true);
    expect(await hostFs.readFile(sharedFile)).toBe(`{
  "version": 1,
  "server": {
    "start": "launch:web"
  },
  "actions": [
    {
      "cmd": "make db-migrate",
      "mode": "background",
      "id": "migrate"
    }
  ]
}
`);
    expect(await hostFs.readFile(`${FLEEX}/.claude/launch.json`)).toBe(launchBefore);
  });

  it('refuses to overwrite a shared file it cannot parse', async () => {
    const { service, hostFs } = setup({ overlay });
    hostFs.writeFile(sharedFile, '{ broken');
    await expect(service.setKey('oliviermadre/fleex', FLEEX, 'shared', 'server.start', 'x')).rejects.toThrow(/fix the file first/);
    expect(await hostFs.readFile(sharedFile)).toBe('{ broken');
  });

  it('refuses a worktree of another repo, and junk values', async () => {
    const { service } = setup({ overlay });
    await expect(service.setKey('oliviermadre/fleex', SECOND, 'shared', 'server.start', 'x')).rejects.toThrow(/not a worktree of/);
    await expect(service.setKey('oliviermadre/fleex', FLEEX, 'personal', 'server.__proto__', 'x')).rejects.toThrow(/Unknown config key/);
    expect(() => sanitizeKeyValue('action:x', { cmd: 'ls', when: ['nope'] })).toThrow(/when/);
    expect(sanitizeKeyValue('ports', { reserve: true, count: 99 })).toEqual({ reserve: true, count: 20 });
    expect(sanitizeKeyValue('server.start', '   ')).toBeUndefined();
  });
});

describe('Partager / Garder pour moi', () => {
  it('Partager moves a personal action into the file and out of the personal layer', async () => {
    // WHY (acceptance 9): sharing must not leave a personal copy that silently masks the team's.
    const { service, hostFs, config } = setup({ overlay });
    config.update({ worktreeConfigs: { 'oliviermadre/fleex': { actions: [{ id: 'lint', cmd: 'pnpm lint' }], pins: ['npm:dev'] } } });
    const res = await service.share(FLEEX, ['action:lint']);
    expect(res.moved).toEqual(['action:lint']);
    expect(res.file).toBe(sharedFile);
    expect(JSON.parse(await hostFs.readFile(sharedFile))).toEqual({ version: 1, actions: [{ id: 'lint', cmd: 'pnpm lint' }] });
    expect(config.get().worktreeConfigs?.['oliviermadre/fleex']).toEqual({ pins: ['npm:dev'] });
    expect(res.settings.view?.items.find((i) => i.id === 'lint')?.layer).toBe('shared');
  });

  it('Garder pour moi copies into the personal layer; the file keeps it unless asked to remove it', async () => {
    const { service, hostFs, config } = setup({ overlay });
    hostFs.writeFile(sharedFile, JSON.stringify({ version: 1, hooks: { setup: 'make deps' }, server: { start: 'launch:web' } }));
    await service.unshare(FLEEX, ['hooks.setup'], false);
    expect(config.get().worktreeConfigs?.['oliviermadre/fleex']).toEqual({ hooks: { setup: 'make deps' } });
    expect(JSON.parse(await hostFs.readFile(sharedFile)).hooks).toEqual({ setup: 'make deps' });
    await service.unshare(FLEEX, ['server.start'], true);
    expect(JSON.parse(await hostFs.readFile(sharedFile))).toEqual({ version: 1, hooks: { setup: 'make deps' } });
  });

  it('says so when there is nothing to move', async () => {
    const { service } = setup({ overlay });
    await expect(service.share(FLEEX, ['server.start'])).rejects.toThrow(/Nothing personal/);
  });
});

describe('hooks on demand and teardown', () => {
  it('Relancer le Setup runs file hooks then the inline script, with FLEEX_* and {{…}}, and tracks its state', async () => {
    const { service, config, execCalls, broadcasts } = setup({ overlay });
    config.update({ worktreeConfigs: { 'oliviermadre/fleex': { hooks: { setup: 'echo {{branch}}' } } } });
    const res = await service.runHook(FLEEX, 'setup');
    await flush();
    const cmd = execCalls.at(-1)!.command;
    expect(cmd).toContain("FLEEX_BRANCH='ticket/775c62-repo-actions'");
    expect(cmd.indexOf('00-env.sh')).toBeLessThan(cmd.indexOf('10-deps.sh'));
    expect(cmd.trim().endsWith('echo ticket/775c62-repo-actions')).toBe(true);
    expect(res.setup?.state).toBe('running');
    await flush();
    expect((await service.view(FLEEX)).setup).toMatchObject({ state: 'ok', runId: res.runId });
    expect(broadcasts.filter((b) => 'state' in b && (b.state === 'ok' || b.state === 'running'))).not.toHaveLength(0);
  });

  it('Tester runs the draft command only, not the file hooks', async () => {
    const { service, execCalls } = setup({ overlay });
    await service.runHook(FLEEX, 'teardown', 'docker compose down -v');
    await flush();
    const cmd = execCalls.at(-1)!.command;
    expect(cmd).not.toContain('.sh');
    expect(cmd.endsWith('docker compose down -v')).toBe(true);
  });

  it('a failed Setup re-run is reported failed with its error output', async () => {
    const { service, config } = setup({ overlay, exec: async () => ({ stdout: '', stderr: 'pnpm: not found', exitCode: 127 }) });
    config.update({ worktreeConfigs: { 'oliviermadre/fleex': { hooks: { setup: 'pnpm i' } } } });
    await service.runHook(FLEEX, 'setup');
    await flush();
    await flush();
    expect((await service.view(FLEEX)).setup).toMatchObject({ state: 'failed', error: 'pnpm: not found' });
  });

  it('teardown stops the server, runs the hook, and never blocks the removal even when it fails', async () => {
    // WHY (acceptance 8): a broken teardown must not leave a worktree that cannot be deleted.
    const { service, config, tmux, startSession, execCalls } = setup({ overlay, exec: async () => ({ stdout: '', stderr: 'boom', exitCode: 1 }) });
    config.update({ worktreeConfigs: { 'oliviermadre/fleex': { server: { start: 'launch:web' }, hooks: { teardown: 'docker compose down -v' } } } });
    await service.run(FLEEX, { verb: 'start' });
    await expect(service.teardown(FLEEX)).resolves.toBeUndefined();
    expect(tmux.sessions.has(startSession(FLEEX))).toBe(false);
    expect(execCalls.some((c) => c.command.endsWith('docker compose down -v'))).toBe(true);
  });

  it('teardown stops a server adopted from before a Fleex restart', async () => {
    // WHY: after a restart the server is only in tmux; deleting the ticket without
    // opening its view must still stop it, or it runs forever in a deleted folder.
    const tmux = new FakeTmux();
    const first = setup({ tmux, overlay });
    first.config.update({ worktreeConfigs: { 'oliviermadre/fleex': { server: { start: 'launch:web' } } } });
    await first.service.run(FLEEX, { verb: 'start' });
    const session = first.startSession(FLEEX);
    expect(tmux.sessions.has(session)).toBe(true);

    const restarted = setup({ tmux, config: first.config, overlay });
    await restarted.service.teardown(FLEEX);
    expect(tmux.sessions.has(session)).toBe(false);
  });

  it('teardown waits for the hook as long as the repo hook timeout allows', async () => {
    // WHY: the hook runs with hookTimeoutSeconds; waiting only the 60 s default cut a 300 s teardown short.
    const ctx = setup({ overlay, advanceClockOnSleep: true, exec: () => new Promise(() => {}) });
    ctx.config.update({
      repoConfigs: { 'oliviermadre/fleex': { hookTimeoutSeconds: 300 } },
      worktreeConfigs: { 'oliviermadre/fleex': { hooks: { teardown: 'slow-down' } } },
    });
    const before = ctx.clock.ms;
    await ctx.service.teardown(FLEEX);
    expect(ctx.clock.ms - before).toBeGreaterThanOrEqual(300_000);
  });

  it('teardown without a hook is a no-op that still forgets the worktree', async () => {
    const { service, execCalls } = setup({ overlay });
    await service.teardown(SECOND);
    expect(execCalls).toHaveLength(0);
  });
});

describe('port reservation', () => {
  it('gives each worktree its own stable range, PORT for autoPort configs, and frees it at teardown', async () => {
    // WHY (acceptance 13): two worktrees of one repo must never start on the same port.
    const { service, config, hostFs, tmux } = setup({ overlay });
    config.update({ worktreeConfigs: { 'oliviermadre/fleex': { ports: { reserve: true, count: 5 }, server: { start: 'launch:web' } }, 'oliviermadre/secondrepo': { ports: { reserve: true } } } });
    hostFs.writeFile(`${FLEEX}/.claude/launch.json`, JSON.stringify({ configurations: [{ name: 'web', runtimeExecutable: 'pnpm', runtimeArgs: ['dev'], autoPort: true }] }));
    const a = await service.view(FLEEX);
    const b = await service.view(SECOND);
    expect(a.reservedPort).toBe(PORT_RANGE_BASE);
    expect(b.reservedPort).toBe(PORT_RANGE_BASE + PORT_RANGE_SLOT);
    expect((await service.view(FLEEX)).reservedPort).toBe(PORT_RANGE_BASE); // stable
    await service.run(FLEEX, { verb: 'start' });
    const cmd = tmux.started.at(-1)!.command;
    expect(cmd).toContain(`FLEEX_PORT='${PORT_RANGE_BASE}'`);
    expect(cmd).toContain("FLEEX_PORT_COUNT='5'");
    expect(cmd).toContain(`PORT='${PORT_RANGE_BASE}'`);
    await service.teardown(FLEEX);
    expect(config.get().worktreePorts).toEqual({ [SECOND]: PORT_RANGE_BASE + PORT_RANGE_SLOT });
  });

  it('passes no reserved port when reservation is off', async () => {
    const { service, config, tmux } = setup({ overlay });
    config.update({ worktreeConfigs: { 'oliviermadre/fleex': { server: { start: 'make serve' } } } });
    await service.run(FLEEX, { verb: 'start' });
    expect(tmux.started.at(-1)!.command).not.toContain('FLEEX_PORT');
    expect(config.get().worktreePorts).toBeUndefined();
  });
});
