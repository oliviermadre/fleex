import type { Repository } from '@fleex/shared';

import type { RepoPathResolver } from '../../domain/services/repo-path-resolver.js';
import type { HostFs } from '../../infrastructure/host/types.js';
import type { ConfigPort } from '../ports/config.port.js';
import type { GitPort } from '../ports/git.port.js';
import type { LoggerPort } from '../ports/logger.port.js';

export class ListRepositoriesUseCase {
  constructor(
    private readonly git: GitPort,
    private readonly config: ConfigPort,
    private readonly logger: LoggerPort,
    private readonly hostFs: HostFs,
    private readonly resolver: RepoPathResolver,
  ) {}

  async execute(): Promise<Repository[]> {
    const cfg = this.config.get();
    const resolved = cfg.resolvedRepositories;
    if (!Array.isArray(resolved)) return [];

    const repositories: Repository[] = [];

    for (const entry of resolved) {
      if (typeof entry !== 'string' || !entry.includes('/')) continue;
      const [org, name] = entry.split('/');
      if (!org || !name) continue;

      const barePath = this.resolver.barePath(org, name);
      const isCloned = await this.hostFs.exists(barePath);

      if (isCloned) {
        try {
          const info = await this.git.getInfo(barePath);
          const defaultBranch = await this.git.getDefaultBranch(barePath);
          repositories.push({
            org,
            name,
            barePath,
            defaultBranch,
            remote: info.remote,
            isCloned: true,
          });
        } catch {
          // Bare clone exists but git info failed — list it anyway
          repositories.push({
            org,
            name,
            barePath,
            defaultBranch: 'main',
            remote: `git@github.com:${org}/${name}.git`,
            isCloned: true,
          });
        }
      } else {
        repositories.push({
          org,
          name,
          barePath,
          defaultBranch: 'main',
          remote: `git@github.com:${org}/${name}.git`,
          isCloned: false,
        });
      }
    }

    return repositories;
  }
}
