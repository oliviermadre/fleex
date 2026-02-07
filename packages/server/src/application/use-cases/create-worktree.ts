import type { CreateWorktreeRequest } from '@asm/shared';
import { WorktreeError } from '../../domain/errors.js';
import type { GitPort } from '../ports/git.port.js';
import type { LoggerPort } from '../ports/logger.port.js';

export class CreateWorktreeUseCase {
  constructor(
    private readonly git: GitPort,
    private readonly logger: LoggerPort,
  ) {}

  async execute(repoPath: string, wtPath: string, request: CreateWorktreeRequest): Promise<void> {
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
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new WorktreeError(`Failed to create worktree: ${message}`);
    }
  }
}
