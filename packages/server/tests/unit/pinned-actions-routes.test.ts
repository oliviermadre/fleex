import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { pinnedActionsRoutes, SCRATCH_SHELL_COMMAND } from '../../src/infrastructure/http/pinned-actions.routes.js';
import { ActionRunService } from '../../src/domain/services/action-run.service.js';
import { PinnedStatusService } from '../../src/domain/services/pinned-status.service.js';

describe('pinned actions routes', () => {
  let app: FastifyInstance;
  let release: () => void;

  beforeEach(async () => {
    const actionRuns = new ActionRunService({
      // Pending until released, so the in-flight conflict can be observed.
      exec: () => new Promise((resolve) => { release = () => resolve({ stdout: 'ok', stderr: '', exitCode: 0 }); }),
      defaultCwd: '/home',
      broadcast: () => {},
    });
    const pinnedStatus = new PinnedStatusService({
      exec: async (command) => ({ stdout: command === 'warn' ? '{"status":"warn","badge":"42"}' : '', stderr: '', exitCode: command === 'false' ? 1 : 0 }),
      cwd: '/home',
      broadcast: () => {},
    });
    app = Fastify();
    await app.register(pinnedActionsRoutes({ actionRuns, pinnedStatus, logger: { info: () => {} } }));
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('answers 202 with a run id at once, then 409 pointing at the same run while it is still running', async () => {
    const body = { sourceId: 'gh', sourceKind: 'pinned', label: 'GitHub', command: 'gh auth login' };
    const first = await app.inject({ method: 'POST', url: '/api/action-runs', payload: body });
    expect(first.statusCode).toBe(202);
    const { runId } = first.json();
    expect(runId).toEqual(expect.any(String));

    const second = await app.inject({ method: 'POST', url: '/api/action-runs', payload: body });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({ runId });

    release();
    await new Promise((r) => setTimeout(r, 0));
    const runs = await app.inject({ method: 'GET', url: '/api/action-runs?sourceId=gh' });
    expect(runs.json()[0]).toMatchObject({ runId, exitCode: 0, stdout: 'ok' });
  });

  it('rejects a run without a command', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/action-runs', payload: { sourceId: 'x' } });
    expect(res.statusCode).toBe(400);
  });

  it('tests a probe without persisting it, returning the parsed state and raw output', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/pinned-status/test', payload: { command: 'warn' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ source: 'json', snapshot: { status: 'warn', badge: '42' }, exitCode: 0 });

    const snapshots = await app.inject({ method: 'GET', url: '/api/pinned-status' });
    expect(snapshots.json()).toEqual([]);
  });

  it('404s a refresh for an icon that has no probe', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/pinned-status/nope/refresh' });
    expect(res.statusCode).toBe(404);
  });
});

describe('pinned actions routes · lot 2', () => {
  it('cancels a running run (202) and 404s otherwise; exposes capabilities', async () => {
    let finish: () => void = () => {};
    const actionRuns = new ActionRunService({
      exec: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
      streamExec: async () => ({ done: new Promise((r) => { finish = () => r({ exitCode: 143, timedOut: false, cancelled: true }); }), cancel: async () => finish() }),
      defaultCwd: '/', broadcast: () => {},
    });
    const pinnedStatus = new PinnedStatusService({ exec: async () => ({ stdout: '', stderr: '', exitCode: 0 }), cwd: '/', broadcast: () => {} });
    const app = Fastify();
    await app.register(pinnedActionsRoutes({ actionRuns, pinnedStatus, logger: { info: () => {} }, actionRunCapabilities: async () => ({ liveOutput: true, terminal: true }) }));
    const { runId } = (await app.inject({ method: 'POST', url: '/api/action-runs', payload: { sourceId: 's', command: 'sleep 9' } })).json();
    await new Promise((r) => setTimeout(r, 0));
    expect((await app.inject({ method: 'POST', url: `/api/action-runs/${runId}/cancel` })).statusCode).toBe(202);
    await new Promise((r) => setTimeout(r, 0));
    expect((await app.inject({ method: 'POST', url: `/api/action-runs/${runId}/cancel` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/action-runs/capabilities' })).json()).toEqual({ liveOutput: true, terminal: true });
    await app.close();
  });
});

describe('POST /api/terminals/shell — a free shell for the Terminals panel', () => {
  async function setup(terminalAvailable: boolean) {
    const started: { command: string; cwd: string; maxMs?: number }[] = [];
    const actionRuns = new ActionRunService({
      exec: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
      defaultCwd: '/Users/me',
      broadcast: () => {},
      terminal: {
        sessionNameFor: (key) => `fxact_${key.replace(/[^A-Za-z0-9_-]/g, '_')}`,
        start: async (req) => {
          started.push({ command: req.command, cwd: req.cwd, ...(req.maxMs !== undefined ? { maxMs: req.maxMs } : {}) });
          return { done: new Promise(() => {}), cancel: async () => {} };
        },
        close: async () => {},
      },
    });
    const pinnedStatus = new PinnedStatusService({ exec: async () => ({ stdout: '', stderr: '', exitCode: 0 }), cwd: '/', broadcast: () => {} });
    const app = Fastify();
    await app.register(pinnedActionsRoutes({ actionRuns, pinnedStatus, logger: { info: () => {} }, actionRunCapabilities: async () => ({ liveOutput: true, terminal: terminalAvailable }) }));
    return { app, started };
  }

  it('starts an interactive zsh the server composes itself, in the home dir, with no 4 h safety net', async () => {
    const { app, started } = await setup(true);
    // A client-sent command is ignored: this route never runs anything but a shell.
    const res = await app.inject({ method: 'POST', url: '/api/terminals/shell', payload: { command: 'rm -rf /' } });
    expect(res.statusCode).toBe(202);
    const { runId, run } = res.json();
    expect(run).toMatchObject({ runId, sourceKind: 'scratch', label: 'Shell', command: SCRATCH_SHELL_COMMAND, mode: 'terminal', cwd: '/Users/me' });
    expect(run.sourceId).toMatch(/^scratch:[0-9a-f-]{36}$/);
    await new Promise((r) => setTimeout(r, 0));
    expect(started).toEqual([{ command: SCRATCH_SHELL_COMMAND, cwd: '/Users/me', maxMs: 0 }]);
    await app.close();
  });

  it('gives each shell its own source, so a second one never replaces the first', async () => {
    const { app } = await setup(true);
    const a = (await app.inject({ method: 'POST', url: '/api/terminals/shell', payload: {} })).json();
    const b = (await app.inject({ method: 'POST', url: '/api/terminals/shell', payload: { cwd: '/tmp' } })).json();
    expect(a.run.sourceId).not.toBe(b.run.sourceId);
    expect(b.run.cwd).toBe('/tmp');
    const runs = (await app.inject({ method: 'GET', url: '/api/action-runs' })).json();
    expect(runs.filter((r: { finishedAt?: string }) => !r.finishedAt)).toHaveLength(2);
    await app.close();
  });

  it('answers 501 when the terminal runner is unavailable, and starts nothing', async () => {
    const { app, started } = await setup(false);
    const res = await app.inject({ method: 'POST', url: '/api/terminals/shell', payload: {} });
    expect(res.statusCode).toBe(501);
    expect(res.json()).toEqual({ error: 'Terminal unavailable — restart the gateway' });
    expect(started).toEqual([]);
    await app.close();
  });

  it('keeps POST /api/action-runs from creating a scratch source: it falls back to pinned', async () => {
    const { app } = await setup(true);
    const res = await app.inject({ method: 'POST', url: '/api/action-runs', payload: { sourceId: 'x', sourceKind: 'scratch', command: 'ls' } });
    expect(res.json().run.sourceKind).toBe('pinned');
    await app.close();
  });
});
