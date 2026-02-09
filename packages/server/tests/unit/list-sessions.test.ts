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

  it('should return alive sessions and remove dead ones', async () => {
    const alive = new SessionEntity(
      'alive-id', 'asm_shell_alive123', 'shell', 'running',
      '/tmp/a', new Date(), null, null, null, null, null,
    );
    const dead = new SessionEntity(
      'dead-id', 'asm_shell_dead1234', 'shell', 'running',
      '/tmp/b', new Date(), null, null, null, null, null,
    );
    store.save(alive);
    store.save(dead);

    // Only the alive session exists in tmux
    tmux.sessions.set('asm_shell_alive123', { cwd: '/tmp/a' });

    const result = await useCase.execute();

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('alive-id');
    expect(store.getById('dead-id')).toBeNull();
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
    store.save(session1);
    store.save(session2);

    // Simulate a network/gateway error
    tmux.listSessionsError = new Error('connect ECONNREFUSED 192.168.1.100:9876');

    const result = await useCase.execute();

    // Should return all sessions untouched — no cleanup
    expect(result).toHaveLength(2);
    expect(result.map((s) => s.id).sort()).toEqual(['id-1', 'id-2']);

    // Sessions should still be in the store
    expect(store.getById('id-1')).not.toBeNull();
    expect(store.getById('id-2')).not.toBeNull();

    // Should have logged a warning
    expect(logger.logs.some((l) => l.level === 'warn' && l.msg.includes('Failed to list tmux sessions'))).toBe(true);
  });

  it('should remove all sessions when tmux genuinely has none', async () => {
    const session = new SessionEntity(
      'id-1', 'asm_shell_abc12345', 'shell', 'running',
      '/tmp/a', new Date(), null, null, null, null, null,
    );
    store.save(session);

    // tmux has no sessions (empty map) — no error, just empty
    const result = await useCase.execute();

    expect(result).toHaveLength(0);
    expect(store.getById('id-1')).toBeNull();
  });
});
