import { existsSync } from 'node:fs';
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
    // Check if repository exists, if not attempt to clone it
    if (!existsSync(repoPath)) {
      this.logger.info('Repository does not exist, attempting to clone', { repoPath });
      
      // Try to derive the clone URL from the repository path
      // Expected path format: /base/path/org/repo
      const pathParts = repoPath.split('/');
      const repo = pathParts[pathParts.length - 1];
      const org = pathParts[pathParts.length - 2];
      
      if (!org || !repo) {
        throw new WorktreeError(`Cannot derive organization and repository name from path: ${repoPath}`);
      }
      
      const cloneUrl = `https://github.com/${org}/${repo}.git`;
      
      try {
        await this.git.clone(cloneUrl, repoPath);
        this.logger.info('Repository cloned successfully', { cloneUrl, repoPath });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new WorktreeError(`Failed to clone repository from ${cloneUrl}: ${message}`);
      }
    }

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
        return null;
      }
      throw new WorktreeError(`Failed to create worktree: ${message}`);
    }
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
