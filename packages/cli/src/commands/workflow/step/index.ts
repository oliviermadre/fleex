import type { Command } from 'commander';
import chalk from 'chalk';
import type { CommandDef } from '../../../core/types.ts';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;

const def: CommandDef = {
  name: 'step',
  description: 'Control individual step runs in a workflow run (retry)',
  isParent: true,
  extraHelp: `\n${SECTION('Examples:')}
  ${DIM('$')} fleex workflow step retry <runId> <stepRunId>   ${DIM('# re-run a failed step')}
`,
  action: (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    cmd.outputHelp();
  },
};

export default def;
