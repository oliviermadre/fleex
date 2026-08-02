import { mkdirSync } from 'node:fs';
import { basename, dirname } from 'node:path';

import type { DiffStats, GitRemoteInfo, Worktree } from '@fleex/shared';

import type { GitPort } from '../../application/ports/git.port.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';
import type { ExecFn } from '../host/types.js';

export class GitCliAdapter implements GitPort {
  constructor(
    private readonly execFn: ExecFn,
    private readonly logger: LoggerPort,
  ) {}

  async getInfo(cwd: string): Promise<GitRemoteInfo> {
    const { stdout: remoteUrl } = await this.execFn('git', ['remote', 'get-url', 'origin'], {
      cwd,
    });

    const { stdout: branchOut } = await this.execFn('git', ['branch', '--show-current'], { cwd });

    const remote = remoteUrl.trim();
    const branch = branchOut.trim();

    const { org, name } = this.parseRemoteUrl(remote);

    // Detect if we're in a worktree
    let isWorktree = false;
    let mainWorktreePath = cwd;
    try {
      const { stdout: topLevel } = await this.execFn('git', ['rev-parse', '--show-toplevel'], {
        cwd,
      });
      const { stdout: commonDir } = await this.execFn('git', ['rev-parse', '--git-common-dir'], {
        cwd,
      });

      const commonDirResolved = commonDir.trim();
      if (commonDirResolved !== '.git' && !commonDirResolved.endsWith('/.git')) {
        isWorktree = true;
        // The common dir is the .git dir of the main worktree
        mainWorktreePath = dirname(commonDirResolved);
      } else {
        mainWorktreePath = topLevel.trim();
      }
    } catch {
      // ignore
    }

    return { org, name, remote, branch, isWorktree, mainWorktreePath };
  }

  async listBranches(repoPath: string): Promise<string[]> {
    const { stdout } = await this.execFn('git', ['branch', '-a', '--format=%(refname:short)'], {
      cwd: repoPath,
    });

    return stdout
      .trim()
      .split('\n')
      .filter((b) => b.length > 0);
  }

  async listWorktrees(repoPath: string): Promise<Worktree[]> {
    const { stdout } = await this.execFn('git', ['worktree', 'list', '--porcelain'], {
      cwd: repoPath,
    });

    const worktrees: Worktree[] = [];
    const blocks = stdout.split('\n\n').filter((b) => b.trim().length > 0);

    for (const block of blocks) {
      const lines = block.split('\n');
      let path = '';
      let branch = '';
      let isBare = false;

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          path = line.slice('worktree '.length);
        } else if (line.startsWith('branch ')) {
          branch = line.slice('branch '.length).replace('refs/heads/', '');
        } else if (line === 'bare') {
          isBare = true;
        }
      }

      if (path) {
        worktrees.push({
          path,
          branch: branch || basename(path),
          isMain: worktrees.length === 0,
          isBare,
        });
      }
    }

    return worktrees;
  }

  async createWorktree(
    repoPath: string,
    wtPath: string,
    branch: string,
    createNew: boolean,
    base?: string,
  ): Promise<void> {
    const args = ['worktree', 'add'];
    if (createNew) {
      args.push('-b', branch, wtPath);
      if (base) {
        args.push(base);
      }
    } else {
      args.push(wtPath, branch);
    }

    // Ensure parent directory exists (git worktree add doesn't create nested parents)
    mkdirSync(dirname(wtPath), { recursive: true });

    await this.execFn('git', args, { cwd: repoPath });
    this.logger.debug('Worktree created', { repoPath, wtPath, branch });
  }

  async removeWorktree(repoPath: string, wtPath: string): Promise<void> {
    await this.execFn('git', ['worktree', 'remove', '--force', wtPath], {
      cwd: repoPath,
    });
    this.logger.debug('Worktree removed', { repoPath, wtPath });
  }

  async moveWorktree(repoPath: string, wtPath: string, newPath: string): Promise<void> {
    mkdirSync(dirname(newPath), { recursive: true });
    await this.execFn('git', ['worktree', 'move', wtPath, newPath], {
      cwd: repoPath,
    });
    this.logger.debug('Worktree moved', { repoPath, from: wtPath, to: newPath });
  }

  async getDefaultBranch(repoPath: string): Promise<string> {
    try {
      const { stdout } = await this.execFn('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], {
        cwd: repoPath,
      });
      return stdout.trim().replace('refs/remotes/origin/', '');
    } catch {
      // Fallback: check for common default branch names
      const branches = await this.listBranches(repoPath);
      if (branches.includes('main')) return 'main';
      if (branches.includes('master')) return 'master';
      return branches[0] ?? 'main';
    }
  }

  async fetch(repoPath: string): Promise<void> {
    await this.execFn('git', ['fetch', '--prune'], { cwd: repoPath });
    this.logger.debug('Git fetch completed', { repoPath });
  }

  async fetchRef(repoPath: string, refspec: string): Promise<void> {
    await this.execFn('git', ['fetch', 'origin', refspec], { cwd: repoPath });
    this.logger.debug('Git fetch ref completed', { repoPath, refspec });
  }

  async cloneBare(remote: string, barePath: string): Promise<void> {
    await this.execFn('git', ['clone', '--bare', remote, barePath], { timeout: 120_000 });
    this.logger.debug('Bare clone created', { remote, barePath });
  }

  async getDiffStats(repoPath: string, branch: string, baseBranch?: string): Promise<DiffStats> {
    const base = baseBranch ?? `origin/${await this.getDefaultBranch(repoPath)}`;
    const timeout = 10_000;

    let commitsAhead = 0;
    let commitsBehind = 0;
    try {
      const { stdout } = await this.execFn(
        'git',
        ['rev-list', '--left-right', '--count', `${base}...${branch}`],
        { cwd: repoPath, timeout },
      );
      const parts = stdout.trim().split(/\s+/);
      commitsBehind = parseInt(parts[0] ?? '0', 10) || 0;
      commitsAhead = parseInt(parts[1] ?? '0', 10) || 0;
    } catch {
      this.logger.debug('Failed to get rev-list counts', { repoPath, branch, base });
    }

    let filesChanged = 0;
    let additions = 0;
    let deletions = 0;
    try {
      const { stdout } = await this.execFn('git', ['diff', '--shortstat', `${base}...${branch}`], {
        cwd: repoPath,
        timeout,
      });
      const stat = stdout.trim();
      const filesMatch = /(\d+)\s+file/.exec(stat);
      const insertMatch = /(\d+)\s+insertion/.exec(stat);
      const deleteMatch = /(\d+)\s+deletion/.exec(stat);
      filesChanged = parseInt(filesMatch?.[1] ?? '0', 10) || 0;
      additions = parseInt(insertMatch?.[1] ?? '0', 10) || 0;
      deletions = parseInt(deleteMatch?.[1] ?? '0', 10) || 0;
    } catch {
      this.logger.debug('Failed to get diff shortstat', { repoPath, branch, base });
    }

    return { commitsAhead, commitsBehind, filesChanged, additions, deletions };
  }

  async getDiffSummary(repoPath: string, branch: string, baseBranch?: string): Promise<string> {
    const base = baseBranch ?? `origin/${await this.getDefaultBranch(repoPath)}`;
    try {
      const { stdout } = await this.execFn('git', ['diff', '--stat', `${base}...${branch}`], {
        cwd: repoPath,
        timeout: 10_000,
      });
      return stdout.trim();
    } catch {
      this.logger.debug('Failed to get diff summary', { repoPath, branch, base });
      return '';
    }
  }

  async getLogOneline(
    repoPath: string,
    branch: string,
    baseBranch?: string,
    limit = 50,
  ): Promise<string> {
    const base = baseBranch ?? `origin/${await this.getDefaultBranch(repoPath)}`;
    try {
      const { stdout } = await this.execFn(
        'git',
        ['log', '--oneline', `${base}...${branch}`, `-${limit}`],
        { cwd: repoPath, timeout: 10_000 },
      );
      return stdout.trim();
    } catch {
      this.logger.debug('Failed to get log oneline', { repoPath, branch, base });
      return '';
    }
  }

  async repairWorktrees(repoPath: string): Promise<void> {
    await this.execFn('git', ['worktree', 'repair'], { cwd: repoPath });
    this.logger.debug('Worktree repair completed', { repoPath });
  }

  async pruneWorktrees(repoPath: string): Promise<void> {
    await this.execFn('git', ['worktree', 'prune'], { cwd: repoPath });
    this.logger.debug('Worktree prune completed', { repoPath });
  }

  private parseRemoteUrl(url: string): { org: string; name: string } {
    // Handle SSH: git@github.com:org/name.git
    const sshMatch = /[:/]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url);
    if (sshMatch) {
      return { org: sshMatch[1] ?? '', name: sshMatch[2] ?? '' };
    }

    // Handle HTTPS: https://github.com/org/name.git
    const httpsMatch = /\/([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url);
    if (httpsMatch) {
      return { org: httpsMatch[1] ?? '', name: httpsMatch[2] ?? '' };
    }

    return { org: 'unknown', name: basename(url, '.git') };
  }
}
