import chalk from 'chalk';

import type { CommandDef } from '../../../core/types.ts';
import type { Command } from 'commander';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;

const def: CommandDef = {
  name: 'gate',
  description: 'Resolve human-gate steps in a workflow run',
  isParent: true,
  extraHelp: `\n${SECTION('Examples:')}
  ${DIM('$')} fleex workflow gate resolve <runId> <stepRunId> --outcome approved
  ${DIM('$')} fleex workflow gate resolve <runId> <stepRunId> --outcome rejected --notes "needs rework"
`,
  action: (...args: unknown[]) => {
    const cmd = args[args.length - 1] as Command;
    cmd.outputHelp();
  },
};

export default def;
