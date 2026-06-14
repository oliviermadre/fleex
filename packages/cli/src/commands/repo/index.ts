import type { Command } from 'commander';
import chalk from 'chalk';
import type { CommandDef } from '../../core/types.ts';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;
const GREEN = chalk.green;

const def: CommandDef = {
  name: 'repo',
  aliases: ['repository'],
  description: 'Manage repositories, worktrees & PRs (list, show, register, ...)',
  isParent: true,
  extraHelp: `\n${SECTION('Repository ref:')}  ${GREEN('org/name')} (e.g. ${GREEN('oliviermadre/fleex')})

${SECTION('Examples:')}
  ${DIM('$')} fleex repo list                              ${DIM('# configured repos + summaries')}
  ${DIM('$')} fleex repo show oliviermadre/fleex           ${DIM('# dashboard: PRs, issues, worktrees')}
  ${DIM('$')} fleex repo worktrees oliviermadre/fleex      ${DIM('# branch ↔ path pairs')}
  ${DIM('$')} fleex repo branches oliviermadre/fleex
  ${DIM('$')} fleex repo pr --repo oliviermadre/fleex --state open
  ${DIM('$')} fleex repo issues --repo oliviermadre/fleex
  ${DIM('$')} fleex repo register oliviermadre/fleex       ${DIM('# add to workspace config (auto-clones)')}
  ${DIM('$')} fleex repo unregister oliviermadre/fleex     ${DIM('# remove from config (deletes clone)')}
  ${DIM('$')} fleex repo refresh --all                     ${DIM('# refresh GitHub data in background')}
`,
  action: (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    cmd.outputHelp();
  },
};

export default def;
