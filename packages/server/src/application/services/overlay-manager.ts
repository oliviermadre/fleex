import type { LoggerPort } from '../ports/logger.port.js';
import type { ConfigPort } from '../ports/config.port.js';
import type { HostFs, ExecFn } from '../../infrastructure/host/types.js';
import type { RepoPathResolver } from '../../domain/services/repo-path-resolver.js';
import type { HookResult } from '@fleex/shared';

const DEFAULT_HOOK_TIMEOUT_SECONDS = 60;

export class OverlayManager {
  constructor(
    private readonly hostFs: HostFs,
    private readonly resolver: RepoPathResolver,
    private readonly execFn: ExecFn,
    private readonly config: ConfigPort,
    private readonly logger: LoggerPort,
  ) {}

  /**
   * Copy overlay files into a worktree.
   * Copies everything from overlays/org/name/files/ into worktreePath.
   */
  async applyOverlay(org: string, name: string, worktreePath: string): Promise<void> {
    const filesDir = this.resolver.overlayFilesDir(org, name);
    const exists = await this.hostFs.exists(filesDir);
    if (!exists) return;

    try {
      // Use cp -rT to copy contents (not the directory itself) into worktree
      // -T treats destination as a normal file (avoids creating files/ subdirectory)
      await this.execFn('cp', ['-r', `${filesDir}/.`, worktreePath]);
      this.logger.info('Applied overlay files to worktree', { org, name, worktreePath });
    } catch (err) {
      this.logger.warn('Failed to apply overlay files', {
        org, name, worktreePath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Run post-checkout hooks for a repo after worktree creation.
   * Checks both file-based hooks (overlays/org/name/hooks/) and inline config hooks.
   * Returns HookResult if a hook ran, null otherwise.
   */
  firePostCheckoutHooks(
    org: string,
    name: string,
    worktreePath: string,
    branch: string,
  ): boolean {
    const repoKey = `${org}/${name}`;

    // 1. Check for file-based hooks
    const hooksDir = this.resolver.overlayHooksDir(org, name);
    this.runFileHooks(hooksDir, org, name, worktreePath, branch);

    // 2. Check for inline config hook
    const appConfig = this.config.get();
    const repoConfig = appConfig.repoConfigs?.[repoKey];
    const script = repoConfig?.postCheckoutHook?.trim();
    if (!script) return false;

    const timeoutSeconds = repoConfig?.hookTimeoutSeconds ?? DEFAULT_HOOK_TIMEOUT_SECONDS;
    const timeoutMs = timeoutSeconds * 1000;

    const interpolated = script
      .replace(/\{\{org\}\}/g, org)
      .replace(/\{\{repo\}\}/g, name)
      .replace(/\{\{branch\}\}/g, branch)
      .replace(/\{\{worktree_path\}\}/g, worktreePath);

    this.logger.info('Starting post-checkout hook (async)', { repoKey, worktreePath, timeoutMs });

    // Fire and forget
    this.execFn('bash', ['-c', interpolated], { cwd: worktreePath, timeout: timeoutMs })
      .then(() => {
        this.logger.info('Post-checkout hook completed', { repoKey, worktreePath });
      })
      .catch((err) => {
        const stderr = (err as { stderr?: string }).stderr ?? (err instanceof Error ? err.message : String(err));
        this.logger.warn('Post-checkout hook failed', { repoKey, worktreePath, stderr });
      });

    return true;
  }

  /**
   * Run file-based hooks from the hooks directory (fire-and-forget).
   */
  private runFileHooks(
    hooksDir: string,
    org: string,
    name: string,
    worktreePath: string,
    branch: string,
  ): void {
    // Fire and forget — async discovery and execution
    (async () => {
      const exists = await this.hostFs.exists(hooksDir);
      if (!exists) return;

      const entries = await this.hostFs.readdir(hooksDir);
      const scripts = entries.filter((e) => e.isFile).sort((a, b) => a.name.localeCompare(b.name));
      if (scripts.length === 0) return;

      const appConfig = this.config.get();
      const repoConfig = appConfig.repoConfigs?.[`${org}/${name}`];
      const timeoutMs = (repoConfig?.hookTimeoutSeconds ?? DEFAULT_HOOK_TIMEOUT_SECONDS) * 1000;

      for (const script of scripts) {
        const scriptPath = `${hooksDir}/${script.name}`;
        this.logger.info('Running hook script', { scriptPath, worktreePath });
        try {
          await this.execFn('bash', [scriptPath], {
            cwd: worktreePath,
            timeout: timeoutMs,
          });
          this.logger.info('Hook script completed', { scriptPath });
        } catch (err) {
          const stderr = (err as { stderr?: string }).stderr ?? (err instanceof Error ? err.message : String(err));
          this.logger.warn('Hook script failed', { scriptPath, stderr });
        }
      }
    })().catch((err) => {
      this.logger.warn('Failed to run file hooks', {
        org, name, error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  /**
   * List overlay files for a repo (for UI display).
   */
  async listOverlayFiles(org: string, name: string): Promise<string[]> {
    const filesDir = this.resolver.overlayFilesDir(org, name);
    const exists = await this.hostFs.exists(filesDir);
    if (!exists) return [];

    const entries = await this.hostFs.readdir(filesDir);
    return entries.filter((e) => e.isFile).map((e) => e.name);
  }
}
