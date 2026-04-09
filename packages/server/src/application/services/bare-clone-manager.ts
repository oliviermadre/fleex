import type { GitPort } from '../ports/git.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { HostFs, ExecFn } from '../../infrastructure/host/types.js';
import type { RepoPathResolver } from '../../domain/services/repo-path-resolver.js';
import type { OverlayManager } from './overlay-manager.js';

export class BareCloneManager {
  constructor(
    private readonly git: GitPort,
    private readonly hostFs: HostFs,
    private readonly resolver: RepoPathResolver,
    private readonly execFn: ExecFn,
    private readonly logger: LoggerPort,
    private readonly overlayManager: OverlayManager,
  ) {}

  /**
   * Ensure a bare clone exists for the given repo.
   * If missing, clones from remote. Returns the bare clone path.
   */
  async ensureBareClone(org: string, name: string, remote?: string): Promise<string> {
    const barePath = this.resolver.barePath(org, name);
    const exists = await this.hostFs.exists(barePath);
    if (exists) return barePath;

    const resolvedRemote = remote ?? `git@github.com:${org}/${name}.git`;
    this.logger.info('Creating bare clone', { org, name, remote: resolvedRemote, barePath });

    // Ensure parent directory exists
    const orgDir = this.resolver.bareOrgDir(org);
    if (!(await this.hostFs.exists(orgDir))) {
      await this.hostFs.mkdir(orgDir);
    }

    await this.git.cloneBare(resolvedRemote, barePath);

    // Configure fetch refspec so that `origin/*` refs work properly.
    // By default, bare clones may not set up the remote tracking refspec.
    await this.execFn(
      'git', ['config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*'],
      { cwd: barePath },
    );

    // Initial fetch to populate remote refs
    await this.execFn('git', ['fetch', '--prune', 'origin'], { cwd: barePath });

    // Scaffold overlay directories for this repo (+ global)
    await this.overlayManager.ensureOverlayDirs(org, name);

    this.logger.info('Bare clone created', { org, name, barePath });
    return barePath;
  }

  /**
   * Fetch latest changes for a bare clone. Called before any git operation.
   */
  async fetch(org: string, name: string): Promise<void> {
    const barePath = this.resolver.barePath(org, name);
    const exists = await this.hostFs.exists(barePath);
    if (!exists) {
      this.logger.warn('Bare clone not found for fetch', { org, name, barePath });
      return;
    }
    try {
      await this.git.fetch(barePath);
    } catch {
      this.logger.warn('Failed to fetch bare clone', { org, name, barePath });
    }
  }

  /**
   * Sync bare clones with the configured repository list.
   * Creates missing clones and removes stale ones.
   */
  async syncWithConfig(repos: { org: string; name: string }[]): Promise<void> {
    const configuredSet = new Set(repos.map((r) => `${r.org}/${r.name}`));

    // Ensure each configured repo has a bare clone
    for (const { org, name } of repos) {
      try {
        await this.ensureBareClone(org, name);
      } catch (err) {
        this.logger.warn('Failed to ensure bare clone during sync', {
          org, name, error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Remove bare clones not in the configured list
    const existing = await this.listBareClones();
    for (const { org, name } of existing) {
      if (!configuredSet.has(`${org}/${name}`)) {
        this.logger.info('Removing stale bare clone', { org, name });
        try {
          await this.removeBareClone(org, name);
        } catch (err) {
          this.logger.warn('Failed to remove stale bare clone', {
            org, name, error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }

  /**
   * Remove a bare clone and its directory.
   */
  async removeBareClone(org: string, name: string): Promise<void> {
    const barePath = this.resolver.barePath(org, name);
    await this.hostFs.rm(barePath, { recursive: true });
    this.logger.info('Bare clone removed', { org, name, barePath });
  }

  /**
   * Scan .bare/ to discover all existing bare clones.
   */
  async listBareClones(): Promise<{ org: string; name: string }[]> {
    const bareRoot = this.resolver.bareRootDir();
    if (!(await this.hostFs.exists(bareRoot))) return [];

    const result: { org: string; name: string }[] = [];
    const orgs = await this.hostFs.readdir(bareRoot);

    for (const orgEntry of orgs) {
      if (!orgEntry.isDirectory) continue;
      const orgPath = `${bareRoot}/${orgEntry.name}`;
      const repos = await this.hostFs.readdir(orgPath);
      for (const repoEntry of repos) {
        if (!repoEntry.isDirectory || !repoEntry.name.endsWith('.git')) continue;
        const name = repoEntry.name.slice(0, -4); // strip .git
        result.push({ org: orgEntry.name, name });
      }
    }

    return result;
  }
}
