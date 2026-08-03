import { readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import type { SessionGroup, WorktreeSessionGroup, WorktreeDiffStats } from '@fleex/shared';

import type { GitPort } from '../../application/ports/git.port.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';

/**
 * Caches diff stats (additions/deletions vs base branch) per worktree path.
 * Refreshed on a slow timer (e.g. 60s) to avoid blocking the 1s broadcast.
 * For multi-repo workspaces, sums stats across all repos.
 */
export class DiffStatsCache {
  private cache = new Map<string, WorktreeDiffStats>();
  private refreshing = false;

  constructor(
    private readonly git: GitPort,
    private readonly logger: LoggerPort,
  ) {}

  /** Attach cached stats to worktree groups (mutates groups in place). */
  inject(groups: SessionGroup[]): void {
    for (const group of groups) {
      for (const wt of group.worktrees) {
        const stats = this.cache.get(wt.path);
        if (stats && (stats.additions > 0 || stats.deletions > 0)) {
          (wt as { diffStats?: WorktreeDiffStats }).diffStats = stats;
        }
      }
    }
  }

  /** Recompute stats for all non-system worktrees. Non-blocking — skips if already running. */
  async refresh(groups: SessionGroup[]): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      for (const group of groups) {
        if (group.repositoryOrg === '_ungrouped') continue;
        for (const wt of group.worktrees) {
          if (!wt.path) continue;
          try {
            const stats = await this.computeStats(wt.path);
            this.cache.set(wt.path, stats);
          } catch {
            // ignore — repo may not be cloned yet
          }
        }
      }
    } finally {
      this.refreshing = false;
    }
  }

  /** Compute summed additions/deletions for a worktree path (handles multi-repo workspaces). */
  private async computeStats(wtPath: string): Promise<WorktreeDiffStats> {
    // Find git repos: either wtPath itself is a git repo, or it's a workspace with repo subdirs
    const repoPaths = this.findGitRepos(wtPath);
    let totalAdditions = 0;
    let totalDeletions = 0;

    for (const repoPath of repoPaths) {
      try {
        const info = await this.git.getInfo(repoPath);
        if (!info.branch) continue;
        const stats = await this.git.getDiffStats(repoPath, info.branch);
        totalAdditions += stats.additions;
        totalDeletions += stats.deletions;
      } catch {
        // skip repos where diff fails
      }
    }

    return { additions: totalAdditions, deletions: totalDeletions };
  }

  /** Find git repo paths: if wtPath is a git repo, return it; otherwise scan immediate children. */
  private findGitRepos(wtPath: string): string[] {
    if (existsSync(join(wtPath, '.git'))) return [wtPath];

    // Workspace root — check each subdirectory
    const repos: string[] = [];
    try {
      for (const entry of readdirSync(wtPath)) {
        if (entry.startsWith('.')) continue;
        const child = join(wtPath, entry);
        if (statSync(child).isDirectory() && existsSync(join(child, '.git'))) {
          repos.push(child);
        }
      }
    } catch {
      // not readable
    }
    return repos;
  }
}
