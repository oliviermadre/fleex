import type { WorktreeActionsView } from '@fleex/shared';
import { die, ok as success } from '../../../core/colors.ts';
import { apiBase, apiPost } from '../../../core/api.ts';
import { printJson } from '../../../core/agentic.ts';
import { fetchWorktrees, singleWorktree, worktreeTarget } from '../_worktree.ts';

/** `fleex repo pin|unpin <id>`: the ★ of the worktree menu, in the personal layer. */
export async function setPin(id: string, pinned: boolean, opts: { worktree?: string; json?: boolean }): Promise<void> {
  const where = worktreeTarget(opts.worktree);
  const view = singleWorktree((await fetchWorktrees(where)).worktrees, where);
  if (!view.items.some((i) => i.id === id)) {
    die(`No command "${id}" in ${view.repo ?? view.path} — see fleex repo actions`);
  }
  const fresh = await apiPost<WorktreeActionsView>(`${apiBase()}/api/worktree-actions/${pinned ? 'pin' : 'unpin'}`, { path: view.path, id });
  if (opts.json) {
    printJson(fresh);
    return;
  }
  success(`${pinned ? '★ Pinned' : 'Unpinned'} ${id} (${fresh.repo ?? fresh.path}, personal)`);
}
