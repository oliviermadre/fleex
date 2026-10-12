import type { Command } from 'commander';
import chalk from 'chalk';
import type { CommandDef } from '../../core/types.ts';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;

const def: CommandDef = {
  name: 'worktree',
  description: 'Maintain ticket worktrees across all repositories (cleanup, ...)',
  isParent: true,
  extraHelp: `\n${SECTION('Examples:')}
  ${DIM('$')} fleex worktree cleanup                       ${DIM('# dry-run: what could go, what is kept and why')}
  ${DIM('$')} fleex worktree cleanup -v --older-than 30d   ${DIM('# detail eligible worktrees + tickets below the threshold')}
  ${DIM('$')} fleex worktree cleanup --apply               ${DIM('# remove, after confirmation')}

${DIM('Per-repository worktree listing is')} fleex repo worktrees <org/name>${DIM('.')}
`,
  action: (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    cmd.outputHelp();
  },
};

export default def;
