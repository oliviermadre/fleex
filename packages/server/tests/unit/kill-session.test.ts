import { describe, it, expect, beforeEach } from 'vitest';
import { KillSessionUseCase } from '../../src/application/use-cases/kill-session.js';
import { SessionEntity } from '../../src/domain/entities.js';
import { FakeTmuxPort, FakeSessionStore, FakeLoggerPort } from '../helpers/fakes.js';

describe('KillSessionUseCase', () => {
  let tmux: FakeTmuxPort;
  let store: FakeSessionStore;
  let logger: FakeLoggerPort;
  let useCase: KillSessionUseCase;

  beforeEach(() => {
    tmux = new FakeTmuxPort();
    store = new FakeSessionStore();
    logger = new FakeLoggerPort();
    useCase = new KillSessionUseCase(tmux, store, logger);
  });

  it('should kill a session and remove from store', async () => {
    const session = new SessionEntity(
      'test-id', 'fleex_shell_abc12345', 'shell', 'running',
      '/tmp/test', new Date(), null, null, null, null, null,
    );
    store.save(session);
    tmux.sessions.set('fleex_shell_abc12345', { cwd: '/tmp/test' });

    await useCase.execute('test-id');

    expect(store.getById('test-id')).toBeNull();
    expect(tmux.sessions.has('fleex_shell_abc12345')).toBe(false);
  });

  it('should throw if session not found', async () => {
    await expect(useCase.execute('nonexistent')).rejects.toThrow();
  });
});
