import { describe, it, expect, beforeEach } from 'vitest';
import { CreateSessionUseCase } from '../../src/application/use-cases/create-session.js';
import { SessionNamingService } from '../../src/domain/services/session-naming.js';
import {
  FakeTmuxPort,
  FakeSessionStore,
  FakeGitPort,
  FakeConfigPort,
  FakeLoggerPort,
  FakeFileSystemPort,
} from '../helpers/fakes.js';

describe('CreateSessionUseCase', () => {
  let tmux: FakeTmuxPort;
  let store: FakeSessionStore;
  let git: FakeGitPort;
  let config: FakeConfigPort;
  let logger: FakeLoggerPort;
  let fileSystem: FakeFileSystemPort;
  let useCase: CreateSessionUseCase;

  beforeEach(() => {
    tmux = new FakeTmuxPort();
    store = new FakeSessionStore();
    git = new FakeGitPort();
    config = new FakeConfigPort();
    logger = new FakeLoggerPort();
    fileSystem = new FakeFileSystemPort();
    useCase = new CreateSessionUseCase(
      tmux, store, new SessionNamingService(), git, config, logger, fileSystem,
    );
  });

  it('should create a shell session with human-readable name', async () => {
    git.setInfo('/tmp/project', {
      org: 'myorg',
      name: 'myrepo',
      remote: 'https://github.com/myorg/myrepo.git',
      branch: 'main',
      isWorktree: false,
      mainWorktreePath: '/tmp/project',
    });

    const session = await useCase.execute({
      cwd: '/tmp/project',
      type: 'shell',
    });

    expect(session.type).toBe('shell');
    expect(session.tmuxName).toBe('asm_shell_myorg_myrepo_main_shell');
    expect(session.displayName).toBe('Shell');
    expect(session.cwd).toBe('/tmp/project');
    expect(session.repositoryOrg).toBe('myorg');
    expect(session.repositoryName).toBe('myrepo');
    expect(session.status).toBe('running');

    // Verify tmux session was created
    expect(tmux.sessions.has(session.tmuxName)).toBe(true);

    // Verify session was persisted
    expect(store.getById(session.id)).not.toBeNull();
  });

  it('should create a claude session with human-readable name', async () => {
    git.setInfo('/tmp/project', {
      org: 'myorg',
      name: 'myrepo',
      remote: 'https://github.com/myorg/myrepo.git',
      branch: 'feat/test',
      isWorktree: false,
      mainWorktreePath: '/tmp/project',
    });

    const session = await useCase.execute({
      cwd: '/tmp/project',
      type: 'claude',
    });

    expect(session.type).toBe('claude');
    expect(session.tmuxName).toBe('asm_claude_myorg_myrepo_feat-test_claude');
    expect(session.displayName).toBe('Claude');

    // Should have sent the claude command
    expect(tmux.sentKeys).toHaveLength(1);
    expect(tmux.sentKeys[0]!.keys).toBe('claude');
  });

  it('should auto-suffix duplicate names', async () => {
    git.setInfo('/tmp/project', {
      org: 'myorg',
      name: 'myrepo',
      remote: 'https://github.com/myorg/myrepo.git',
      branch: 'main',
      isWorktree: false,
      mainWorktreePath: '/tmp/project',
    });

    const session1 = await useCase.execute({ cwd: '/tmp/project', type: 'claude' });
    const session2 = await useCase.execute({ cwd: '/tmp/project', type: 'claude' });

    expect(session1.tmuxName).toBe('asm_claude_myorg_myrepo_main_claude');
    expect(session1.displayName).toBe('Claude');
    expect(session2.tmuxName).toBe('asm_claude_myorg_myrepo_main_claude-1');
    expect(session2.displayName).toBe('Claude-1');
  });

  it('should create a claude session with custom prompt', async () => {
    const session = await useCase.execute({
      cwd: '/tmp/project',
      type: 'claude',
      claudePrompt: 'Fix the bug',
    });

    expect(tmux.sentKeys[0]!.keys).toBe('claude "Fix the bug"');
    expect(session.claudePrompt).toBe('Fix the bug');
  });

  it('should handle missing git info gracefully', async () => {
    // No git info set -> getInfo will throw
    const session = await useCase.execute({
      cwd: '/tmp/no-git',
      type: 'shell',
    });

    expect(session.repositoryOrg).toBeNull();
    expect(session.repositoryName).toBeNull();
    // Without git context, name is just asm_shell_<displayName>
    expect(session.tmuxName).toBe('asm_shell_shell');
    expect(session.displayName).toBe('Shell');
  });

  it('should include displayName in DTO', async () => {
    git.setInfo('/tmp/project', {
      org: 'myorg',
      name: 'myrepo',
      remote: 'https://github.com/myorg/myrepo.git',
      branch: 'main',
      isWorktree: false,
      mainWorktreePath: '/tmp/project',
    });

    const session = await useCase.execute({ cwd: '/tmp/project', type: 'claude' });
    const dto = session.toDTO();

    expect(dto.displayName).toBe('Claude');
  });

  it('should throw InvalidWorkingDirectoryError when cwd does not exist', async () => {
    fileSystem.setNotExists('/does/not/exist');

    await expect(
      useCase.execute({ cwd: '/does/not/exist', type: 'shell' }),
    ).rejects.toMatchObject({ code: 'INVALID_WORKING_DIRECTORY' });

    // No tmux session should have been created
    expect(tmux.sessions.size).toBe(0);

    // A warn should have been logged
    expect(logger.logs.some((l) => l.level === 'warn')).toBe(true);
  });
});
