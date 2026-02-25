import { EVENT_TYPES } from '@asm/shared';
import type { CreateWorktreeRequest } from '@asm/shared';
import { WorktreeError } from '../../domain/errors.js';
import { createEvent } from '../../domain/events/create-event.js';
import type { GitPort } from '../ports/git.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { EventBusPort } from '../ports/event-bus.port.js';

export class CreateWorktreeUseCase {
  constructor(
    private readonly git: GitPort,
    private readonly logger: LoggerPort,
    private readonly eventBus?: EventBusPort,
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
      await this.copyIgnoredFiles(repoPath, wtPath);
      this.emitCreated(repoPath, wtPath, request.branch);
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
        return existingPath;
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
        await this.copyIgnoredFiles(repoPath, wtPath);
        this.emitCreated(repoPath, wtPath, request.branch);
        return null;
      }
      throw new WorktreeError(`Failed to create worktree: ${message}`);
    }
  }

  private emitCreated(repoPath: string, wtPath: string, branch: string): void {
    this.eventBus?.emit(createEvent(EVENT_TYPES.WORKTREE_CREATED, {
      repoPath,
      path: wtPath,
      branch,
    }, { source: 'use-case' }));
  }

  private async copyIgnoredFiles(repoPath: string, wtPath: string): Promise<void> {
    try {
      await this.git.copyIgnoredFiles(repoPath, wtPath);
      this.logger.info('Copied gitignored files to worktree', { repoPath, wtPath });
    } catch {
      this.logger.warn('Failed to copy gitignored files to worktree', { repoPath, wtPath });
    }
  }
}
