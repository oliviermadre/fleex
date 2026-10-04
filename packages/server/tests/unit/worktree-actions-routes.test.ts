import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { worktreeActionsRoutes } from '../../src/infrastructure/http/worktree-actions.routes.js';
import { configRoutes } from '../../src/infrastructure/http/config.routes.js';
import { WorktreeActionError, type WorktreeActionsService } from '../../src/application/services/worktree-actions.service.js';
import type { Container } from '../../src/infrastructure/container.js';

async function appWith(service: Partial<WorktreeActionsService>) {
  const app = Fastify();
  await app.register(worktreeActionsRoutes({
    worktreeActions: service as WorktreeActionsService,
    resolver: { isManagedPath: (p: string) => p.startsWith('/base/') },
  }));
  return app;
}

describe('worktree actions routes', () => {
  it('never touches a path outside the managed base', async () => {
    // WHY: the path comes from the client and is used as a cwd for shell commands.
    const run = vi.fn();
    const app = await appWith({ run, list: vi.fn() });
    const res = await app.inject({ method: 'POST', url: '/api/worktree-actions/run', payload: { path: '/etc', verb: 'start' } });
    expect(res.statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/worktree-actions?path=/tmp/x' })).statusCode).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });

  it('maps refusals to their status and a fresh run to 202', async () => {
    const app = await appWith({
      run: vi.fn(async (_p: string, t: { verb?: string }) => {
        if (t.verb === 'open') throw new WorktreeActionError(409, 'The server is stopped');
        return { runId: 'r1', server: { path: '/base/w', state: 'starting' as const, updatedAt: '' } };
      }),
    });
    const open = await app.inject({ method: 'POST', url: '/api/worktree-actions/run', payload: { path: '/base/w', verb: 'open' } });
    expect(open.statusCode).toBe(409);
    expect(open.json()).toEqual({ error: 'The server is stopped' });
    const start = await app.inject({ method: 'POST', url: '/api/worktree-actions/run', payload: { path: '/base/w', verb: 'start' } });
    expect(start.statusCode).toBe(202);
  });
});

describe('settings routes', () => {
  it('validates the layer, the repo and the path before writing', async () => {
    const setKey = vi.fn(async () => ({ repo: 'o/r' }));
    const app = await appWith({ setKey } as Partial<WorktreeActionsService>);
    const bad = await app.inject({ method: 'POST', url: '/api/worktree-actions/config', payload: { repo: 'o/r', layer: 'team', key: 'server.start', value: 'x' } });
    expect(bad.statusCode).toBe(400);
    const outside = await app.inject({ method: 'POST', url: '/api/worktree-actions/config', payload: { repo: 'o/r', path: '/etc', layer: 'shared', key: 'server.start', value: 'x' } });
    expect(outside.statusCode).toBe(400);
    const ok = await app.inject({ method: 'POST', url: '/api/worktree-actions/config', payload: { repo: 'o/r', path: '/base/w', layer: 'shared', key: 'server.start', value: 'x' } });
    expect(ok.statusCode).toBe(200);
    expect(setKey).toHaveBeenCalledWith('o/r', '/base/w', 'shared', 'server.start', 'x');
    // null removes the key
    await app.inject({ method: 'POST', url: '/api/worktree-actions/config', payload: { repo: 'o/r', layer: 'personal', key: 'server.start', value: null } });
    expect(setKey).toHaveBeenLastCalledWith('o/r', null, 'personal', 'server.start', undefined);
  });

  it('share / unshare / hooks/run need keys or a known hook', async () => {
    const share = vi.fn(async () => ({}));
    const runHook = vi.fn(async () => ({ runId: 'r', server: { path: '/base/w', state: 'stopped' as const, updatedAt: '' } }));
    const app = await appWith({ share, runHook } as Partial<WorktreeActionsService>);
    expect((await app.inject({ method: 'POST', url: '/api/worktree-actions/share', payload: { path: '/base/w', keys: [] } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/worktree-actions/share', payload: { path: '/base/w', keys: ['action:x'] } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/worktree-actions/hooks/run', payload: { path: '/base/w', hook: 'rm' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/worktree-actions/hooks/run', payload: { path: '/base/w', hook: 'setup' } })).statusCode).toBe(202);
  });
});

describe('PUT /api/config and the personal worktree layer', () => {
  it('ignores worktreeConfigs: the web PUTs a stale copy of the whole config', async () => {
    // WHY: a pin made from the CLI must survive the web saving any unrelated setting.
    let stored: Record<string, unknown> = { worktreeConfigs: { 'o/r': { pins: ['npm:dev'] } }, worktreePorts: { '/w': 41000 } };
    const container = {
      config: { get: () => stored, update: vi.fn(async (patch: Record<string, unknown>) => { stored = { ...stored, ...patch }; }) },
      pinnedStatus: { configure: vi.fn() },
    } as unknown as Container;
    const app = Fastify();
    await app.register(configRoutes(container));
    await app.inject({ method: 'PUT', url: '/api/config', payload: { humanDisplayName: 'Nas', worktreeConfigs: {}, worktreePorts: {} } });
    expect(stored['worktreePorts']).toEqual({ '/w': 41000 });
    expect(stored['worktreeConfigs']).toEqual({ 'o/r': { pins: ['npm:dev'] } });
    expect(stored['humanDisplayName']).toBe('Nas');
  });
});
