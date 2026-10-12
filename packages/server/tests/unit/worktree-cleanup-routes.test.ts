/**
 * HTTP contract of the cleanup: bad criteria are a 400 (never a silent
 * default), a concurrent apply is a 409 the CLI turns into exit code 3, and
 * apply only ever receives criteria — the server recomputes the plan.
 */
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { worktreeCleanupRoutes } from '../../src/infrastructure/http/worktree-cleanup.routes.js';
import { CleanupInProgressError, CleanupRequestError, type WorktreeCleanupUseCase } from '../../src/application/use-cases/worktree-cleanup.js';
import { parseLsofCwds } from '../../src/infrastructure/adapters/workspace-activity-probe.adapter.js';

async function app(uc: Partial<WorktreeCleanupUseCase>) {
  const a = Fastify();
  await a.register(worktreeCleanupRoutes({ worktreeCleanup: uc as WorktreeCleanupUseCase }));
  return a;
}

describe('worktree cleanup routes', () => {
  it('passes parsed criteria to the plan, sizes on by default', async () => {
    const plan = vi.fn(async () => ({ ok: true }));
    const res = await (await app({ plan } as never)).inject({ method: 'GET', url: '/api/worktree-cleanup/plan?olderThan=36h&status=done' });
    expect(res.statusCode).toBe(200);
    expect(plan).toHaveBeenCalledWith({ olderThan: '36h', statuses: ['done'], ticket: null, size: true });
  });

  it('refuses an active status with a 400', async () => {
    const plan = vi.fn();
    const res = await (await app({ plan } as never)).inject({ method: 'GET', url: '/api/worktree-cleanup/plan?status=doing' });
    expect(res.statusCode).toBe(400);
    expect(plan).not.toHaveBeenCalled();
  });

  it('maps a bad duration / unknown ticket to 400 and a concurrent apply to 409', async () => {
    const plan = vi.fn(async () => { throw new CleanupRequestError('Ticket not found: #9'); });
    const apply = vi.fn(async () => { throw new CleanupInProgressError(); });
    const a = await app({ plan, apply } as never);
    expect((await a.inject({ method: 'GET', url: '/api/worktree-cleanup/plan?ticket=9' })).statusCode).toBe(400);
    const res = await a.inject({ method: 'POST', url: '/api/worktree-cleanup/apply', payload: { size: false } });
    expect(res.statusCode).toBe(409);
    expect(apply.mock.calls[0]![0]).toEqual({ olderThan: '14d', statuses: ['done', 'cancelled'], ticket: null, size: false });
  });
});

describe('lsof cwd parsing', () => {
  it('reads pid / command / cwd triples from `lsof -F pcn`', () => {
    expect(parseLsofCwds('p159\ncMTLCompilerService\nfcwd\nn/\np4242\ncnode\nfcwd\nn/Users/me/projects/workspaces/a/app\n'))
      .toEqual([{ pid: 159, command: 'MTLCompilerService', cwd: '/' }, { pid: 4242, command: 'node', cwd: '/Users/me/projects/workspaces/a/app' }]);
  });
});
