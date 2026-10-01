import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { pinnedActionsRoutes } from '../../src/infrastructure/http/pinned-actions.routes.js';
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
