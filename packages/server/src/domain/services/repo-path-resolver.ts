import { join } from 'node:path';

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
}
