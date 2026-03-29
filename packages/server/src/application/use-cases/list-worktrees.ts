import type { Worktree } from '@fleex/shared';
import type { GitPort } from '../ports/git.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { RepoPathResolver } from '../../domain/services/repo-path-resolver.js';
import type { BareCloneManager } from '../services/bare-clone-manager.js';

export class ListWorktreesUseCase {
  constructor(
    private readonly git: GitPort,
    private readonly logger: LoggerPort,
    private readonly resolver: RepoPathResolver,
    private readonly bareCloneManager: BareCloneManager,
  ) {}

  async execute(org: string, name: string): Promise<Worktree[]> {
    const barePath = this.resolver.barePath(org, name);
    this.logger.debug('Listing worktrees', { org, name, barePath });

    // Fetch before listing to have up-to-date state
    await this.bareCloneManager.fetch(org, name);

    return this.git.listWorktrees(barePath);
  }
}
