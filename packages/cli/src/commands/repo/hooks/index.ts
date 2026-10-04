import type { Command } from 'commander';
import chalk from 'chalk';
import type { CommandDef } from '../../../core/types.ts';

const DIM = chalk.dim;

const def: CommandDef = {
  name: 'hooks',
  description: 'Worktree hooks: show, run (setup | teardown), open the hooks folder',
  isParent: true,
  extraHelp: `\n${chalk.bold.yellow('Examples:')}
  ${DIM('$')} fleex repo hooks show                        ${DIM('# setup / teardown, file hooks, where each comes from')}
  ${DIM('$')} fleex repo hooks run setup                   ${DIM('# re-run the Setup in this worktree')}
  ${DIM('$')} fleex repo hooks open                        ${DIM('# the repo hooks folder (overlays/<org>/<repo>/hooks)')}
`,
  action: (...args: unknown[]) => {
    (args[args.length - 1] as Command).outputHelp();
  },
};

export default def;
