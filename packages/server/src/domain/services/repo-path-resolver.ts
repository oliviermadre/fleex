import { join } from 'node:path';

export interface ResolvedRepo {
  readonly repoPath: string;
  readonly mode: 'regular' | 'bare';
  readonly envSourcePath: string;
}

type ExistsFn = (path: string) => Promise<boolean>;

export class RepoPathResolver {
  constructor(private readonly existsFn: ExistsFn) {}

  async resolve(basePath: string, org: string, name: string): Promise<ResolvedRepo | null> {
    // Bare clone has priority
    const barePath = join(basePath, '.repos', org, `${name}.git`);
    if (await this.existsFn(barePath)) {
      return {
        repoPath: barePath,
        mode: 'bare',
        envSourcePath: join(basePath, '.repos', org, `${name}.env`),
      };
    }

    // Regular clone fallback
    const regularPath = join(basePath, org, name);
    if (await this.existsFn(regularPath)) {
      return {
        repoPath: regularPath,
        mode: 'regular',
        envSourcePath: regularPath,
      };
    }

    return null;
  }

  worktreePath(basePath: string, ticketId: string, org: string, name: string): string {
    return join(basePath, 'workspaces', ticketId, org, name);
  }
}
