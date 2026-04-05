import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export class RepoPathResolver {
  constructor(private readonly basePath: string) {}

  /** Bare clone location: .bare/org/name.git */
  barePath(org: string, name: string): string {
    return join(this.basePath, '.bare', org, `${name}.git`);
  }

  /** Parent directory for an org's bare clones */
  bareOrgDir(org: string): string {
    return join(this.basePath, '.bare', org);
  }

  /** Root of all bare clones */
  bareRootDir(): string {
    return join(this.basePath, '.bare');
  }

  /** Per-repo overlay root: overlays/org/name */
  overlayDir(org: string, name: string): string {
    return join(this.basePath, 'overlays', org, name);
  }

  /** Files to copy into worktrees: overlays/org/name/files */
  overlayFilesDir(org: string, name: string): string {
    return join(this.basePath, 'overlays', org, name, 'files');
  }

  /** Hook scripts: overlays/org/name/hooks */
  overlayHooksDir(org: string, name: string): string {
    return join(this.basePath, 'overlays', org, name, 'hooks');
  }

  /** Global overlay root: overlays/_global */
  globalOverlayDir(): string {
    return join(this.basePath, 'overlays', '_global');
  }

  /** Global files to copy into all worktrees: overlays/_global/files */
  globalOverlayFilesDir(): string {
    return join(this.basePath, 'overlays', '_global', 'files');
  }

  /** Global hook scripts for all repos: overlays/_global/hooks */
  globalOverlayHooksDir(): string {
    return join(this.basePath, 'overlays', '_global', 'hooks');
  }

  /** Standalone worktree: worktrees/org/dirName */
  worktreeDir(org: string, dirName: string): string {
    return join(this.basePath, 'worktrees', org, dirName);
  }

  /** Parent directory for an org's worktrees */
  worktreeOrgDir(org: string): string {
    return join(this.basePath, 'worktrees', org);
  }

  /** Workspace root for a ticket: workspaces/workspaceId */
  workspacePath(workspaceId: string): string {
    return join(this.basePath, 'workspaces', workspaceId);
  }

  /** Worktree within a workspace: workspaces/workspaceId/repoName */
  workspaceRepoPath(workspaceId: string, repoName: string): string {
    return join(this.basePath, 'workspaces', workspaceId, repoName);
  }

  /** Root of all workspaces */
  workspacesRoot(): string {
    return join(this.basePath, 'workspaces');
  }

  /**
   * Walk up from cwd looking for .fleex.json under workspaces/.
   * Returns { ticketId } or null if cwd is not inside a workspace.
   */
  resolveManifest(cwd: string): { ticketId: string } | null {
    const root = this.workspacesRoot();
    if (!cwd.startsWith(root)) return null;
    let dir = cwd;
    while (dir.startsWith(root) && dir !== root) {
      const manifest = join(dir, '.fleex.json');
      if (existsSync(manifest)) {
        try {
          return JSON.parse(readFileSync(manifest, 'utf-8'));
        } catch {
          return null;
        }
      }
      dir = dirname(dir);
    }
    return null;
  }
}
