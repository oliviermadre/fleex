import fs from 'node:fs';
import path from 'node:path';
import type { WorktreeActionsListResponse, WorktreeActionsView } from '@fleex/shared';
import { die } from '../../core/colors.ts';
import { apiBase, apiGet } from '../../core/api.ts';

/**
 * The worktree a `fleex repo actions|run|pin` call is about: `--worktree`, or
 * the git checkout the current directory is in, or the current directory (a
 * ticket workspace holding several worktrees).
 */
export function worktreeTarget(option: string | undefined, cwd = process.cwd()): string {
  if (option) return path.resolve(cwd, option);
  let dir = path.resolve(cwd);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(cwd);
    dir = parent;
  }
}

export function fetchWorktrees(target: string): Promise<WorktreeActionsListResponse> {
  return apiGet<WorktreeActionsListResponse>(`${apiBase()}/api/worktree-actions?path=${encodeURIComponent(target)}`);
}

/** Exactly one worktree, or a clear message listing the choices. */
export function singleWorktree(views: WorktreeActionsView[], target: string): WorktreeActionsView {
  if (views.length === 1) return views[0]!;
  if (views.length === 0) die(`No git worktree found at ${target}. Run from a worktree, or pass --worktree <path>.`);
  die(`${target} holds ${views.length} worktrees — pick one with --worktree:\n${views.map((v) => `  --worktree ${v.path}   (${v.repo ?? '?'} @ ${v.branch})`).join('\n')}`);
}

export const WORKTREE_OPTION = ['--worktree <path>', 'Worktree to act on (default: the git checkout of the current directory)'] as const;
