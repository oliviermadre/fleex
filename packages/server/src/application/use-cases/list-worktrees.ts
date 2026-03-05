import type { Worktree } from '@fleex/shared';
import type { GitPort } from '../ports/git.port.js';
import type { LoggerPort } from '../ports/logger.port.js';

export class ListWorktreesUseCase {
  constructor(
    private readonly git: GitPort,
    private readonly logger: LoggerPort,
  ) {}

  async execute(repoPath: string): Promise<Worktree[]> {
    this.logger.debug('Listing worktrees', { repoPath });
    return this.git.listWorktrees(repoPath);
  }
}
