import { describe, it, expect, beforeEach } from 'vitest';
import { ListSessionsUseCase } from '../../src/application/use-cases/list-sessions.js';
import { SessionEntity } from '../../src/domain/entities.js';
import { FakeTmuxPort, FakeSessionStore, FakeLoggerPort } from '../helpers/fakes.js';

describe('ListSessionsUseCase', () => {
  let tmux: FakeTmuxPort;
  let store: FakeSessionStore;
  let logger: FakeLoggerPort;
  let useCase: ListSessionsUseCase;

  beforeEach(() => {
    tmux = new FakeTmuxPort();
    store = new FakeSessionStore();
    logger = new FakeLoggerPort();
    useCase = new ListSessionsUseCase(store, tmux, logger);
  });

  it('should return alive sessions and mark dead ones as pending_reconciliation', async () => {
    const alive = new SessionEntity(
      'alive-id', 'asm_shell_alive123', 'shell', 'running',
      '/tmp/a', new Date(), null, null, null, null, null,
    );
    const dead = new SessionEntity(
      'dead-id', 'asm_shell_dead1234', 'shell', 'running',
      '/tmp/b', new Date(), null, null, null, null, null,
    );
    await store.save(alive);
    await store.save(dead);

    // Only the alive session exists in tmux
    tmux.sessions.set('asm_shell_alive123', { cwd: '/tmp/a' });

    const result = await useCase.execute();

    // All sessions returned (alive + pending)
    expect(result).toHaveLength(2);
    const aliveResult = result.find((s) => s.id === 'alive-id');
    const deadResult = result.find((s) => s.id === 'dead-id');
    expect(aliveResult!.status).toBe('running');
    expect(deadResult!.status).toBe('pending_reconciliation');
    // Session is still in store, just marked
    expect(await store.getById('dead-id')).not.toBeNull();
  });

  it('should return all stored sessions when tmux listing fails', async () => {
    const session1 = new SessionEntity(
      'id-1', 'asm_shell_abc12345', 'shell', 'running',
      '/tmp/a', new Date(), null, 'myorg', 'myrepo', 'main', 'https://github.com/myorg/myrepo.git',
    );
    const session2 = new SessionEntity(
      'id-2', 'asm_claude_def1234', 'claude', 'running',
      '/tmp/b', new Date(), null, 'myorg', 'other', 'feat', 'https://github.com/myorg/other.git',
    );
    await store.save(session1);
    await store.save(session2);

    // Simulate a network/gateway error
    tmux.listSessionsError = new Error('connect ECONNREFUSED 192.168.1.100:9876');

    const result = await useCase.execute();

    // Should return all sessions untouched — no cleanup
    expect(result).toHaveLength(2);
    expect(result.map((s) => s.id).sort()).toEqual(['id-1', 'id-2']);

    // Sessions should still be in the store
    expect(await store.getById('id-1')).not.toBeNull();
    expect(await store.getById('id-2')).not.toBeNull();

    // Should have logged a warning
    expect(logger.logs.some((l) => l.level === 'warn' && l.msg.includes('Failed to list tmux sessions'))).toBe(true);
  });

  it('should mark all sessions as pending when tmux genuinely has none', async () => {
    const session = new SessionEntity(
      'id-1', 'asm_shell_abc12345', 'shell', 'running',
      '/tmp/a', new Date(), null, null, null, null, null,
    );
    await store.save(session);

    // tmux has no sessions (empty map) — no error, just empty
    const result = await useCase.execute();

    expect(result).toHaveLength(1);
    expect(result[0]!.status).toBe('pending_reconciliation');
    // Session still in store
    expect(await store.getById('id-1')).not.toBeNull();
  });
});
