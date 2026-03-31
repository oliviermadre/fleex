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

    // Fetch before any operation
    await this.bareCloneManager.fetch(org, name);

    try {
      await this.git.createWorktree(
        barePath,
        wtPath,
        request.branch,
        request.createNewBranch,
        request.baseBranch,
      );
      this.logger.info('Worktree created', { barePath, wtPath, branch: request.branch });
      await this.applyOverlay(org, name, wtPath);
      const hookStarted = this.overlayManager.firePostCheckoutHooks(org, name, wtPath, request.branch);
      if (!hookStarted) {
        this.emitCreated(barePath, wtPath, request);
      }
      return { existingPath: null, hookStarted };
    } catch (err) {
      const stderr = (err as { stderr?: string }).stderr?.trim();
      const message = stderr || (err instanceof Error ? err.message : String(err));
      const reuseMatch = message.match(/is already used by worktree at '([^']+)'/);
      if (reuseMatch) {
        const existingPath = reuseMatch[1]!;
        this.logger.info('Worktree path claimed in use, removing old worktree', {
          barePath, existingPath, wtPath, branch: request.branch,
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
          barePath, wtPath, request.branch, request.createNewBranch, request.baseBranch,
        );
        this.logger.info('Worktree created after removing old worktree', { barePath, wtPath });
        await this.applyOverlay(org, name, wtPath);
        const hookStarted = this.overlayManager.firePostCheckoutHooks(org, name, wtPath, request.branch);
        if (!hookStarted) {
          this.emitCreated(barePath, wtPath, request);
        }
        return { existingPath: null, hookStarted };
      }
      const branchExistsMatch = message.match(/branch named '([^']+)' already exists/i);
      if (branchExistsMatch && request.createNewBranch) {
        this.logger.info('Branch already exists, checking out existing branch', {
          barePath, wtPath, branch: request.branch,
        });
        return this.executeWithHook(org, name, wtPath, { ...request, createNewBranch: false });
      }
      const checkedOutMatch = message.match(/is already checked out at '([^']+)'/);
      if (checkedOutMatch) {
        const existingPath = checkedOutMatch[1]!;
        this.logger.info('Branch already checked out elsewhere, replacing worktree', {
          barePath, existingPath, wtPath, branch: request.branch,
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
          request.branch,
          request.createNewBranch,
          request.baseBranch,
        );
        this.logger.info('Worktree replaced', { barePath, wtPath, branch: request.branch });
        await this.applyOverlay(org, name, wtPath);
        const hookStarted = this.overlayManager.firePostCheckoutHooks(org, name, wtPath, request.branch);
        if (!hookStarted) {
          this.emitCreated(barePath, wtPath, request);
        }
        return { existingPath: null, hookStarted };
      }
      const dirExistsMatch = message.match(/'([^']+)' already exists/);
      if (dirExistsMatch) {
        const existingPath = dirExistsMatch[1]!;
        this.logger.info('Worktree directory already exists, repairing and pruning', {
          barePath, existingPath, branch: request.branch,
        });
        try {
          await this.git.repairWorktrees(barePath);
          await this.git.pruneWorktrees(barePath);
        } catch {
          this.logger.warn('Worktree repair/prune failed, continuing anyway', { barePath, existingPath });
        }
        try {
          await this.git.createWorktree(
            barePath, wtPath, request.branch, request.createNewBranch, request.baseBranch,
          );
          this.logger.info('Worktree created after repair and prune', { barePath, wtPath });
          await this.applyOverlay(org, name, wtPath);
          const hookStarted = this.overlayManager.firePostCheckoutHooks(org, name, wtPath, request.branch);
          if (!hookStarted) {
            this.emitCreated(barePath, wtPath, request);
          }
          return { existingPath: null, hookStarted };
        } catch {
          this.logger.info('Worktree directory still valid, reusing', { barePath, existingPath });
          this.emitCreated(barePath, existingPath, request);
          return { existingPath, hookStarted: false };
        }
      }
      throw new WorktreeError(`Failed to create worktree: ${message}`);
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
