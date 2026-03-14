import { readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Repository } from '@fleex/shared';
import type { GitPort } from '../ports/git.port.js';
import type { ConfigPort } from '../ports/config.port.js';
import type { LoggerPort } from '../ports/logger.port.js';

const EXCLUDED_DIRS = new Set(['.repos', 'workspaces']);

export class ListRepositoriesUseCase {
  constructor(
    private readonly git: GitPort,
    private readonly config: ConfigPort,
    private readonly logger: LoggerPort,
  ) {}

  async execute(): Promise<Repository[]> {
    const basePath = this.config.get().basePath;
    const seen = new Set<string>(); // "org/name" dedup key
    const repositories: Repository[] = [];

    // 1. Scan bare repos under basePath/.repos/org/name.git
    await this.scanBareRepos(basePath, repositories, seen);

    // 2. Scan regular repos under basePath/org/name (excluding .repos, workspaces, dot-dirs)
    await this.scanRegularRepos(basePath, repositories, seen);

    return repositories;
  }

  private async scanBareRepos(
    basePath: string,
    repositories: Repository[],
    seen: Set<string>,
  ): Promise<void> {
    const bareRoot = join(basePath, '.repos');
    let orgs: string[];
    try {
      orgs = await readdir(resolve(bareRoot));
    } catch {
      return; // .repos/ doesn't exist yet — that's fine
    }

    for (const org of orgs) {
      const orgPath = join(bareRoot, org);
      const orgStat = await stat(orgPath).catch(() => null);
      if (!orgStat?.isDirectory()) continue;

      let entries: string[];
      try {
        entries = await readdir(orgPath);
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (!entry.endsWith('.git')) continue;
        const repoPath = join(orgPath, entry);
        const repoStat = await stat(repoPath).catch(() => null);
        if (!repoStat?.isDirectory()) continue;

        try {
          const info = await this.git.getInfo(repoPath);
          const defaultBranch = await this.git.getDefaultBranch(repoPath);
          const key = `${info.org}/${info.name}`;
          seen.add(key);
          repositories.push({
            org: info.org,
            name: info.name,
            path: repoPath,
            defaultBranch,
            remote: info.remote,
            mode: 'bare',
          });
        } catch {
          // Not a valid bare repo, skip
        }
      }
    }
  }

  private async scanRegularRepos(
    basePath: string,
    repositories: Repository[],
    seen: Set<string>,
  ): Promise<void> {
    let orgs: string[];
    try {
      orgs = await readdir(resolve(basePath));
    } catch {
      this.logger.warn('Could not read repositories base path', { basePath });
      return;
    }

    for (const org of orgs) {
      if (org.startsWith('.') || EXCLUDED_DIRS.has(org)) continue;

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
          const key = `${info.org}/${info.name}`;
          // Skip if already seen as bare (bare has priority)
          if (seen.has(key)) continue;
          const defaultBranch = await this.git.getDefaultBranch(repoPath);
          seen.add(key);
          repositories.push({
            org: info.org,
            name: info.name,
            path: repoPath,
            defaultBranch,
            remote: info.remote,
            mode: 'regular',
          });
        } catch {
          // Not a git repo, skip
        }
      }
    }
  }
}
