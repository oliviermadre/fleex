import chalk from 'chalk';
import { keyScope, type WorktreeSettingsResponse } from '@fleex/shared';
import type { CommandDef } from '../../../../core/types.ts';
import { c } from '../../../../core/colors.ts';
import { apiBase, apiGet } from '../../../../core/api.ts';
import { printJson } from '../../../../core/agentic.ts';
import { WORKTREE_OPTION, fetchWorktrees, singleWorktree, worktreeTarget } from '../../_worktree.ts';

const def: CommandDef = {
  workspaceAware: true,
  name: 'show',
  description: "Show a worktree's Setup / Teardown hooks, its file hooks and where each comes from",
  setup(cmd) {
    cmd.option(...WORKTREE_OPTION);
    cmd.option('--json', 'Output raw JSON');
  },
  action: async (opts: { worktree?: string; json?: boolean }) => {
    const where = worktreeTarget(opts.worktree);
    const view = singleWorktree((await fetchWorktrees(where)).worktrees, where);
    if (!view.repo) throw new Error(`${view.path} has no resolvable repository (git remote)`);
    const s = await apiGet<WorktreeSettingsResponse>(`${apiBase()}/api/worktree-actions/settings?repo=${encodeURIComponent(view.repo)}&path=${encodeURIComponent(view.path)}`);
    if (opts.json) {
      printJson({ personal: s.personal.hooks ?? {}, shared: s.shared?.hooks ?? {}, fileHooks: s.fileHooks, hooksDir: s.hooksDir, setup: s.view?.setup });
      return;
    }
    const where_ = (key: string) => {
      const scope = keyScope(s.personal, s.shared, key);
      return scope.layer === 'personal' ? c.cyan(scope.masks ? 'perso (masque l\'équipe)' : 'perso') : scope.layer === 'shared' ? c.green('partagé') : c.dim('non configuré');
    };
    for (const hook of ['setup', 'teardown'] as const) {
      const value = (s.personal.hooks?.[hook] ?? s.shared?.hooks?.[hook] ?? '').trim();
      process.stdout.write(`${chalk.bold(hook)}  ${where_(`hooks.${hook}`)}\n${value ? value.split('\n').map((l) => `  ${l}`).join('\n') : c.dim('  —')}\n\n`);
    }
    process.stdout.write(`${chalk.bold('file hooks')} (run before the Setup script)  ${c.dim(s.hooksDir)}\n`);
    for (const f of [...s.fileHooks.global, ...s.fileHooks.repo]) process.stdout.write(`  ${f}\n`);
    if (!s.fileHooks.global.length && !s.fileHooks.repo.length) process.stdout.write(c.dim('  —\n'));
    if (s.view?.setup) process.stdout.write(`\nlast setup: ${s.view.setup.state} (${s.view.setup.startedAt})\n`);
  },
};

export default def;
