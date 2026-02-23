import { describe, it, expect, beforeEach, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { CreateWorktreeUseCase } from '../../src/application/use-cases/create-worktree.js';
import { WorktreeError } from '../../src/domain/errors.js';
import { FakeGitPort, FakeLoggerPort } from '../helpers/fakes.js';

// Mock existsSync
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}));

describe('CreateWorktreeUseCase', () => {
  let git: FakeGitPort;
  let logger: FakeLoggerPort;
  let useCase: CreateWorktreeUseCase;
  const mockExistsSync = vi.mocked(existsSync);

  beforeEach(() => {
    git = new FakeGitPort();
    logger = new FakeLoggerPort();
    useCase = new CreateWorktreeUseCase(git, logger);
    mockExistsSync.mockReset();
  });

  it('should clone repository if it does not exist', async () => {
    // Repository doesn't exist
    mockExistsSync.mockReturnValue(false);

    const repoPath = '/tmp/repos/myorg/myrepo';
    const wtPath = '/tmp/worktrees/myrepo.feature';
    const request = { branch: 'feature/test', createNewBranch: true };

    await useCase.execute(repoPath, wtPath, request);

    // Should have cloned the repository
    const cloneLog = git.getCloneLog();
    expect(cloneLog).toHaveLength(1);
    expect(cloneLog[0]).toEqual({
      remote: 'https://github.com/myorg/myrepo.git',
      targetPath: repoPath,
    });

    // Should log the cloning attempt
    const infoLogs = logger.logs.filter(log => log.level === 'info');
    expect(infoLogs.some(log => log.msg.includes('attempting to clone'))).toBe(true);
    expect(infoLogs.some(log => log.msg.includes('cloned successfully'))).toBe(true);
  });

  it('should not clone if repository already exists', async () => {
    // Repository exists
    mockExistsSync.mockReturnValue(true);

    const repoPath = '/tmp/repos/myorg/myrepo';
    const wtPath = '/tmp/worktrees/myrepo.feature';
    const request = { branch: 'feature/test', createNewBranch: true };

    await useCase.execute(repoPath, wtPath, request);

    // Should not have cloned
    const cloneLog = git.getCloneLog();
    expect(cloneLog).toHaveLength(0);
  });

  it('should throw error if cannot derive org/repo from path', async () => {
    mockExistsSync.mockReturnValue(false);

    const repoPath = '/invalid'; // Not enough path parts
    const wtPath = '/tmp/worktrees/myrepo.feature';
    const request = { branch: 'feature/test', createNewBranch: true };

    await expect(useCase.execute(repoPath, wtPath, request))
      .rejects.toThrow(WorktreeError);
    await expect(useCase.execute(repoPath, wtPath, request))
      .rejects.toThrow('Cannot derive organization and repository name');
  });

  it('should throw error if cloning fails', async () => {
    mockExistsSync.mockReturnValue(false);

    // Make clone method throw an error
    const cloneError = new Error('Clone failed: repository not found');
    vi.spyOn(git, 'clone').mockRejectedValue(cloneError);

    const repoPath = '/tmp/repos/myorg/myrepo';
    const wtPath = '/tmp/worktrees/myrepo.feature';
    const request = { branch: 'feature/test', createNewBranch: true };

    await expect(useCase.execute(repoPath, wtPath, request))
      .rejects.toThrow(WorktreeError);
    await expect(useCase.execute(repoPath, wtPath, request))
      .rejects.toThrow('Failed to clone repository');
  });

  it('should continue with worktree creation after successful clone', async () => {
    mockExistsSync.mockReturnValue(false);

    const createWorktreeSpy = vi.spyOn(git, 'createWorktree');
    const fetchSpy = vi.spyOn(git, 'fetch');

    const repoPath = '/tmp/repos/myorg/myrepo';
    const wtPath = '/tmp/worktrees/myrepo.feature';
    const request = { branch: 'feature/test', createNewBranch: true };

    await useCase.execute(repoPath, wtPath, request);

    // Should have cloned first
    expect(git.getCloneLog()).toHaveLength(1);
    
    // Then should have attempted fetch and worktree creation
    expect(fetchSpy).toHaveBeenCalledWith(repoPath);
    expect(createWorktreeSpy).toHaveBeenCalledWith(
      repoPath,
      wtPath,
      request.branch,
      request.createNewBranch,
      undefined,
    );
  });
});