import { readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Repository } from '@asm/shared';
import type { GitPort } from '../ports/git.port.js';
import type { ConfigPort } from '../ports/config.port.js';
import type { LoggerPort } from '../ports/logger.port.js';

export class ListRepositoriesUseCase {
  constructor(
    private readonly git: GitPort,
    private readonly config: ConfigPort,
    private readonly logger: LoggerPort,
  ) {}

  async execute(): Promise<Repository[]> {
    const basePath = this.config.get().basePath;
    const repositories: Repository[] = [];

    let orgs: string[];
    try {
      orgs = await readdir(resolve(basePath));
    } catch {
      this.logger.warn('Could not read repositories base path', { basePath });
      return [];
    }

    for (const org of orgs) {
      const orgPath = join(basePath, org);
      const orgStat = await stat(orgPath).catch(() => null);
      if (!orgStat?.isDirectory()) continue;

      let repos: string[];
      try {
        repos = await readdir(orgPath);
      } catch {
        continue;
      }

      for (const repo of repos) {
        const repoPath = join(orgPath, repo);
        const repoStat = await stat(repoPath).catch(() => null);
        if (!repoStat?.isDirectory()) continue;

        try {
          const info = await this.git.getInfo(repoPath);
          const defaultBranch = await this.git.getDefaultBranch(repoPath);
          repositories.push({
            org: info.org,
            name: info.name,
            path: repoPath,
            defaultBranch,
            remote: info.remote,
          });
        } catch {
          // Not a git repo, skip
        }
      }
    }

    return repositories;
  }
}
