import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RepoPathResolver } from '../../domain/services/repo-path-resolver.js';
import { resolveBaseRef } from '../../domain/services/branch-utils.js';
import type { BareCloneManager } from '../services/bare-clone-manager.js';
import type { CreateWorktreeUseCase } from './create-worktree.js';
import type { GitPort } from '../ports/git.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
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
    private readonly ticketStore: TicketStorePort,
  ) {}

  async execute(
    org: string,
    repoName: string,
    branch: string,
    ws: { workspaceId: string; ticketId: string; prNumber?: number },
  ): Promise<ReconcileResult> {
    const cacheKey = `${ws.workspaceId}/${repoName}:${branch}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      const ttl = cached.result.status === 'exists' || cached.result.status === 'created'
        ? SUCCESS_TTL_MS
        : FAILURE_TTL_MS;
      if (Date.now() - cached.checkedAt < ttl) {
        return cached.result;
      }
    }

    const result = await this.reconcile(org, repoName, branch, ws);
    this.cache.set(cacheKey, { result, checkedAt: Date.now() });
    return result;
  }

  private async reconcile(
    org: string,
    repoName: string,
    branch: string,
    ws: { workspaceId: string; ticketId: string; prNumber?: number },
  ): Promise<ReconcileResult> {
    const barePath = this.resolver.barePath(org, repoName);
    // Homogeneous convention: every ticket-scoped worktree lives under
    // workspaces/{workspaceId}/{repoName}, never the legacy worktrees/{org}/... path.
    const wtPath = this.resolver.workspaceRepoPath(ws.workspaceId, repoName);

    // 1. Check if worktree path already exists
    try {
      if (await this.hostFs.exists(wtPath)) {
        this.ensureWorkspaceManifest(ws);
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

    // 3. Ensure the ticket workspace + manifest exist so the dashboard can resolve
    // this worktree back to its ticket (same manifest as ensureWorkspace /
    // create-session-from-ticket), then create the worktree using the existing branch.
    this.ensureWorkspaceManifest(ws);
    // Pass prNumber so create-worktree can fetch refs/pull/<n>/head when the branch
    // is not on origin (fork PRs) instead of falling back to a branch off main.
    const prOpt = ws.prNumber ? { prNumber: ws.prNumber } : {};
    try {
      const existingPath = await this.createWorktree.execute(org, repoName, wtPath, {
        branch,
        createNewBranch: false,
        ...prOpt,
      });
      // createWorktree returns null on success, or an existing path if reused
      const finalPath = existingPath ?? wtPath;
      this.logger.info('Reconciled worktree', { org, repoName, branch, path: finalPath });
      return { path: finalPath, status: 'created' };
    } catch (err) {
      // Branch might not exist remotely — try creating a new local branch. Base
      // it on the ticket's per-repo base branch when set (so a reconciled
      // worktree derives from the same branch its siblings do), otherwise the
      // repo default. Resolving the ticket is best-effort — a missing store or
      // ticket just falls back to the default branch.
      const baseBranch = await this.resolveTicketBaseBranch(ws.ticketId, org, repoName);
      this.logger.debug('Failed to checkout existing branch, trying new branch', {
        branch, baseBranch, error: String(err),
      });
      try {
        const existingPath = await this.createWorktree.execute(org, repoName, wtPath, {
          branch,
          createNewBranch: true,
          ...prOpt,
          ...(baseBranch ? { baseBranch } : {}),
        });
        const finalPath = existingPath ?? wtPath;
        this.logger.info('Reconciled worktree (new branch)', { org, repoName, branch, baseBranch, path: finalPath });
        return { path: finalPath, status: 'created' };
      } catch (retryErr) {
        this.logger.warn('Failed to reconcile worktree', {
          org, repoName, branch, error: String(retryErr),
        });
        return { path: null, status: 'failed' };
      }
    }
  }

  /**
   * Resolve the `origin/<base>` ref for a ticket's repo, or `undefined` when the
   * ticket has no custom base for it. Never throws — reconciliation must keep
   * working even if the ticket lookup fails.
   */
  private async resolveTicketBaseBranch(
    ticketId: string,
    org: string,
    repoName: string,
  ): Promise<string | undefined> {
    try {
      const ticket = await this.ticketStore.getTicketById(ticketId);
      return ticket ? resolveBaseRef(ticket.links, org, repoName) : undefined;
    } catch {
      return undefined;
    }
  }

  /** Create the ticket workspace dir + `.fleex.json` manifest if missing. */
  private ensureWorkspaceManifest(ws: { workspaceId: string; ticketId: string }): void {
    try {
      const root = this.resolver.workspacePath(ws.workspaceId);
      mkdirSync(root, { recursive: true });
      const manifestPath = join(root, '.fleex.json');
      if (!existsSync(manifestPath)) {
        writeFileSync(manifestPath, JSON.stringify({ ticketId: ws.ticketId }, null, 2));
      }
    } catch (err) {
      this.logger.warn('Failed to write workspace manifest during reconcile', {
        workspaceId: ws.workspaceId, error: String(err),
      });
    }
  }
}
