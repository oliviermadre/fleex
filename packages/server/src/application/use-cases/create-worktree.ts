import type { CreateWorktreeRequest } from '@asm/shared';
import { WorktreeError } from '../../domain/errors.js';
import type { GitPort } from '../ports/git.port.js';
import type { LoggerPort } from '../ports/logger.port.js';

export class CreateWorktreeUseCase {
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
      return null;
    } catch (err) {
      const stderr = (err as { stderr?: string }).stderr?.trim();
      const message = stderr || (err instanceof Error ? err.message : String(err));
      const match = message.match(/is already used by worktree at '([^']+)'/);
      if (match) {
        const existingPath = match[1]!;
        this.logger.info('Branch already checked out, reusing existing worktree', {
          repoPath, existingPath, branch: request.branch,
        });
        return existingPath;
      }
      throw new WorktreeError(`Failed to create worktree: ${message}`);
    }
  }
}
