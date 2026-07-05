import type { Command } from 'commander';
import chalk from 'chalk';
import type { CommandDef } from '../../../core/types.ts';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;

const def: CommandDef = {
  name: 'run',
  description: 'Inspect & control workflow runs (list, show, cancel)',
  isParent: true,
  extraHelp: `\n${SECTION('Examples:')}
  ${DIM('$')} fleex workflow run list 42            ${DIM('# runs for ticket #42')}
  ${DIM('$')} fleex workflow run show <runId>       ${DIM('# run detail + its step runs')}
  ${DIM('$')} fleex workflow run cancel <runId> -f  ${DIM('# cancel an active run')}
`,
  action: (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    cmd.outputHelp();
  },
};

export default def;
