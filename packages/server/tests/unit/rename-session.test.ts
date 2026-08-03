import { describe, it, expect, beforeEach } from 'vitest';

import { RenameSessionUseCase } from '../../src/application/use-cases/rename-session.js';
import { SessionEntity } from '../../src/domain/entities.js';
import { SessionNotFoundError } from '../../src/domain/errors.js';
import { SessionNamingService } from '../../src/domain/services/session-naming.js';
import { FakeTmuxPort, FakeSessionStore, FakeLoggerPort } from '../helpers/fakes.js';

describe('RenameSessionUseCase', () => {
  let tmux: FakeTmuxPort;
  let store: FakeSessionStore;
  let logger: FakeLoggerPort;
  let useCase: RenameSessionUseCase;

  beforeEach(() => {
    tmux = new FakeTmuxPort();
    store = new FakeSessionStore();
    logger = new FakeLoggerPort();
    useCase = new RenameSessionUseCase(tmux, store, new SessionNamingService(), logger);
  });

  function createSession(
    overrides: Partial<{
      id: string;
      tmuxName: string;
      type: 'shell' | 'claude';
      org: string | null;
      repo: string | null;
      worktree: string | null;
      displayName: string;
    }> = {},
  ) {
    const session = new SessionEntity(
      overrides.id ?? 'sess-1',
      overrides.tmuxName ?? 'fleex_claude_org_repo_main_claude',
      overrides.type ?? 'claude',
      'running',
      '/tmp/project',
      new Date(),
      null,
      'org' in overrides ? overrides.org! : 'org',
      'repo' in overrides ? overrides.repo! : 'repo',
      'worktree' in overrides ? overrides.worktree! : 'main',
      null,
      undefined,
      overrides.displayName ?? 'Claude',
    );
    store.save(session);
    tmux.sessions.set(session.tmuxName, { cwd: '/tmp/project' });
    return session;
  }

  it('should rename a session', async () => {
    createSession();

    await useCase.execute('sess-1', 'my-agent');

    const updated = store.getById('sess-1')!;
    expect(updated.displayName).toBe('my-agent');
    expect(updated.tmuxName).toBe('fleex_claude_org_repo_main_my-agent');
    // Verify tmux was renamed
    expect(tmux.sessions.has('fleex_claude_org_repo_main_my-agent')).toBe(true);
    expect(tmux.sessions.has('fleex_claude_org_repo_main_claude')).toBe(false);
  });

  it('should auto-dedup when name conflicts with sibling', async () => {
    createSession({
      id: 'sess-1',
      tmuxName: 'fleex_claude_org_repo_main_claude',
      displayName: 'Claude',
    });
    createSession({
      id: 'sess-2',
      tmuxName: 'fleex_claude_org_repo_main_worker',
      displayName: 'worker',
    });

    await useCase.execute('sess-1', 'worker');

    const updated = store.getById('sess-1')!;
    expect(updated.displayName).toBe('worker-1');
    expect(updated.tmuxName).toBe('fleex_claude_org_repo_main_worker-1');
  });

  it('should throw SessionNotFoundError for unknown id', async () => {
    await expect(useCase.execute('nonexistent', 'whatever')).rejects.toThrow(SessionNotFoundError);
  });

  it('should short-circuit when name is unchanged', async () => {
    createSession({ tmuxName: 'fleex_claude_org_repo_main_claude', displayName: 'Claude' });

    await useCase.execute('sess-1', 'Claude');

    const updated = store.getById('sess-1')!;
    expect(updated.tmuxName).toBe('fleex_claude_org_repo_main_claude');
    expect(updated.displayName).toBe('Claude');
    // tmux rename should not have been called — session map should still have old name
    expect(tmux.sessions.has('fleex_claude_org_repo_main_claude')).toBe(true);
  });

  it('should work for sessions without git context', async () => {
    createSession({
      id: 'sess-1',
      tmuxName: 'fleex_shell_shell',
      type: 'shell',
      org: null,
      repo: null,
      worktree: null,
      displayName: 'Shell',
    });

    await useCase.execute('sess-1', 'dev');

    const updated = store.getById('sess-1')!;
    expect(updated.displayName).toBe('dev');
    expect(updated.tmuxName).toBe('fleex_shell_dev');
  });
});
