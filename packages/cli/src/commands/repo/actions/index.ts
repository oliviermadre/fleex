import chalk from 'chalk';
import type { CommandDef } from '../../../core/types.ts';
import { c, info } from '../../../core/colors.ts';
import { printJson, renderTable, trunc } from '../../../core/agentic.ts';
import { WORKTREE_OPTION, fetchWorktrees, worktreeTarget } from '../_worktree.ts';

interface Options { worktree?: string; json?: boolean }

const DIM = chalk.dim;

const def: CommandDef = {
  workspaceAware: true,
  name: 'actions',
  description: "List a worktree's commands (repo actions, launch.json, npm, make, composer) and its server state",
  extraHelp: `\n${chalk.bold.yellow('Examples:')}
  ${DIM('$')} fleex repo actions                          ${DIM('# the worktree of the current directory')}
  ${DIM('$')} fleex repo actions --worktree ../secondrepo
  ${DIM('$')} fleex repo run npm:test                     ${DIM('# run one of the listed ids')}
  ${DIM('$')} fleex repo run start                        ${DIM('# start | stop | restart | status | open | logs')}
  ${DIM('$')} fleex repo pin npm:test                     ${DIM('# ★ it in the menu (personal)')}

Config layers, strongest first: your Fleex settings, ${chalk.green('.fleex/worktree.json')} (committed),
${chalk.green('.claude/launch.json')} (read only), then detected package.json / Makefile / composer.json.
`,
  setup(cmd) {
    cmd.option(...WORKTREE_OPTION);
    cmd.option('--json', 'Output raw JSON');
  },
  action: async (opts: Options) => {
    const target = worktreeTarget(opts.worktree);
    const { worktrees } = await fetchWorktrees(target);
    if (opts.json) {
      printJson(worktrees);
      return;
    }
    if (worktrees.length === 0) {
      info(`No git worktree found at ${target}.`);
      return;
    }
    for (const wt of worktrees) {
      const s = wt.server;
      const state = s.state === 'running' ? c.green(`running${s.port ? ` :${s.port}` : ''}`) : s.state === 'error' ? c.red(`error${s.exitCode !== undefined ? ` (exit ${s.exitCode})` : ''}`) : s.state === 'starting' ? c.yellow('starting') : c.dim('stopped');
      process.stdout.write(`\n${chalk.bold(wt.repo ?? wt.path)} ${c.dim(`@ ${wt.branch}`)}  ${state}\n${c.dim(wt.path)}\n`);
      process.stdout.write(`start: ${wt.start ? `${wt.start.id ?? wt.start.command}` : c.dim('not configured (server.start)')}\n`);
      if (wt.sharedConfigError) process.stdout.write(c.red(`⚠ ${wt.sharedConfigError}\n`));
      renderTable(
        ['', 'ID', 'SOURCE', 'LAYER', 'MODE', 'COMMAND'],
        wt.items.map((i) => [i.pinned ? '★' : '', i.id, i.source, i.layer, i.mode, trunc(i.command, 60)]),
      );
    }
    info(`${worktrees.reduce((n, w) => n + w.items.length, 0)} command(s) in ${worktrees.length} worktree(s)`);
  },
};

export default def;
