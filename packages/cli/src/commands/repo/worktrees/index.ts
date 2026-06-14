import type { CommandDef } from '../../../core/types.ts';
import { c, info } from '../../../core/colors.ts';
import { apiBase, apiGet } from '../../../core/api.ts';
import { printJson, renderTable } from '../../../core/agentic.ts';
import { parseRepo, type Worktree } from '../_shared.ts';

interface Options { json?: boolean }

const def: CommandDef = {
  workspaceAware: true,
  name: 'worktrees',
  aliases: ['wt'],
  description: 'List the worktrees (branch ↔ path pairs) of a repository',
  setup(cmd) {
    cmd.argument('<org/name>', 'Repository reference');
    cmd.option('--json', 'Output raw JSON');
  },
  action: async (repoArg: string, opts: Options) => {
    const { org, name } = parseRepo(repoArg);
    const worktrees = await apiGet<Worktree[]>(`${apiBase()}/api/repositories/${org}/${name}/worktrees`);
    if (opts.json) {
      printJson(worktrees);
      return;
    }
    if (worktrees.length === 0) {
      info('No worktrees found (is the repo cloned locally?).');
      return;
    }
    const rows = worktrees.map((w) => [
      w.branch || c.dim('(detached)'),
      w.isMain ? 'main' : w.isBare ? 'bare' : 'wt',
      w.path,
    ]);
    renderTable(['BRANCH', 'KIND', 'PATH'], rows);
    info(`${worktrees.length} worktree(s)`);
  },
};

export default def;
