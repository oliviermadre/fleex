import type { CreateWorktreeRequest, HookResult } from '@fleex/shared';
import { WorktreeError } from '../../domain/errors.js';
import type { EventBus } from '../event-bus.js';
import type { GitPort } from '../ports/git.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { ConfigPort } from '../ports/config.port.js';
import type { ExecFn } from '../../infrastructure/host/types.js';

const DEFAULT_HOOK_TIMEOUT_SECONDS = 60;

export interface CreateWorktreeResult {
  existingPath: string | null;
  hookStarted: boolean;
}

export class CreateWorktreeUseCase {
  public eventBus: EventBus | null = null;
  public configPort: ConfigPort | null = null;
  public execFn: ExecFn | null = null;

  constructor(
    private readonly git: GitPort,
    private readonly logger: LoggerPort,
  ) {}

  async execute(repoPath: string, wtPath: string, request: CreateWorktreeRequest): Promise<string | null> {
    const result = await this.executeWithHook(repoPath, wtPath, request);
    return result.existingPath;
  }

  async executeWithHook(repoPath: string, wtPath: string, request: CreateWorktreeRequest): Promise<CreateWorktreeResult> {
    try {
      await this.git.fetch(repoPath);
    } catch {
      this.logger.warn('Failed to fetch before worktree creation', { repoPath });
    }

    try {
      await this.git.createWorktree(
        repoPath,
        wtPath,
        request.branch,
        request.createNewBranch,
        request.baseBranch,
      );
      this.logger.info('Worktree created', { repoPath, wtPath, branch: request.branch });
      await this.copyIgnoredFiles(repoPath, wtPath);
      const hookStarted = this.firePostCheckoutHook(repoPath, wtPath, request);
      if (!hookStarted) {
        this.emitCreated(repoPath, wtPath, request);
      }
      return { existingPath: null, hookStarted };
    } catch (err) {
      const stderr = (err as { stderr?: string }).stderr?.trim();
      const message = stderr || (err instanceof Error ? err.message : String(err));
      const reuseMatch = message.match(/is already used by worktree at '([^']+)'/);
      if (reuseMatch) {
        const existingPath = reuseMatch[1]!;
        this.logger.info('Worktree path claimed in use, pruning stale entries', {
          repoPath, existingPath, branch: request.branch,
        });
        try {
          await this.git.pruneWorktrees(repoPath);
          await this.git.createWorktree(
            repoPath, wtPath, request.branch, request.createNewBranch, request.baseBranch,
          );
          this.logger.info('Worktree created after pruning stale entry', { repoPath, wtPath });
          await this.copyIgnoredFiles(repoPath, wtPath);
          const hookStarted = this.firePostCheckoutHook(repoPath, wtPath, request);
          if (!hookStarted) {
            this.emitCreated(repoPath, wtPath, request);
          }
          return { existingPath: null, hookStarted };
        } catch {
          this.logger.info('Worktree still valid after prune, reusing', { repoPath, existingPath });
          this.emitCreated(repoPath, existingPath, request);
          return { existingPath, hookStarted: false };
        }
      }
      const branchExistsMatch = message.match(/branch named '([^']+)' already exists/i);
      if (branchExistsMatch && request.createNewBranch) {
        this.logger.info('Branch already exists, checking out existing branch', {
          repoPath, wtPath, branch: request.branch,
        });
        return this.executeWithHook(repoPath, wtPath, { ...request, createNewBranch: false });
      }
      const checkedOutMatch = message.match(/is already checked out at '([^']+)'/);
      if (checkedOutMatch) {
        const existingPath = checkedOutMatch[1]!;
        this.logger.info('Branch already checked out elsewhere, replacing worktree', {
          repoPath, existingPath, wtPath, branch: request.branch,
        });
        await this.git.pruneWorktrees(repoPath);
        try {
          await this.git.removeWorktree(repoPath, existingPath);
        } catch {
          this.logger.warn('Could not remove stale worktree, continuing after prune', { existingPath });
        }
        await this.git.createWorktree(
          repoPath,
          wtPath,
          request.branch,
          request.createNewBranch,
          request.baseBranch,
        );
        this.logger.info('Worktree replaced', { repoPath, wtPath, branch: request.branch });
        await this.copyIgnoredFiles(repoPath, wtPath);
        const hookStarted = this.firePostCheckoutHook(repoPath, wtPath, request);
        if (!hookStarted) {
          this.emitCreated(repoPath, wtPath, request);
        }
        return { existingPath: null, hookStarted };
      }
      const dirExistsMatch = message.match(/'([^']+)' already exists/);
      if (dirExistsMatch) {
        const existingPath = dirExistsMatch[1]!;
        this.logger.info('Worktree directory already exists, repairing and pruning', {
          repoPath, existingPath, branch: request.branch,
        });
        try {
          await this.git.repairWorktrees(repoPath);
          await this.git.pruneWorktrees(repoPath);
        } catch {
          this.logger.warn('Worktree repair/prune failed, continuing anyway', { repoPath, existingPath });
        }
        try {
          await this.git.createWorktree(
            repoPath, wtPath, request.branch, request.createNewBranch, request.baseBranch,
          );
          this.logger.info('Worktree created after repair and prune', { repoPath, wtPath });
          await this.copyIgnoredFiles(repoPath, wtPath);
          const hookStarted = this.firePostCheckoutHook(repoPath, wtPath, request);
          if (!hookStarted) {
            this.emitCreated(repoPath, wtPath, request);
          }
          return { existingPath: null, hookStarted };
        } catch {
          this.logger.info('Worktree directory still valid, reusing', { repoPath, existingPath });
          this.emitCreated(repoPath, existingPath, request);
          return { existingPath, hookStarted: false };
        }
      }
      throw new WorktreeError(`Failed to create worktree: ${message}`);
    }
  }

  private emitCreated(repoPath: string, worktreePath: string, request: CreateWorktreeRequest, hookResult?: HookResult): void {
    this.eventBus?.emit({
      type: 'worktree.created',
      repoPath,
      worktreePath,
      branch: request.branch,
      isNewBranch: request.createNewBranch,
      hookResult,
      occurredAt: new Date(),
    });
  }

  private async copyIgnoredFiles(repoPath: string, wtPath: string): Promise<void> {
    try {
      await this.git.copyIgnoredFiles(repoPath, wtPath);
      this.logger.info('Copied ignored files to worktree', { repoPath, wtPath });
    } catch {
      this.logger.warn('Failed to copy ignored files to worktree', { repoPath, wtPath });
    }
  }

  /**
   * Resolve repo config for the given repoPath.
   */
  private resolveRepoConfig(repoPath: string): { org: string; repoName: string; repoKey: string; script: string; timeoutMs: number } | null {
    if (!this.configPort) return null;

    const config = this.configPort.get();
    const repoConfigs = config.repoConfigs;
    if (!repoConfigs) return null;

    const basePath = config.basePath;
    const relative = repoPath.startsWith(basePath)
      ? repoPath.slice(basePath.length).replace(/^\//, '')
      : '';
    const parts = relative.split('/').filter(Boolean);
    if (parts.length < 2) return null;

    const org = parts[0]!;
    const repoName = parts[1]!;
    const repoKey = `${org}/${repoName}`;

    const repoConfig = repoConfigs[repoKey];
    const script = repoConfig?.postCheckoutHook?.trim();
    if (!script) return null;

    const timeoutSeconds = repoConfig?.hookTimeoutSeconds ?? DEFAULT_HOOK_TIMEOUT_SECONDS;
    const timeoutMs = timeoutSeconds * 1000;

    return { org, repoName, repoKey, script, timeoutMs };
  }

  /**
   * Fire the post-checkout hook in the background (fire-and-forget).
   * Returns true if a hook was started, false if no hook configured.
   * The hook runs asynchronously — the API response is NOT blocked.
   */
  private firePostCheckoutHook(
    repoPath: string,
    wtPath: string,
    request: CreateWorktreeRequest,
  ): boolean {
    if (!this.execFn) return false;

    const resolved = this.resolveRepoConfig(repoPath);
    if (!resolved) return false;

    const { org, repoName, repoKey, script, timeoutMs } = resolved;
    const execFn = this.execFn;

    // Interpolate template variables
    const interpolated = script
      .replace(/\{\{org\}\}/g, org)
      .replace(/\{\{repo\}\}/g, repoName)
      .replace(/\{\{branch\}\}/g, request.branch)
      .replace(/\{\{worktree_path\}\}/g, wtPath);

    this.logger.info('Starting post-checkout hook (async)', { repoKey, wtPath, timeoutMs });

    // Fire and forget — runs in background, does not block API response
    const startTime = Date.now();
    execFn('bash', ['-c', interpolated], { cwd: wtPath, timeout: timeoutMs })
      .then((result) => {
        const durationMs = Date.now() - startTime;
        this.logger.info('Post-checkout hook completed', { repoKey, wtPath, exitCode: 0, durationMs });
        this.emitCreated(repoPath, wtPath, request, {
          ran: true, exitCode: 0, stdout: result.stdout, stderr: result.stderr, durationMs,
        });
      })
      .catch((err) => {
        const durationMs = Date.now() - startTime;
        const exitCode = (err as { exitCode?: number }).exitCode ?? 1;
        const stdout = (err as { stdout?: string }).stdout ?? '';
        const stderr = (err as { stderr?: string }).stderr ?? (err instanceof Error ? err.message : String(err));
        this.logger.warn('Post-checkout hook failed', { repoKey, wtPath, exitCode, stderr, durationMs });
        this.emitCreated(repoPath, wtPath, request, {
          ran: true, exitCode, stdout, stderr, durationMs,
        });
      });

    return true;
  }
}
