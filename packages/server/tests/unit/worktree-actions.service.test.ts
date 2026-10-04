import { beforeEach, describe, expect, it } from 'vitest';
import { migrateLegacySetupHooks } from '../../src/application/services/worktree-actions.service.js';
import { FLEEX, FakeTmux, SECOND, WS, flush, setup } from '../helpers/worktree-actions-harness.js';

describe('WorktreeActionsService — reading', () => {
  it('lists one entry per worktree of the ticket, each with its own detected commands', async () => {
    // WHY (acceptance 1–2): a ticket with fleex + secondrepo shows two buttons, each menu
    // listing that repo's own commands with no config at all; composer event hooks are not commands.
    const { service } = setup();
    const views = await service.list(WS);
    expect(views.map((v) => v.repo)).toEqual(['oliviermadre/fleex', 'oliviermadre/secondrepo']);
    expect(views[0]!.items.map((i) => `${i.id} → ${i.command}`)).toEqual([
      'launch:web → pnpm dev', 'npm:dev → pnpm run dev', 'npm:test → pnpm run test', 'npm:lint → pnpm run lint',
    ]);
    expect(views[1]!.items.map((i) => i.id)).toEqual(['make:up', 'composer:serve']);
    expect(views[1]!.start).toBeNull();
    expect(views[1]!.server.state).toBe('stopped');
  });

  it('reads the shared .fleex/worktree.json under the personal layer', async () => {
    const { service, hostFs, config } = setup();
    hostFs.writeFile(`${SECOND}/.fleex/worktree.json`, JSON.stringify({ server: { start: 'make:up' }, actions: [{ id: 'migrate', cmd: 'make db-migrate' }] }));
    config.update({ worktreeConfigs: { 'oliviermadre/secondrepo': { actions: [{ id: 'migrate', cmd: 'make db-migrate FAST=1' }] } } });
    const view = await service.view(SECOND);
    expect(view.start).toEqual({ id: 'make:up', command: 'make up', label: 'up' });
    expect(view.items.find((i) => i.id === 'migrate')).toMatchObject({ layer: 'personal', command: 'make db-migrate FAST=1' });
  });

  it('reports a broken shared file instead of silently ignoring it', async () => {
    const { service, hostFs } = setup();
    hostFs.writeFile(`${SECOND}/.fleex/worktree.json`, '{ nope');
    const view = await service.view(SECOND);
    expect(view.sharedConfigError).toMatch(/\.fleex\/worktree\.json/);
    expect(view.items.map((i) => i.id)).toEqual(['make:up', 'composer:serve']);
  });
});

describe('WorktreeActionsService — server lifecycle', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
    ctx.config.update({ worktreeConfigs: { 'oliviermadre/fleex': { server: { start: 'launch:web' } } } });
  });

  it('start → starting → running on the detected port → open → stop', async () => {
    // WHY (acceptance 5): the left click must follow the server's real state, not the click.
    const { service, tmux, startSession } = ctx;
    const started = await service.run(FLEEX, { verb: 'start' });
    expect(started.server.state).toBe('starting');
    expect(tmux.started[0]).toMatchObject({ cwd: FLEEX, maxMs: 0 }); // a dev server has no timeout
    expect(tmux.started[0]!.command).toContain("FLEEX_TICKET_ID='T-775'");
    expect(tmux.started[0]!.command).toContain("FLEEX_PORT='5173'");
    expect(tmux.started[0]!.command.endsWith('; pnpm dev')).toBe(true);

    await expect(service.run(FLEEX, { verb: 'open' })).rejects.toThrow(/starting/);

    tmux.sessions.get(startSession(FLEEX))!.ports = [5173, 24678];
    await service.tickForTest();
    expect((await service.view(FLEEX)).server.state).toBe('starting'); // not due yet
    ctx.clock.ms += 2_000;
    await service.tickForTest();
    const running = (await service.view(FLEEX)).server;
    expect(running).toMatchObject({ state: 'running', port: 5173, url: 'http://localhost:5173' });
    expect((await service.run(FLEEX, { verb: 'open' })).url).toBe('http://localhost:5173');

    const second = await service.run(FLEEX, { verb: 'start' });
    expect(second.alreadyRunning).toBe(true);

    const stopped = await service.run(FLEEX, { verb: 'stop' });
    expect(stopped.server.state).toBe('stopped');
    expect(tmux.sessions.has(startSession(FLEEX))).toBe(false);
  });

  it('turns to error when the start command dies with a non-zero code, and logs points at that run', async () => {
    // WHY (acceptance 6): a crashed server must be red, with its output one click away.
    const { service, tmux, startSession, broadcasts } = ctx;
    const { runId } = await service.run(FLEEX, { verb: 'start' });
    tmux.exit(startSession(FLEEX), 1);
    await flush();
    await flush();
    const view = await service.view(FLEEX);
    expect(view.server).toMatchObject({ state: 'error', exitCode: 1 });
    expect(broadcasts.at(-1)?.state).toBe('error');
    expect((await service.run(FLEEX, { verb: 'logs' })).runId).toBe(runId);
  });

  it('a start command that ends with exit 0 just means stopped', async () => {
    const { service, tmux, startSession } = ctx;
    await service.run(FLEEX, { verb: 'start' });
    tmux.exit(startSession(FLEEX), 0);
    await flush();
    await flush();
    expect((await service.view(FLEEX)).server.state).toBe('stopped');
  });

  it('a launch.json configuration run from the menu starts the server', async () => {
    const { service } = ctx;
    const res = await service.run(FLEEX, { id: 'launch:web' });
    expect(res.server.state).toBe('starting');
  });

  it('refuses to start a worktree with nothing to start', async () => {
    const { service } = ctx;
    await expect(service.run(SECOND, { verb: 'start' })).rejects.toThrow(/No start command/);
  });

  it('adopts a server left running by a previous Fleex run', async () => {
    // WHY: dev servers survive a Fleex restart (their tmux session is spared), so the
    // button must come back green instead of offering to start a second one.
    const tmux = new FakeTmux();
    const first = setup({ tmux });
    first.config.update({ worktreeConfigs: { 'oliviermadre/fleex': { server: { start: 'launch:web' } } } });
    await first.service.run(FLEEX, { verb: 'start' });
    tmux.sessions.get(first.startSession(FLEEX))!.ports = [5173];

    const restarted = setup({ tmux, config: first.config });
    const view = await restarted.service.view(FLEEX);
    expect(view.server).toMatchObject({ state: 'running', port: 5173 });
    const stopped = await restarted.service.run(FLEEX, { verb: 'stop' });
    expect(stopped.server.state).toBe('stopped');
    expect(tmux.sessions.size).toBe(0);
  });
});

describe('WorktreeActionsService — commands and pins', () => {
  it('runs a detected command in its own terminal slot with the FLEEX_* env', async () => {
    const { service, tmux } = setup();
    const res = await service.run(FLEEX, { id: 'npm:test' });
    expect(res.runId).toBeTruthy();
    expect(res.run).toMatchObject({ sourceKind: 'worktree', slot: 'npm:test', label: 'fleex · test', mode: 'terminal' });
    expect(tmux.started[0]!.command).toMatch(/FLEEX_BRANCH='ticket\/775c62-repo-actions'.*; pnpm run test$/);
    expect(tmux.started[0]!.maxMs).toBeUndefined();
    await expect(service.run(FLEEX, { id: 'npm:nope' })).rejects.toThrow(/No command/);
  });

  it('keeps a pin in the personal layer, so it survives a reload', async () => {
    // WHY (acceptance 4): ★ is personal by default and must persist server-side.
    const { service, config } = setup();
    const view = await service.setPinned(FLEEX, 'npm:lint', true);
    expect(view.items.find((i) => i.id === 'npm:lint')?.pinned).toBe(true);
    expect(config.get().worktreeConfigs?.['oliviermadre/fleex']?.pins).toEqual(['npm:lint']);
    await service.setPinned(FLEEX, 'npm:lint', false);
    expect(config.get().worktreeConfigs?.['oliviermadre/fleex']?.pins).toEqual([]);
  });
});

describe('migrateLegacySetupHooks', () => {
  it('copies a post-checkout hook into the personal Setup once, never over an existing one', () => {
    // WHY (acceptance 7): an existing hook must keep running after the rename.
    expect(migrateLegacySetupHooks({
      repoConfigs: { 'o/a': { postCheckoutHook: 'bun install' }, 'o/b': { postCheckoutHook: 'make' }, 'o/c': { postCheckoutHook: '  ' } },
      worktreeConfigs: { 'o/b': { hooks: { setup: '' } } },
    })).toEqual({ 'o/a': { hooks: { setup: 'bun install' } }, 'o/b': { hooks: { setup: '' } } });
    expect(migrateLegacySetupHooks({ repoConfigs: {}, worktreeConfigs: {} })).toBeNull();
  });
});
