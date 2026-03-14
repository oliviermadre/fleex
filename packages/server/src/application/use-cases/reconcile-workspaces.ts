import { join } from 'node:path';
import type { Workspace } from '@fleex/shared';
import type { RepoPathResolver } from '../../domain/services/repo-path-resolver.js';
import type { WorkspaceStorePort } from '../ports/workspace-store.port.js';
import type { CreateWorktreeUseCase } from './create-worktree.js';
import type { ConfigPort } from '../ports/config.port.js';
import type { GitPort } from '../ports/git.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { HostFs } from '../../infrastructure/host/types.js';
import type { EventBus } from '../event-bus.js';

export interface ReconcileWorkspacesResult {
  total: number;
  ok: number;
  repaired: number;
  orphaned: string[];
}

export class ReconcileWorkspacesUseCase {
  public eventBus: EventBus | null = null;

  constructor(
    private readonly workspaceStore: WorkspaceStorePort,
    private readonly repoPathResolver: RepoPathResolver,
    private readonly createWorktree: CreateWorktreeUseCase,
    private readonly git: GitPort,
    private readonly config: ConfigPort,
    private readonly hostFs: HostFs,
    private readonly logger: LoggerPort,
  ) {}

  async execute(): Promise<ReconcileWorkspacesResult> {
    const workspaces = await this.workspaceStore.getAll();
    const basePath = this.config.get().basePath;
    let ok = 0;
    let repaired = 0;
    const orphaned: string[] = [];

    for (const workspace of workspaces) {
      const result = await this.reconcileWorkspace(workspace, basePath);
      if (result === 'ok') ok++;
      else if (result === 'repaired') repaired++;
      else orphaned.push(workspace.ticketId);
    }

    // Scan for orphan directories in workspaces/
    await this.detectOrphans(basePath, workspaces, orphaned);

    return { total: workspaces.length, ok, repaired, orphaned };
  }

  private async reconcileWorkspace(
    workspace: Workspace,
    basePath: string,
  ): Promise<'ok' | 'repaired' | 'orphaned'> {
    let anyRepaired = false;
    let anyOrphaned = false;

    for (const repo of workspace.repos) {
      const wtPath = repo.bare
        ? join(basePath, 'workspaces', workspace.ticketId, repo.org, repo.name)
        : this.repoPathResolver.worktreePath(basePath, workspace.ticketId, repo.org, repo.name);

      // Check if worktree exists
      if (await this.hostFs.exists(wtPath)) continue;

      // Try to repair
      const resolved = await this.repoPathResolver.resolve(basePath, repo.org, repo.name);
      if (!resolved) {
        // Try to clone the bare repo
        try {
          const barePath = join(basePath, '.repos', repo.org, `${repo.name}.git`);
          const remote = `git@github.com:${repo.org}/${repo.name}.git`;
          await this.git.cloneBare(remote, barePath);
          await this.git.fetch(barePath);
          const newResolved = await this.repoPathResolver.resolve(basePath, repo.org, repo.name);
          if (!newResolved) {
            anyOrphaned = true;
            continue;
          }
          await this.recreateWorktree(newResolved.repoPath, wtPath, repo.branch, newResolved.envSourcePath);
          anyRepaired = true;
        } catch (err) {
          this.logger.warn('Failed to clone bare repo during reconciliation', {
            ticketId: workspace.ticketId, org: repo.org, name: repo.name,
            error: err instanceof Error ? err.message : String(err),
          });
          anyOrphaned = true;
        }
        continue;
      }

      // Repo exists, recreate worktree
      try {
        await this.recreateWorktree(resolved.repoPath, wtPath, repo.branch, resolved.envSourcePath);
        anyRepaired = true;
      } catch (err) {
        this.logger.warn('Failed to recreate worktree during reconciliation', {
          ticketId: workspace.ticketId, org: repo.org, name: repo.name,
          error: err instanceof Error ? err.message : String(err),
        });
        anyOrphaned = true;
      }
    }

    const ticketId = workspace.ticketId;

    if (anyOrphaned) {
      this.eventBus?.emit({
        type: 'workspace.reconciled',
        ticketId,
        status: 'orphaned',
        occurredAt: new Date(),
      });
      return 'orphaned';
    }
    if (anyRepaired) {
      this.eventBus?.emit({
        type: 'workspace.reconciled',
        ticketId,
        status: 'repaired',
        occurredAt: new Date(),
      });
      return 'repaired';
    }

    this.eventBus?.emit({
      type: 'workspace.reconciled',
      ticketId,
      status: 'ok',
      occurredAt: new Date(),
    });
    return 'ok';
  }

  private async recreateWorktree(
    repoPath: string,
    wtPath: string,
    branch: string,
    envSourcePath?: string,
  ): Promise<void> {
    // Ensure parent directories exist
    const parentDir = join(wtPath, '..');
    try { await this.hostFs.mkdir(parentDir); } catch { /* may already exist */ }

    await this.createWorktree.execute(repoPath, wtPath, {
      branch,
      createNewBranch: false,
    }, envSourcePath);
  }

  private async detectOrphans(
    basePath: string,
    workspaces: Workspace[],
    orphaned: string[],
  ): Promise<void> {
    const workspacesDir = join(basePath, 'workspaces');
    try {
      if (!(await this.hostFs.exists(workspacesDir))) return;
      const entries = await this.hostFs.readdir(workspacesDir);
      const knownTicketIds = new Set(workspaces.map((w) => w.ticketId));

      for (const entry of entries) {
        if (entry.isDirectory && !knownTicketIds.has(entry.name)) {
          if (!orphaned.includes(entry.name)) {
            orphaned.push(entry.name);
            this.logger.warn('Orphan workspace directory detected', {
              ticketId: entry.name,
              path: join(workspacesDir, entry.name),
            });
          }
        }
      }
    } catch {
      // workspaces dir doesn't exist or can't be read
    }
  }
}
