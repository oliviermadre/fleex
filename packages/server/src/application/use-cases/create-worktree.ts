import { rmSync } from 'node:fs';
import type { CreateWorktreeRequest, HookResult } from '@fleex/shared';
import { WorktreeError } from '../../domain/errors.js';
import type { EventBus } from '../event-bus.js';
import type { GitPort } from '../ports/git.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { BareCloneManager } from '../services/bare-clone-manager.js';
import type { OverlayManager } from '../services/overlay-manager.js';
import type { RepoPathResolver } from '../../domain/services/repo-path-resolver.js';

export interface CreateWorktreeResult {
  existingPath: string | null;
  hookStarted: boolean;
}

export class CreateWorktreeUseCase {
  public eventBus: EventBus | null = null;

  constructor(
    private readonly git: GitPort,
    private readonly logger: LoggerPort,
    private readonly bareCloneManager: BareCloneManager,
    private readonly overlayManager: OverlayManager,
    private readonly resolver: RepoPathResolver,
  ) {}

  async execute(org: string, name: string, wtPath: string, request: CreateWorktreeRequest): Promise<string | null> {
    const result = await this.executeWithHook(org, name, wtPath, request);
    return result.existingPath;
  }

  async executeWithHook(org: string, name: string, wtPath: string, request: CreateWorktreeRequest): Promise<CreateWorktreeResult> {
    const barePath = this.resolver.barePath(org, name);

    // Ensure bare clone exists and fetch latest refs
    await this.bareCloneManager.ensureBareClone(org, name);
    await this.bareCloneManager.fetch(org, name);

    // When creating a new branch without an explicit base, default to origin/<defaultBranch>
    // so the worktree reflects the latest remote state (bare clone HEAD is stale after fetch).
    let effectiveRequest = request;
    if (request.createNewBranch && !request.baseBranch) {
      const defaultBranch = await this.git.getDefaultBranch(barePath);
      effectiveRequest = { ...request, baseBranch: `origin/${defaultBranch}` };
    }

    try {
      await this.git.createWorktree(
        barePath,
        wtPath,
        effectiveRequest.branch,
        effectiveRequest.createNewBranch,
        effectiveRequest.baseBranch,
      );
      this.logger.info('Worktree created', { barePath, wtPath, branch: effectiveRequest.branch, baseBranch: effectiveRequest.baseBranch });
      await this.applyOverlay(org, name, wtPath);
      const hookStarted = this.overlayManager.firePostCheckoutHooks(org, name, wtPath, effectiveRequest.branch);
      if (!hookStarted) {
        this.emitCreated(barePath, wtPath, effectiveRequest);
      }
      return { existingPath: null, hookStarted };
    } catch (err) {
      const stderr = (err as { stderr?: string }).stderr?.trim();
      const message = stderr || (err instanceof Error ? err.message : String(err));
      const reuseMatch = message.match(/is already used by worktree at '([^']+)'/);
      if (reuseMatch) {
        const existingPath = reuseMatch[1]!;
        this.logger.info('Worktree path claimed in use, removing old worktree', {
          barePath, existingPath, wtPath, branch: effectiveRequest.branch,
        });
        // Force-remove the old worktree blocking the new path
        try {
          await this.git.removeWorktree(barePath, existingPath);
        } catch {
          this.logger.warn('git worktree remove failed, force-deleting old worktree', { existingPath });
          rmSync(existingPath, { recursive: true, force: true });
        }
        await this.git.pruneWorktrees(barePath);
        await this.git.createWorktree(
          barePath, wtPath, effectiveRequest.branch, effectiveRequest.createNewBranch, effectiveRequest.baseBranch,
        );
        this.logger.info('Worktree created after removing old worktree', { barePath, wtPath });
        await this.applyOverlay(org, name, wtPath);
        const hookStarted = this.overlayManager.firePostCheckoutHooks(org, name, wtPath, effectiveRequest.branch);
        if (!hookStarted) {
          this.emitCreated(barePath, wtPath, effectiveRequest);
        }
        return { existingPath: null, hookStarted };
      }
      const branchExistsMatch = message.match(/branch named '([^']+)' already exists/i);
      if (branchExistsMatch && effectiveRequest.createNewBranch) {
        await this.alignExistingBranch(org, name, barePath, effectiveRequest.branch, effectiveRequest.baseBranch, request.baseBranch);
        this.logger.info('Branch already exists, checking out existing branch', {
          barePath, wtPath, branch: effectiveRequest.branch,
        });
        return this.executeWithHook(org, name, wtPath, { ...effectiveRequest, createNewBranch: false });
      }
      const checkedOutMatch = message.match(/is already checked out at '([^']+)'/);
      if (checkedOutMatch) {
        const existingPath = checkedOutMatch[1]!;
        this.logger.info('Branch already checked out elsewhere, replacing worktree', {
          barePath, existingPath, wtPath, branch: effectiveRequest.branch,
        });
        await this.git.pruneWorktrees(barePath);
        try {
          await this.git.removeWorktree(barePath, existingPath);
        } catch {
          // git worktree remove failed (dirty worktree, etc.) — force-delete directory and prune
          this.logger.warn('git worktree remove failed, force-deleting old worktree', { existingPath });
          rmSync(existingPath, { recursive: true, force: true });
          await this.git.pruneWorktrees(barePath);
        }
        await this.git.createWorktree(
          barePath,
          wtPath,
          effectiveRequest.branch,
          effectiveRequest.createNewBranch,
          effectiveRequest.baseBranch,
        );
        this.logger.info('Worktree replaced', { barePath, wtPath, branch: effectiveRequest.branch });
        await this.applyOverlay(org, name, wtPath);
        const hookStarted = this.overlayManager.firePostCheckoutHooks(org, name, wtPath, effectiveRequest.branch);
        if (!hookStarted) {
          this.emitCreated(barePath, wtPath, effectiveRequest);
        }
        return { existingPath: null, hookStarted };
      }
      const dirExistsMatch = message.match(/'([^']+)' already exists/);
      if (dirExistsMatch) {
        const existingPath = dirExistsMatch[1]!;
        this.logger.info('Worktree directory already exists, repairing and pruning', {
          barePath, existingPath, branch: effectiveRequest.branch,
        });
        try {
          await this.git.repairWorktrees(barePath);
          await this.git.pruneWorktrees(barePath);
        } catch {
          this.logger.warn('Worktree repair/prune failed, continuing anyway', { barePath, existingPath });
        }
        try {
          await this.git.createWorktree(
            barePath, wtPath, effectiveRequest.branch, effectiveRequest.createNewBranch, effectiveRequest.baseBranch,
          );
          this.logger.info('Worktree created after repair and prune', { barePath, wtPath });
          await this.applyOverlay(org, name, wtPath);
          const hookStarted = this.overlayManager.firePostCheckoutHooks(org, name, wtPath, effectiveRequest.branch);
          if (!hookStarted) {
            this.emitCreated(barePath, wtPath, effectiveRequest);
          }
          return { existingPath: null, hookStarted };
        } catch {
          this.logger.info('Worktree directory still valid, reusing', { barePath, existingPath });
          this.emitCreated(barePath, existingPath, effectiveRequest);
          return { existingPath, hookStarted: false };
        }
      }
      // Branch doesn't exist locally — for fork PRs, the branch lives on the
      // contributor's fork and is only available via refs/pull/<number>/head.
      // Fetch the PR ref into a local tracking branch and retry.
      if (request.prNumber && (message.includes('invalid reference') || message.includes('not a valid object name'))) {
        const prRef = `refs/pull/${request.prNumber}/head:refs/remotes/origin/${effectiveRequest.branch}`;
        this.logger.info('Branch not found, fetching PR ref', {
          barePath, prNumber: request.prNumber, refspec: prRef,
        });
        try {
          await this.git.fetchRef(barePath, prRef);
          // Now retry — the branch exists as origin/<branch>, git will auto-track it
          await this.git.createWorktree(
            barePath, wtPath, effectiveRequest.branch, false,
          );
          this.logger.info('Worktree created from PR ref', { barePath, wtPath, branch: effectiveRequest.branch });
          await this.applyOverlay(org, name, wtPath);
          const hookStarted = this.overlayManager.firePostCheckoutHooks(org, name, wtPath, effectiveRequest.branch);
          if (!hookStarted) {
            this.emitCreated(barePath, wtPath, effectiveRequest);
          }
          return { existingPath: null, hookStarted };
        } catch (prFetchErr) {
          this.logger.warn('Failed to fetch PR ref', {
            barePath, prNumber: request.prNumber,
            error: prFetchErr instanceof Error ? prFetchErr.message : String(prFetchErr),
          });
        }
      }
      // A custom base branch that git can't resolve means the branch the ticket
      // was derived from is gone from origin (e.g. the parent PR was merged and
      // its branch deleted). Fail loud with an actionable message — NEVER fall
      // back to the default branch, which would silently produce work against
      // the wrong base (D7).
      if (
        request.baseBranch &&
        (message.includes('invalid reference') ||
          message.includes('not a valid object name') ||
          message.includes(request.baseBranch))
      ) {
        const bareBase = request.baseBranch.replace(/^origin\//, '');
        throw new WorktreeError(
          `Base branch '${bareBase}' not found on origin for ${org}/${name}. ` +
            `Edit the ticket's base branch.`,
        );
      }
      throw new WorktreeError(`Failed to create worktree: ${message}`);
    }
  }

  /**
   * A ticket branch outlives its worktree (unlinking a repo keeps the branch), so
   * "create it from <base>" can find it already there. Before it is checked out:
   * - no commits of its own → it is a mere pointer: move it onto `base`, even if
   *   it already contains `base` (agent/550 contains main, yet isn't main);
   * - commits of its own that don't contain a custom base → fail loud (D7),
   *   never check the work out on the wrong base;
   * - otherwise → resume it as is.
   */
  private async alignExistingBranch(
    org: string,
    name: string,
    barePath: string,
    branch: string,
    base: string | undefined,
    customBase: string | undefined,
  ): Promise<void> {
    const ownCommits = await this.git.countOwnCommits(barePath, branch);
    if (ownCommits === 0) {
      if (!base) return;
      this.logger.info('Existing branch has no commits of its own, moving it onto the requested base', {
        barePath, branch, base,
      });
      try {
        await this.git.forceBranch(barePath, branch, base);
      } catch (err) {
        const stderr = (err as { stderr?: string }).stderr?.trim();
        throw new WorktreeError(`Failed to move branch '${branch}' onto '${base}': ${stderr || String(err)}`);
      }
      return;
    }
    if (customBase && !(await this.git.isAncestor(barePath, customBase, branch))) {
      const bareBase = customBase.replace(/^origin\//, '');
      throw new WorktreeError(
        `Branch '${branch}' already exists in ${org}/${name} with ${ownCommits} commit(s) of its own ` +
          `that are not based on '${bareBase}'. Push or delete that branch before deriving it from '${bareBase}'.`,
      );
    }
  }

  private emitCreated(barePath: string, worktreePath: string, request: CreateWorktreeRequest, hookResult?: HookResult): void {
    this.eventBus?.emit({
      type: 'worktree.created',
      repoPath: barePath,
      worktreePath,
      branch: request.branch,
      isNewBranch: request.createNewBranch,
      hookResult,
      occurredAt: new Date(),
    });
  }

  private async applyOverlay(org: string, name: string, wtPath: string): Promise<void> {
    try {
      await this.overlayManager.applyOverlay(org, name, wtPath);
    } catch {
      this.logger.warn('Failed to apply overlay to worktree', { org, name, wtPath });
    }
  }
}
