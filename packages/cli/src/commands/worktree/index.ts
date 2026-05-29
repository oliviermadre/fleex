import type { Command } from 'commander';
import chalk from 'chalk';
import type { CommandDef } from '../../core/types.ts';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;

const def: CommandDef = {
  name: 'worktree',
  aliases: ['wt'],
  description: 'Manage git worktrees (create on-demand in a directory of your choice)',
  isParent: true,
  extraHelp: `\n${SECTION('Examples:')}
  ${DIM('$')} fleex worktree create --org acme --repo api --branch ticket/fix --create-new --target .
  ${DIM('$')} fleex worktree create --org acme --repo api --branch main --target /tmp/api-main
  ${DIM('$')} fleex worktree create --org acme --repo api --branch feature/x --base-branch main --create-new

${SECTION('Notes:')}
  ${DIM('•')} ${chalk.cyan('--target')} is resolved against the current directory; the worktree is
    created there (handy from inside a trigger run's workspace).
  ${DIM('•')} Without ${chalk.cyan('--target')}, the server picks a path under its managed worktrees/ layout.
`,
  action: (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    cmd.outputHelp();
  },
};

export default def;
