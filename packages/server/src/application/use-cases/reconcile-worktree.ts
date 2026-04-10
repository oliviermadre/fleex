import { buildWorktreeDirName } from '../../domain/services/branch-utils.js';
import type { RepoPathResolver } from '../../domain/services/repo-path-resolver.js';
import type { BareCloneManager } from '../services/bare-clone-manager.js';
import type { CreateWorktreeUseCase } from './create-worktree.js';
import type { GitPort } from '../ports/git.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { HostFs } from '../../infrastructure/host/types.js';

export interface ReconcileResult {
  path: string | null;
  status: 'exists' | 'created' | 'repo_missing' | 'failed';
}

interface CacheEntry {
  result: ReconcileResult;
  checkedAt: number;
}

const SUCCESS_TTL_MS = 5 * 60 * 1000; // 5 minutes
const FAILURE_TTL_MS = 30 * 1000;      // 30 seconds

export class ReconcileWorktreeUseCase {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly createWorktree: CreateWorktreeUseCase,
    private readonly resolver: RepoPathResolver,
    private readonly hostFs: HostFs,
    private readonly bareCloneManager: BareCloneManager,
    private readonly git: GitPort,
    private readonly logger: LoggerPort,
  ) {}

  async execute(org: string, repoName: string, branch: string): Promise<ReconcileResult> {
    const cacheKey = `${org}/${repoName}:${branch}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      const ttl = cached.result.status === 'exists' || cached.result.status === 'created'
        ? SUCCESS_TTL_MS
        : FAILURE_TTL_MS;
      if (Date.now() - cached.checkedAt < ttl) {
        return cached.result;
      }
    }

    const result = await this.reconcile(org, repoName, branch);
    this.cache.set(cacheKey, { result, checkedAt: Date.now() });
    return result;
  }

  private async reconcile(org: string, repoName: string, branch: string): Promise<ReconcileResult> {
    const barePath = this.resolver.barePath(org, repoName);
    const wtPath = this.resolver.worktreeDir(org, buildWorktreeDirName(repoName, branch));

    // 1. Check if worktree path already exists
    try {
      if (await this.hostFs.exists(wtPath)) {
        return { path: wtPath, status: 'exists' };
      }
    } catch {
      // fs check failed, continue to try creation
    }

    // 2. Check if bare clone exists
    try {
      if (!(await this.hostFs.exists(barePath))) {
        this.logger.debug('Bare clone not found for worktree reconciliation', { barePath, branch });
        return { path: null, status: 'repo_missing' };
      }
    } catch {
      return { path: null, status: 'failed' };
    }

    // 3. Try to create worktree using existing branch
    try {
      const existingPath = await this.createWorktree.execute(org, repoName, wtPath, {
        branch,
        createNewBranch: false,
      });
      // createWorktree returns null on success, or an existing path if reused
      const finalPath = existingPath ?? wtPath;
      this.logger.info('Reconciled worktree', { org, repoName, branch, path: finalPath });
      return { path: finalPath, status: 'created' };
    } catch (err) {
      // Branch might not exist remotely — try creating a new local branch from origin/main
      this.logger.debug('Failed to checkout existing branch, trying new branch from origin/main', {
        branch, error: String(err),
      });
      try {
        const existingPath = await this.createWorktree.execute(org, repoName, wtPath, {
          branch,
          createNewBranch: true,
        });
        const finalPath = existingPath ?? wtPath;
        this.logger.info('Reconciled worktree (new branch from origin/main)', { org, repoName, branch, path: finalPath });
        return { path: finalPath, status: 'created' };
      } catch (retryErr) {
        this.logger.warn('Failed to reconcile worktree', {
          org, repoName, branch, error: String(retryErr),
        });
        return { path: null, status: 'failed' };
      }
    }
  }
}
