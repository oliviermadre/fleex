import type { CreateWorktreeRequest } from '@fleex/shared';
import { WorktreeError } from '../../domain/errors.js';
import type { EventBus } from '../event-bus.js';
import type { GitPort } from '../ports/git.port.js';
import type { LoggerPort } from '../ports/logger.port.js';

export class CreateWorktreeUseCase {
  public eventBus: EventBus | null = null;

  constructor(
    private readonly git: GitPort,
    private readonly logger: LoggerPort,
  ) {}

  async execute(repoPath: string, wtPath: string, request: CreateWorktreeRequest): Promise<string | null> {
    try {
      await this.git.fetch(repoPath);
    } catch {
      this.logger.warn('Failed to fetch before worktree creation', { repoPath });
    }

    try {
      await this.git.createWorktree(
        repoPath,
        wtPath,
        request.branch,
        request.createNewBranch,
        request.baseBranch,
      );
      this.logger.info('Worktree created', { repoPath, wtPath, branch: request.branch });
      await this.copyEnvFiles(repoPath, wtPath);
      this.emitCreated(repoPath, wtPath, request);
      return null;
    } catch (err) {
      const stderr = (err as { stderr?: string }).stderr?.trim();
      const message = stderr || (err instanceof Error ? err.message : String(err));
      const reuseMatch = message.match(/is already used by worktree at '([^']+)'/);
      if (reuseMatch) {
        const existingPath = reuseMatch[1]!;
        this.logger.info('Branch already checked out, reusing existing worktree', {
          repoPath, existingPath, branch: request.branch,
        });
        this.emitCreated(repoPath, existingPath, request);
        return existingPath;
      }
      const branchExistsMatch = message.match(/branch named '([^']+)' already exists/i);
      if (branchExistsMatch && request.createNewBranch) {
        this.logger.info('Branch already exists, checking out existing branch', {
          repoPath, wtPath, branch: request.branch,
        });
        // Retry without -b; this can itself fail (e.g. branch already checked out)
        // so we recurse with createNewBranch=false to let the other handlers deal with it.
        return this.execute(repoPath, wtPath, { ...request, createNewBranch: false });
      }
      const checkedOutMatch = message.match(/is already checked out at '([^']+)'/);
      if (checkedOutMatch) {
        const existingPath = checkedOutMatch[1]!;
        this.logger.info('Branch already checked out elsewhere, replacing worktree', {
          repoPath, existingPath, wtPath, branch: request.branch,
        });
        await this.git.removeWorktree(repoPath, existingPath);
        await this.git.createWorktree(
          repoPath,
          wtPath,
          request.branch,
          request.createNewBranch,
          request.baseBranch,
        );
        this.logger.info('Worktree replaced', { repoPath, wtPath, branch: request.branch });
        await this.copyEnvFiles(repoPath, wtPath);
        this.emitCreated(repoPath, wtPath, request);
        return null;
      }
      const dirExistsMatch = message.match(/'([^']+)' already exists/);
      if (dirExistsMatch) {
        const existingPath = dirExistsMatch[1]!;
        this.logger.info('Worktree directory already exists, repairing and reusing', {
          repoPath, existingPath, branch: request.branch,
        });
        try {
          await this.git.repairWorktrees(repoPath);
        } catch {
          this.logger.warn('Worktree repair failed, continuing anyway', { repoPath, existingPath });
        }
        this.emitCreated(repoPath, existingPath, request);
        return existingPath;
      }
      throw new WorktreeError(`Failed to create worktree: ${message}`);
    }
  }

  private emitCreated(repoPath: string, worktreePath: string, request: CreateWorktreeRequest): void {
    this.eventBus?.emit({
      type: 'worktree.created',
      repoPath,
      worktreePath,
      branch: request.branch,
      isNewBranch: request.createNewBranch,
      occurredAt: new Date(),
    });
  }

  private async copyEnvFiles(repoPath: string, wtPath: string): Promise<void> {
    try {
      await this.git.copyEnvFiles(repoPath, wtPath);
      this.logger.info('Copied env files to worktree', { repoPath, wtPath });
    } catch {
      this.logger.warn('Failed to copy env files to worktree', { repoPath, wtPath });
    }
  }
}
